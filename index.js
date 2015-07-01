var fs = require('fs')
var path = require('path')
var acorn = require('acorn-jsx')
var falafel = require('falafel')
var scoped = require('scoped')
var args = process.argv.slice(2)
var finder = require('findit')(args[0] || '.')

var extensions = ['.js', '.jsx']

var loaderName = 'commonjs'

var globalModuleMap = {
  'Backbone': 'backbone',
  '$': 'jquery',
  'moment': 'moment',
  '_': 'underscore',
  'Marionette': 'marionette'
}

var falafelOpts = {
  parser: acorn,
  ecmaVersion: 6,
  plugins: { jsx: true }
}

/*
  pseudo code for processing:
  1. find the marionette app name by looking for `new Marionette.App`
  // TODO: what if the app is reassigned to a new var?
  2. find any module definitions with .module(''), save to a map of locations
  3. find any uses of modules, save to a map of files that use it or something
  4. resolve all dependencies, warn about use of undefined modules
  5. add necessary require statements
*/

var isMarionetteApp = function(node) {
  var isExpression = node.type === 'MemberExpression'
  if (isExpression && node.object.name === 'Marionette' && node.property.name === 'Application' && node.parent.type === 'NewExpression') {
    // we're constructing a new app, return the name of the variable it's assigned to
    var varName
    if (node.parent.parent && node.parent.parent.type === 'VariableDeclarator') {
      varName = node.parent.parent.id.name
    }
    return varName
  }
  return false
}

var isMarionetteAppMemberExpression = function(node, appNames) {
  if (typeof appNames === 'string') appNames = [appNames]
  if (node.type === 'MemberExpression') {
    // accessing a property of an object.
    // if we're accessing a Marionette object, check if this is a module.
    var objectName = node.object.name
    if (!objectName) {
      // node could be (MyApp || {}).something, in which case I believe there will be a `left` and `right` entry on node.object.
      // TODO: need to verify that this is the only case that object.name would be undefined.
      if (~appNames.indexOf(node.object.left)) return true
      if (~appNames.indexOf(node.object.right)) return true
    }
    return ~appNames.indexOf(objectName)
  }
}

var marionetteModuleDefinition = function(node, appNames) {
  // TODO: I think we can just set properties on the variable assigned to the result of MyApp.module, we should handle that here.
  if (node.type === 'FunctionExpression' && node.parent.type === 'CallExpression') {
    if (isMarionetteAppMemberExpression(node.parent.callee, appNames)) {
      if (node.parent.callee.property.name === 'module') {
        // found a module constructor
        // the module name is the first argument to MyApp.module()
        var moduleName = node.parent.arguments[0].value
        var moduleVar, appVar
        if (node.params[0]) {
          // the moduleVar is what stores the properties of this module, and roughly translates to `module.exports` in CommonJS.
          moduleVar = node.params[0].name
        }
        if (node.params[1]) {
          // the app var is the current var used for the app name.
          appVar = node.params[1].name
        }
        // TODO: using `this` inside of this method is also an acceptable way to set properties. Handle that as well if we need any information about the properties of this module.
        return {module: moduleVar, app: appVar, name: moduleName}
      }
    }
  }
}

var getModuleVars = function(node, appName) {
  var moduleVar, appVar
  var currentNode = node
  while (!moduleVar) {
    // got to the root, skip the rest.
    if (!currentNode.parent) return {}
    var info = marionetteModuleDefinition(currentNode, appName)
    currentNode = currentNode.parent
    if (info) {
      moduleVar = info.module
      appVar = info.app
    }
  }
  return {
    moduleVar: moduleVar,
    appVar: appVar
  }
}

var findModuleNodes = function(node, appName, fn) {
  var moduleVars = getModuleVars(node, appName)
  var moduleVar = moduleVars.moduleVar
  var appVar = moduleVars.appVar
  if (!appVar) return
  if (isMarionetteAppMemberExpression(node.parent, [appName, appVar])) {
    // if this is a call expression and the method is 'module', we're invoking a marionette module.
    // TODO: marionette allows access of modules by just accessing the module name on App, which is set on the prototype.
    // Not sure what the best path is for figuring out when these properties are in fact modules, I suppose we can see if there's a type that looks right.
    // We'll need to resolve this before this tool will be accurate.
    if (node.parent.parent.type === 'CallExpression' && node.parent.property.name === 'module') {
      var args = node.parent.parent.arguments
      if (args.length === 1) {
        // we're not defining a new module, so we're accessing one.
        var moduleDef = args[0]
        if (moduleDef.type === 'Literal') {
          var moduleName = args[0].value
          var def, cNode = node
          while (!def) {
            if (cNode.type === 'CallExpression') {
              def = cNode
            }
            cNode = cNode.parent
          }
          fn(moduleName, def)
        } else {
          //TODO: If we don't have the module name, we'll need to figure out how to calculate it using the expression. Not sure what the right approach there is.
          console.warn('Found unresolved module access:', moduleDef)
        }
      } else {
        // here's where we'd end up if we found App.module('name', anotherArgument).
        // TODO: make sure that we can't access modules by doing the above.
      }
    }
  }
  return moduleVar
}

var accessedMarionetteModules = function(node, appName) {
  var modules = []
  var moduleVar = findModuleNodes(node, appName, function(moduleName) {
    modules.push(moduleName)
  })
  return {module: moduleVar, modules: modules}
}

var processFileDependencies = function(file, appName) {
  var isApp = false
  var contents = fs.readFileSync(file, 'utf8')
  var needsRequire = []
  // figure out our top level requires
  falafel(contents, falafelOpts, scoped(function(scope, node) {
    needsRequire = needsRequire.concat(scope.uses.filter(function(variable) {
      // not a native global, we need to require this.
      return eval('typeof ' + variable.name) === 'undefined'
    }).map(function(v) { return v.name }))
  }))
  // FIXME: if we have an app name should we keep checking for definitions?
  // find our app name
  falafel(contents, falafelOpts, function(node) {
     var nodeAppName = isMarionetteApp(node)
     if (nodeAppName) {
       if (appName) throw new Error('Multiple app definitions (' + appName + ', ' + nodeAppName + ') found. Unable to calculate dependencies.')
       appName = nodeAppName
       isApp = true
       console.log('found application definition: ', appName)
     }
   })
   if (!appName) throw new Error('No Marionette app found.')
  // now figure out what marionette modules we're using
  var definedModules = {}
  var accessedModules = {}
  var out = falafel(contents, falafelOpts, function(node) {
    var defined = marionetteModuleDefinition(node, appName)
    if (defined) {
      console.log('found module definition for', defined.name)
      definedModules[defined.name] = definedModules[defined.name] || []
      definedModules[defined.name].push(file)
    }
    var accessed = accessedMarionetteModules(node, appName)
    if (accessed && accessed.modules.length) {
      accessed.modules.forEach(function(module) {
        accessedModules[module] = accessedModules[module] || []
        accessedModules[module] = accessedModules[module].concat(file)
      })
    }
  })
  console.log('global dependencies -> ', needsRequire)
  console.log('module dependencies -> ', Object.keys(accessedModules))
  return {
    isApp: isApp,
    app: appName,
    global: needsRequire,
    defined: definedModules,
    accessed: accessedModules
  }
}

var appName, appFile
var definedModules = {}
var moduleFiles = {}
var accessedModules = {}
var fileDependencies = {}
var globalModules = {}
var transformedFiles = {}

var resolveFileDependencies = function(file) {
  console.log('------------- resolving ' + path.relative(process.cwd(), file) + ' ---------------------')
  var globalDependencies = globalModules[file].reduce(function(o, dep) {
    if (dep === appName) {
      o[dep] = appFile
    } else if (globalModuleMap[dep]) {
      o[dep] = globalModuleMap[dep]
    } else {
      console.warn('WARNING: unknown module ' + dep + ', a require statement will not be generated and this variable must be global.')
    }
    return o
  }, {})

  var dependencies = fileDependencies[file]
  var moduleImports = {}
  if (dependencies) {
    // this file has module dependencies
    dependencies.forEach(function(moduleName) {
      // TODO: figure out what to do with self-referencing modules, I believe this is because modules can be defined in multiple places.
      // this will mean we'll need to figure out who is defining the file that contains the property we're after.
      var moduleDefinitionFiles = definedModules[moduleName]
      if (moduleDefinitionFiles.length > 1) {
        console.warn("WARNING: multiple definitions found for module" + moduleName +", resolution may be innacurate.")
      }
      moduleImports[moduleName] = moduleDefinitionFiles[0]
    })
  }

  var moduleVar
  var contents = fs.readFileSync(file, 'utf8')
  var output = falafel(contents, falafelOpts, function(node) {
    // TODO: replace any import commands with a reference to the module variable (from moduleImports)
    var foundModule = findModuleNodes(node, appName, function(moduleName, def) {
      def.update(moduleName)
    })
    if (foundModule) {
      // TODO: probably should verify that we're not defining multiple modules
      moduleVar = foundModule
    }
  })

  // define modules as vars, and move the content of their closures to the level above.
  output = falafel(String(output), falafelOpts, function(node) {
    var moduleDef = marionetteModuleDefinition(node, appName)
    if (moduleDef) {
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
      newContent.unshift('var ' + moduleVar + ' = {};')
      newContent = newContent.join('\n')
      expression.update(newContent)
    }
  })

  output = String(output)
  // add all our imports to the top of the file.
  // TODO: add module imports
  output = addImports(file, output, loaderName, moduleImports)
  // add the global imports
  output = addImports(file, output, loaderName, globalDependencies)
  // finally, export our module
  output = addExport(output, loaderName, moduleVar)
  return output
}

var addImports = function(file, contents, type, imports) {
  switch (type) {
    case 'commonjs':
      var lines = contents
        .split('\n')
      var importNames = Object.keys(imports)
      if (importNames.length) {
        console.log('adding imports:')
        importNames.forEach(function(varName) {
          var dependencyPath = imports[varName]
          // resolve relative or absolute paths, otherwise we assume this is available by name.
          if (/^[\/\.]/.test(dependencyPath)) {
            dependencyPath = path.relative(file, dependencyPath)
            dependencyPath = dependencyPath.replace(/\.js$/, '')
          }
          var importStatement = 'var ' + varName + " = require('" + dependencyPath + "');"
          lines.unshift(importStatement)
          console.log(importStatement)
        })
      } else {
        console.log('no dependencies found.')
      }
      return lines.join('\n')
    default:
      throw new Error('Unsupported module loader ' + type)
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
      throw new Error('Unsupported module loader ' + type)
  }
}

finder.on('end', function() {
  console.log('--------------------- COMPLETED ---------------------------------')
  console.log("Application: ", appName)
  var definedKeys = Object.keys(definedModules)
  console.log("Defined Modules: ", definedKeys)
  var accessedKeys = Object.keys(accessedModules)
  console.log("Accessed Modules: ", accessedKeys)
  var unusedModules = definedKeys.filter(function(k) { return !accessedModules[k] })
  var undefinedModules = accessedKeys.filter(function(k) { return !definedModules[k] })
  console.log("Unused modules: ", unusedModules)
  console.log("Undefined modules: ", undefinedModules)

  // resolve our dependencies

  // first, resolve and update the main app file
  console.log('------------------- updating app file ----------------------------')
  var contents = fs.readFileSync(appFile, 'utf8')
  transformedFiles[appFile] = addExport(contents, loaderName, appName)
  // resolve our app file's dependencies (if any)
  transformedFiles[appFile] = resolveFileDependencies(appFile)
  // for each file that defines a module, resolve it's dependencies
  Object.keys(moduleFiles).forEach(function(file) {
    transformedFiles[file] = resolveFileDependencies(file)
    // TODO: make this switch happen based on something
    if (true) {
      fs.writeFileSync(file, transformedFiles[file])
    }
  })
})

finder.on('file', function (file, stat) {
  if (!/(\/|^)(adcreation)?-?app\.js$/.test(file)) return
  if (!~extensions.indexOf(path.extname(file))) return
  console.log('------------------------------------------------------------------------')
  console.log('processing ' + file)
  file = path.resolve(process.cwd(), file)

  try {
    var o = processFileDependencies(file, appName)
    if (o) {
      if (o.app) appName = o.app
      if (o.isApp) appFile = file
      Object.keys(o.defined).forEach(function(d) {
        definedModules[d] = definedModules[d] || []
        var files = o.defined[d]
        files.forEach(function(file) {
          definedModules[d].push(file)
          moduleFiles[file] = moduleFiles[file] || []
          moduleFiles[file].push(d)
        })
      })
      Object.keys(o.accessed).forEach(function(d) {
        accessedModules[d] = accessedModules[d] || []
        var files = o.accessed[d]
        files.forEach(function(file) {
          accessedModules[d].push(file)
          fileDependencies[file] = fileDependencies[file] || []
          fileDependencies[file].push(d)
        })
      })
      globalModules[file] = o.global
    }
  } catch(e) {
    console.error('failed processing file ' + file + ':')
    console.error(e.message)
    console.log(e.stack)
  }
})

finder.on('directory', function (dir, stat, stop) {
  var base = path.basename(dir)
  // this is how we'd ignore common files:
  if (base === '.git' || base === 'node_modules') {
    stop()
  } else {
    // console.log('entering ' + dir + '/')
  }
})
