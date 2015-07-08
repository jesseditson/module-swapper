var fs = require('fs')
var path = require('path')
var acorn = require('acorn-jsx')
var falafel = require('falafel')
var scoped = require('scoped')
var findit = require('findit')

var isMarionetteApp = require('./lib/isMarionetteApp')
var findModulePropertyAccess = require('./lib/findModulePropertyAccess')
var moduleName = require('./lib/moduleName')
var isMarionetteAppMemberExpression = require('./lib/isMarionetteAppMemberExpression')
var findModuleNodes = require('./lib/findModuleNodes')
var marionetteModuleDefinition = require('./lib/marionetteModuleDefinition')
var getModuleVars = require('./lib/getModuleVars')

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


var getModuleName = function(module, moduleMap) {
  while(typeof moduleMap[module] === 'string') {
    module = moduleMap[module]
  }
  return module
}

var processFileDependencies = function(file, contents, appName) {
  var needsRequire = []
  // figure out our top level requires
  falafel(contents, falafelOpts, scoped(function(scope, node) {
    needsRequire = needsRequire.concat(scope.uses.filter(function(variable) {
      // not a native global, we need to require this.
      return eval('typeof ' + variable.name) === 'undefined'
    }).map(function(v) { return v.name }))
  }))
  var definedModules = {}
  var accessedModules = {}
  // figure out what marionette modules we're using.
  falafel(contents, falafelOpts, function(node) {
    var defined = marionetteModuleDefinition(node, appName)
    if (defined) {
      definedModules[defined.name] = {
        varName: defined.module
      }
      logger('found module definition ' + defined.name)
    }
  })
  Object.keys(definedModules).forEach(function(m) {
    var module = definedModules[m]
    var properties = findModulePropertyAccess.call({falafelOpts: falafelOpts}, contents, module.varName).properties
    definedModules[m].properties = properties[module.varName] || []
  })
  var accessedProperties = findModulePropertyAccess.call({falafelOpts: falafelOpts}, contents, null, {appName: appName})
  logger('base dependencies -> ' + needsRequire)
  logger('module dependencies -> ' + Object.keys(accessedProperties.properties).reduce(function(a, name) {
    a.push(' ' + getModuleName(name, accessedProperties.moduleMap) + ' (' + accessedProperties.properties[name] + ')')
    return a
  }, []))
  return {
    defined: definedModules,
    accessed: accessedProperties,
    required: needsRequire
  }
}

var splice = function(str, start, end, add) {
  return {
    out: str.slice(0, start) + (add || "") + str.slice(end),
    difference: (end-start) - add
  }
}

var resolveDependencies = function(file, info, globalModules, filesMap) {
  logger('------------- resolving ' + path.relative(process.cwd(), file) + ' ---------------------')
  var globalDependencies = info.required.reduce(function(o, dep) {
    if (!globalModules[dep]) {
      logger('WARNING: unknown module ' + dep + ', a require statement will not be generated and this variable must be global.')
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
      if (!propertyMap) {
        if (~info.required.indexOf(moduleName)) return
        var vars = getModuleVars(node, info.appName)
        if (moduleName === vars.appVar || moduleName == vars.moduleVar) return
        logger('WARNING: unknown module ' + module.name + '. Unable to resolve this dependency.')
      } else if (!propertyMap[propertyName]) {
        logger('WARNING: unknown property ' + propertyName + ' accessed on module ' + moduleName + '(via ' +module.name+ '). Unable to resolve this access.')
      } else {
        var requiredModule
        if (requiresProperties[moduleName]) {
          // we've already accessed this module once, see if the properties line up.
          if (!requiresProperties[moduleName][propertyName]) {
            // this property is not on the existing module, add a new require
            var p = /(\d)?$/
            var m = moduleName.match(p)
            // add or increment a trailing number if there's already a module being imported by this name.
            var propertyModule = moduleName.replace(p, parseInt(m[1] || '1', 10) + 1)
            requiresProperties[moduleName][propertyName] = propertyModule
            requires[propertyModule] = propertyMap[propertyName]
            requiredModule = propertyModule
          } else {
            requiredModule = requiresProperties[moduleName][propertyName]
          }
        } else {
          requiresProperties[moduleName] = {}
          requiresProperties[moduleName][propertyName] = moduleName
          requires[moduleName] = propertyMap[propertyName]
          requiredModule = moduleName
        }
        node.update(requiredModule)
      }
    }
  })
  out = findModulePropertyAccess.call({falafelOpts: falafelOpts}, String(out), info.accessed.moduleMap, {
    appName: info.appName,
    reassignmentFn: function(newName, name, isRoot, node) {
      var propertyMap = filesMap[name]
      var moduleFiles = []
      for (var p in propertyMap) {
        moduleFiles.push(propertyMap[p])
      }
      if (!propertyMap) {
        logger('WARNING: unable to find required dependency '+ name)
      } else {
        console.log(propertyMap, moduleFiles)
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
      // TODO: probably should handle making our own name if this is not defined.
      moduleVar = node.params[0].name
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
  var replaceInline = opts.replaceInline
  var fileFilter = opts.fileFilter
  var finder = findit(opts.dir || '.')

  var completedCallback = callback || function(err) {
    if (err) throw err
    process.exit(0)
  }

  var needsProcess = []
  var files = {}
  var appName, appFile

  finder.on('end', function() {
    if (!appName || !appFile) return completedCallback(new Error('No Marionette app found.'))
    logger('--------------------- COMPLETED ---------------------------------')
    // This is innacurate because it includes local variables. If we want this logging we'll need to resolve that.
    // var transformedFiles = {}
    // var accessedModules = {}
    // var definedModules = Object.keys(files).reduce(function(o, f) {
    //   var file = files[f]
    //   for (var d in file.defined) {
    //     o[d] = file.defined[d]
    //   }
    //   for (var a in file.accessed.definitions) {
    //     if (!globalModuleMap[a]) accessedModules[a] = file.accessed.definitions[a]
    //   }
    //   return o
    // }, {})
    // logger("Application: ", appName)
    // var definedKeys = Object.keys(definedModules)
    // logger("Defined Modules: ", definedKeys)
    // var accessedKeys = Object.keys(accessedModules)
    // logger("Accessed Modules: ", accessedKeys)
    // var unusedModules = definedKeys.filter(function(k) { return !accessedModules[k] })
    // var undefinedModules = accessedKeys.filter(function(k) { return !definedModules[k] })
    // logger("Unused modules: ", unusedModules)
    // logger("Undefined modules: ", undefinedModules)

    // resolve our dependencies
    var filesMap = Object.keys(files).reduce(function(o, file) {
      var info = files[file]
      Object.keys(info.defined).forEach(function(name) {
        o[name] = o[name] || {}
        info.defined[name].properties.forEach(function(prop) {
          if (o[name][prop]) throw new Error('Found multiple definitions of Module ' + name + ' property ' + prop)
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

    // for each file that defines a module, resolve it's dependencies
    Object.keys(moduleFiles).forEach(function(file) {
      transformedFiles[file] = resolveFileDependencies(file, true)
      if (replaceInline) {
        fs.writeFileSync(file, transformedFiles[file])
      }
    })
    completedCallback(null, transformedFiles, fileContents)
  })

  var processFile = function (file) {
    if (fileFilter && !fileFilter.test(file)) return
    if (!~extensions.indexOf(path.extname(file))) return
    file = path.resolve(process.cwd(), file)
    var contents = getContents(file)

    // find our app name
    falafel(contents, falafelOpts, function(node) {
       var nodeAppName = isMarionetteApp(node)
       if (nodeAppName) {
         if (appName) throw new Error('Multiple app definitions (' + appName + ', ' + nodeAppName + ') found. Unable to calculate dependencies.')
         globalModuleMap[nodeAppName] = file
         appName = nodeAppName
         appFile = file
         logger('found application definition: ' + appName)
       }
     })
     if (!appName) {
       // if we haven't found the app, just defer processing of this file.
       return needsProcess.push(file)
     } else if (needsProcess.length) {
       // if we have deferred any files and we found the app, process them now.
       var processFiles = needsProcess
       needsProcess = []
       needsProcess.forEach(processFile)
     }

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

  finder.on('file', processFile)

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
