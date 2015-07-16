var fs = require('fs')
var path = require('path')
var acorn = require('acorn-jsx')
var falafel = require('falafel')
var scoped = require('scoped')
var findit = require('findit')
var readlineSync = require('readline-sync')


var isMarionetteApp = require('./lib/isMarionetteApp')
var findModulePropertyAccess = require('./lib/findModulePropertyAccess')
var moduleName = require('./lib/moduleName')
var isMarionetteAppMemberExpression = require('./lib/isMarionetteAppMemberExpression')
var findModuleNodes = require('./lib/findModuleNodes')
var marionetteModuleDefinition = require('./lib/marionetteModuleDefinition')
var getModuleVars = require('./lib/getModuleVars')
var getModuleName = require('./lib/getModuleName')

var falafelOpts
var logger
var moduleType

var accessedMarionetteModules = function(node, appName) {
  var modules = []
  var moduleVar = findModuleNodes(node, appName, function(moduleName) {
    modules.push({name: moduleName})
  })
  return {module: moduleVar, modules: modules}
}

var expectedGlobals = {}

var processFileDependencies = function(file, contents, appName) {
  var needsRequire = []
  // figure out our top level requires
  falafel(contents, falafelOpts, scoped(function(scope, node) {
    needsRequire = needsRequire.concat(scope.uses.filter(function(variable) {
      // check if this variable was defined anywhere in this scope
      var wasDefined = false
      variable.nodes.forEach(function(info) {
        if (info.kind === 'explicit') wasDefined = true
      })
      if (wasDefined) return false
      // not a native global, we need to require this.
      if (expectedGlobals[variable.name]) return false
      if (eval('typeof ' + variable.name) === 'undefined') return true
    }).map(function(v) { return v.name }))
  }))
  var appProperties = {}
  var definedModules = {}
  var accessedModules = {}
  // figure out what marionette modules we're using.
  var moduleAppName
  falafel(contents, falafelOpts, function(node) {
    if (!moduleAppName) {
      var moduleVars = getModuleVars(node, appName)
      if (moduleVars.appVar) moduleAppName = moduleVars.appVar
    }
    var defined = marionetteModuleDefinition(node, [appName, moduleAppName])
    if (defined) {
      definedModules[defined.name] = {
        varName: defined.module
      }
    }
    if (isMarionetteAppMemberExpression(node, [appName, moduleAppName])) {
      if (node.parent.type === 'AssignmentExpression') {
        appProperties[node.property.name] = file
      }
    }
  })
  Object.keys(definedModules).forEach(function(m) {
    var module = definedModules[m]
    var info = findModulePropertyAccess.call({falafelOpts: falafelOpts}, contents, module.varName, {appName: appName})
    var declarations = info.declarations
    definedModules[m].properties = (declarations[module.varName] || []).concat(info.defined)
  })
  var accessedProperties = findModulePropertyAccess.call({falafelOpts: falafelOpts}, contents, null, {appName: appName})
  logger('defines modules -> ' + Object.keys(definedModules).reduce(function(a, name) {
    a.push(' ' + name + ' (' + definedModules[name].properties + ')')
    return a
  }, []))
  logger('base dependencies -> ' + needsRequire)
  // logger('module dependencies -> ' + Object.keys())
  logger('module properties -> ' + Object.keys(accessedProperties.properties).reduce(function(a, name) {
    a.push(' ' + getModuleName(name, accessedProperties.moduleMap) + ' (' + accessedProperties.properties[name] + ')')
    return a
  }, []))
  // logger('assigned modules -> ' + Object.keys(accessedProperties.moduleMap).filter(function(m) { return accessedProperties.moduleMap[m] === true }))
  return {
    defined: definedModules,
    accessed: accessedProperties,
    required: needsRequire,
    appProperties: appProperties
  }
}

var toVarName = function(str) {
  // this is naive, but better than doing a real validation as it's a 11,236 character regex.
  return str.replace(/[^\w\d]/g,'')
}

var resolveDependencies = function(file, info, globalModules, filesMap) {
  logger('------------- resolving ' + path.relative(process.cwd(), file) + ' ---------------------')
  var globalDependencies = info.required.reduce(function(o, dep) {
    if (!globalModules[dep]) {
      logger(('WARNING: unknown module ' + dep + ', a require statement will not be generated and this variable must be global.').yellow)
    } else {
      o[dep] = globalModules[dep]
    }
    return o
  }, {})

  // Key/value pairs of module names and files.
  var requires = {}
  /*
    requiresProperties:
    {
      moduleName: {
        propertyName: requiresModuleName
      }
    }
  */
  var requiresProperties = {}

  var out = findModulePropertyAccess.call({falafelOpts: falafelOpts}, info.contents, info.accessed.moduleMap, {
    appName: info.appName,
    propertyFn: function(propertyName, node, module, varMap) {
      var moduleName = getModuleName(module.name, varMap)
      var propertyMap = filesMap[moduleName]
      var defaultFile = null
      if (propertyMap && !propertyMap[propertyName]) {
        var modules = filesMap[moduleName]
        var fileNames = Object.keys(modules)
        var files = Object.keys(fileNames.reduce(function(o, f) { o[modules[f]] = true; return o }, {}))
        if (files.length === 1) {
          defaultFile = files[0]
        } else {
          var opts = ['SKIP'].concat(files)
          var answer = readlineSync.keyInSelect(opts, 'Unable to auto-resolve dependency ' + moduleName +' based on access of "' + propertyName + '". Please choose which file has this property:')
          if (!~answer) {
            throw new Error('Cancelled.')
          } else if (answer > 0) {
            console.log(opts[answer])
            defaultFile = opts[answer]
          }
        }
      }

      if (!propertyMap) {
        if (~info.required.indexOf(moduleName)) return
        var vars = getModuleVars(node, info.appName)
        if (moduleName === vars.appVar || moduleName == vars.moduleVar) return
        logger(('WARNING: unknown module ' + module.name + '. Unable to resolve this dependency.').yellow)
      } else if (!propertyMap[propertyName] && !defaultFile) {
        logger(('WARNING: unknown property ' + propertyName + ' accessed on module ' + moduleName + '(via ' +module.name+ '). Unable to resolve this access.').yellow)
      } else {
        var requiredModule
        if (requiresProperties[moduleName]) {
          // we've already accessed this module once, see if the properties line up.
          if (!requiresProperties[moduleName][propertyName]) {
            // this property is not on the existing module, add a new require
            var p = /(\d)?$/
            var m = moduleName.match(p)
            // add or increment a trailing number if there's already a module being imported by this name.
            var propertyModule = toVarName(moduleName).replace(p, parseInt(m[1] || '1', 10) + 1)
            console.log('adding', moduleName, 'for access of', propertyName, '->', propertyModule)
            requiresProperties[moduleName][propertyName] = propertyModule
            console.log('requiring', propertyModule, propertyMap[propertyName] || defaultFile)
            requires[propertyModule] = propertyMap[propertyName] || defaultFile
            requiredModule = propertyModule
          } else {
            requiredModule = requiresProperties[moduleName][propertyName]
          }
        } else {
          requiresProperties[moduleName] = {}
          requiresProperties[moduleName][propertyName] = toVarName(moduleName)
          requires[toVarName(moduleName)] = propertyMap[propertyName] || defaultFile
          requiredModule = toVarName(moduleName)
        }
        node.update(requiredModule)
      }
    }
  })
  out = findModulePropertyAccess.call({falafelOpts: falafelOpts}, String(out), info.accessed.moduleMap, {
    appName: info.appName,
    reassignmentFn: function(newName, name, isRoot, node) {
      // don't update if this isn't the root module.
      if (!isRoot) return
      // this is called whenever we find a node using a module.
      var variableProps = info.accessed.variableProperties[name]
      var propertyMap = filesMap[name]
      if (!propertyMap) {
        logger('WARNING: unable to find required dependency '+ name)
      } else {
        var moduleFiles
        if (variableProps) {
          moduleFiles = variableProps.map(function(prop) {
           return propertyMap[prop]
         })
        } else {
          moduleFiles = Object.keys(propertyMap).reduce(function(a, prop) {
            if (!~a.indexOf(propertyMap[prop])) a.push(propertyMap[prop])
            return a
          }, [])
        }
        if (moduleFiles.length > 1) logger('WARNING: found more than one definition of ' + name + ' and was unable to determine which to use based on property access. Resolution may be innacurate.')
        requires[name] = moduleFiles[0]
        node.update(name)
      }
    }
  })

  // define modules as vars, and move the content of their closures to the level above.
  var moduleVar
  out = falafel(String(out), falafelOpts, function(node) {
    var moduleDef = marionetteModuleDefinition(node, info.appName)
    if (moduleDef) {
      if (moduleVar) return logger('FOUND MULTIPLE MODULE DEFINITIONS')
      // find the nearest ExpressionStatement to the node, which will be the App.module('Name', fn() {}) call.
      var pNode = node
      var expression
      while (!expression) {
        if (pNode.type === 'ExpressionStatement') {
          expression = pNode
        }
        pNode = pNode.parent
      }
      // body of body is an array of nodes (node is a FunctionExpression, body is a BlockStatement)
      var newContent = node.body.body.map(function(n) {
        // since we're going down a level, drop the indentation.
        // TODO: this should probably respect the .editorconfig or similar instead of being hard coded to 4.
        // alternatively, this file could just run the jscs fixer after refactoring, which would probably be better.
        return n.source().replace(/\n\s{4}/g,'\n')
      })
      if (node.params[0]) {
        moduleVar = node.params[0].name
      } else {
        var f = path.basename(file).replace(path.extname(file), '')
        moduleVar = f.slice(0, 1).toUpperCase() + f.slice(1)
        // strip non-word characters and camelcase
        var re = /[^\w]/g, m
        while (m = re.exec(moduleVar)) {
          moduleVar = moduleVar.slice(0, m.index) + moduleVar.slice(m.index + 1, m.index + 2).toUpperCase() + moduleVar.slice(m.index + 2)
        }
        logger('WARNING: module was not named explicitly, making up a name based on the file: ', moduleVar)
      }
      newContent.unshift('var ' + moduleVar + ' = {};\n')
      newContent.unshift('/* module definition */')
      newContent = newContent.join('\n')
      expression.update(newContent)
    }
  })

  // add imports for our required files and global files
  var flen = String(out).length
  out = addImports(file, String(out), moduleType, requires)
  if (out.length > flen) out = '/* local dependencies */\n' + out
  flen = String(out).length
  out = addImports(file, String(out), moduleType, globalDependencies)
  if (out.length > flen) out = '/* global dependencies */\n' + out

  // finally, export our module
  if (info.isApp) {
    moduleVar = info.appName
  }
  if (moduleVar) {
    logger('exporting ' + moduleVar)
    out = addExport(out, moduleType, moduleVar)
  }

  return out
}

module.exports = function(opts, callback) {

  logger = opts.logger || console.log
  falafelOpts = opts.falafelOpts || {
    parser: acorn,
    ecmaVersion: 6,
    plugins: { jsx: true }
  }
  moduleType = opts.loader || 'commonjs'

  var fileContents = {}
  var getContents = function(n) { return fileContents[n] = fs.readFileSync(n, 'utf8') }

  var extensions = opts.extensions || ['.js', '.jsx']
  var globalModuleMap = opts.modules || {
    'Backbone': 'backbone',
    '$': 'jquery',
    'moment': 'moment',
    '_': 'underscore',
    'Marionette': 'marionette'
  }

  expectedGlobals = opts.globals || {}
  var replaceInline = opts.replaceInline
  var fileFilter = opts.fileFilter
  var finder = findit(opts.dir || '.')

  var completedCallback = callback || function(err) {
    if (err) throw err
    process.exit(0)
  }

  var needsProcess = []
  var finderCompleted
  var files = {}
  var appName, appFile

  var completeProcessing = function() {
    logger('--------------------- COMPLETED ---------------------------------')
    var transformedFiles = {}
    var accessedModules = {}
    var definedModules = Object.keys(files).reduce(function(o, f) {
      var file = files[f]
      for (var d in file.defined) {
        o[d] = file.defined[d]
      }
      for (var a in file.accessed.modules) {
        if (!globalModuleMap[a]) accessedModules[a] = file.accessed.modules[a]
      }
      return o
    }, {})
    logger("Application: ", appName)
    var definedKeys = Object.keys(definedModules)
    logger("Defined Modules: ", definedKeys)
    var accessedKeys = Object.keys(accessedModules)
    logger("Accessed Modules: ", accessedKeys)
    var unusedModules = definedKeys.filter(function(k) { return !accessedModules[k] })
    var undefinedModules = accessedKeys.filter(function(k) { return !definedModules[k] })
    logger("Unused modules: ", unusedModules)
    logger("Undefined modules: ", undefinedModules)

    // resolve our dependencies
    var filesMap = Object.keys(files).reduce(function(o, file) {
      var info = files[file]
      Object.keys(info.defined).forEach(function(name) {
        o[name] = o[name] || {}
        if (!o[name].__filename) o[name].__filename = file
        info.defined[name].properties.forEach(function(prop) {
          if (o[name][prop] && o[name][prop] !== file) throw new Error('Found multiple definitions of Module ' + name + ' property ' + prop + '\n' + o[name][[prop]] + '\n' + file)
          o[name][prop] = file
        })
      })
      return o
    }, {})

    var outFiles = {}
    var inFiles = {}

    files = Object.keys(files).reduce(function(o, file) {
      var info = files[file]
      info.appName = appName
      if (file === appFile) {
        info.isApp = true
      }
      info.transformed = resolveDependencies(file, info, globalModuleMap, filesMap)
      o[file] = info

      inFiles[file] = info.contents
      outFiles[file] = info.transformed

      return o
    }, {})

    return completedCallback(null, outFiles, inFiles)
  }

  var processFile = function (file) {
    var contents = getContents(file)

    logger('------------------------------------------------------------------------')
    logger('processing ' + file)

    try {
      files[file] = processFileDependencies(file, contents, appName)
      files[file].contents = contents
    } catch(e) {
      logger('failed processing file ' + file + ':')
      logger(e.message)
      logger(e.stack)
    }
  }

  finder.on('end', function() {
    if (!appName || !appFile) return completedCallback(new Error('No Marionette app found.'))
    needsProcess.forEach(processFile)
    completeProcessing()
  })

  finder.on('file', function(file) {
    if (fileFilter && !fileFilter.test(file)) return
    if (!~extensions.indexOf(path.extname(file))) return
    file = path.resolve(process.cwd(), file)
    var contents = getContents(file)

    // find our app name
    falafel(contents, falafelOpts, function(node) {
      var nodeAppName = isMarionetteApp(node)
      if (nodeAppName) {
        if (appName) {
          console.error(file + ' ' + node.parent.source())
          throw new Error('Multiple app definitions (' + appName + ', ' + nodeAppName + ') found. Unable to calculate dependencies.')
        }
        globalModuleMap[nodeAppName] = file
        appName = nodeAppName
        appFile = file
        logger('found application definition: ' + appName)
        logger('(' +file + ' ' + node.parent.source() + ')')
      }
    })
    needsProcess.push(file)
  })

  finder.on('directory', function (dir, stat, stop) {
    var base = path.basename(dir)
    // this is how we'd ignore common files:
    if (base === '.git' || base === 'node_modules') {
      stop()
    } else {
      // logger('entering ' + dir + '/')
    }
  })
}

var addImports = function(file, contents, type, imports) {
  switch (type) {
    case 'commonjs':
      var lines = contents
        .split('\n')
      var importNames = Object.keys(imports)
      if (importNames.length) {
        logger('adding imports:')
        lines.unshift('\n')
        importNames.forEach(function(varName) {
          // TODO: we'll need to make sure that we're not conflicting with any variables in this scope
          var dependencyPath = imports[varName]
          // resolve relative or absolute paths, otherwise we assume this is available by name.
          if (/^[\/\.]/.test(dependencyPath)) {
            dependencyPath = path.relative(path.dirname(file), dependencyPath)
            // trim .js extension and add leading relative path if we're in the same directory.
            dependencyPath = dependencyPath.replace(/\.js$/, '').replace(/(^\w)/, './$1')
          }
          var importStatement = 'var ' + varName + " = require('" + dependencyPath + "');"
          lines.unshift(importStatement)
          logger(importStatement)
        })
      } else {
        logger('no dependencies found.')
      }
      return lines.join('\n')
    default:
      completedCallback(new Error('Unsupported module loader ' + type))
  }
}

var addExport = function(contents, type, varName) {
  switch (type) {
    case 'commonjs':
      var lines = contents
        .split('\n')
        .concat([
          "module.exports = " + varName + ";",
          "" // trailing line at end of file
        ])
      return lines.join('\n')
    default:
      completedCallback(new Error('Unsupported module loader ' + type))
  }
}
