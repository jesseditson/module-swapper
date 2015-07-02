var fs = require('fs')
var path = require('path')
var acorn = require('acorn-jsx')
var falafel = require('falafel')
var scoped = require('scoped')
var findit = require('findit')

module.exports = function(opts, callback) {

  var extensions, loaderName, globalModuleMap, falafelOpts, replaceInline, fileFilter, completedCallback, logger

  var fileContents = {}
  var getContents = function(n) { return fileContents[n] = fs.readFileSync(n, 'utf8') }

  var appName, appFile
  var definedModules = {}
  var moduleProperties = {}
  var moduleFiles = {}
  var accessedModules = {}
  var accessedProperties = {}
  var fileDependencies = {}
  var globalModules = {}
  var transformedFiles = {}

  logger = opts.logger || console.log
  extensions = opts.extensions || ['.js', '.jsx']
  loaderName = opts.loader || 'commonjs'
  globalModuleMap = opts.modules || {
    'Backbone': 'backbone',
    '$': 'jquery',
    'moment': 'moment',
    '_': 'underscore',
    'Marionette': 'marionette'
  }
  falafelOpts = opts.falafelOpts || {
    parser: acorn,
    ecmaVersion: 6,
    plugins: { jsx: true }
  }
  replaceInline = opts.replaceInline
  fileFilter = opts.fileFilter
  var finder = findit(opts.dir || '.')
  completedCallback = callback || function(err) {
    if (err) throw err
    process.exit(0)
  }

  finder.on('end', function() {
    if (!appName || !appFile) return completedCallback(new Error('No Marionette app found.'))
    logger('--------------------- COMPLETED ---------------------------------')
    logger("Application: ", appName)
    var definedKeys = Object.keys(definedModules)
    logger("Defined Modules: ", definedKeys)
    var accessedKeys = Object.keys(accessedModules)
    logger("Accessed Modules: ", accessedKeys.map(function(k) {
      return k + ' (' + accessedModules[k].reduce(function(a, info, idx) {
        if (info.property && !~a.indexOf(info.property)) a.push(info.property)
        return a
      }, []).join(', ') + ')'
    }))
    var unusedModules = definedKeys.filter(function(k) { return !accessedModules[k] })
    var undefinedModules = accessedKeys.filter(function(k) { return !definedModules[k] })
    logger("Unused modules: ", unusedModules)
    logger("Undefined modules: ", undefinedModules)

    // resolve our dependencies

    // first, resolve and update the main app file
    logger('------------------- updating app file ----------------------------')
    var contents = getContents(appFile)
    // resolve our app file's dependencies (if any)
    transformedFiles[appFile] = resolveFileDependencies(appFile, false)
    transformedFiles[appFile] = addExport(transformedFiles[appFile], loaderName, appName)
    // for each file that defines a module, resolve it's dependencies
    Object.keys(moduleFiles).forEach(function(file) {
      transformedFiles[file] = resolveFileDependencies(file, true)
      if (replaceInline) {
        fs.writeFileSync(file, transformedFiles[file])
      }
    })
    completedCallback(null, transformedFiles, fileContents)
  })

  var needsProcess = []
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
         appName = nodeAppName
         appFile = file
         logger('found application definition: ', appName)
       }
     })
     if (!appName) {
       // if we haven't found the app, just defer processing of this file.
       return needsProcess.push(file)
     } else if (needsProcess.length) {
       // if we have deferred any files and we found the app, process them now.
       var files = needsProcess
       needsProcess = []
       needsProcess.forEach(processFile)
     }

    logger('------------------------------------------------------------------------')
    logger('processing ' + file)

    try {
      var o = processFileDependencies(file, contents, appName)
      if (o) {
        globalModules[file] = o.global

        Object.keys(o.defined).forEach(function(d) {
          definedModules[d] = definedModules[d] || []
          var files = o.defined[d]
          files.forEach(function(file) {
            definedModules[d].push(file)
            moduleFiles[file] = moduleFiles[file] || []
            moduleFiles[file].push(d)
          })
        })
        Object.keys(o.properties).forEach(function(d) {
          moduleProperties[d] = moduleProperties[d] || {}
          var fileMap = o.properties[d]
          for (var file in fileMap) {
            moduleProperties[d][fileMap[file]] = file
          }
        })

        Object.keys(o.accessed).forEach(function(d) {
          accessedModules[d] = accessedModules[d] || []
          var infos = o.accessed[d]
          infos.forEach(function(file) {
            accessedModules[d].push(file)
            fileDependencies[file] = fileDependencies[file] || []
            fileDependencies[file].push({
              name: d,
              properties: o.accessedProperties[d]
            })
          })
        })
      }
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

  var findModulePropertyAccess = function(contents, varMap, fn) {
    // if this is a string, set it to the root (true indicates that this is the original module name)
    if (typeof varMap === 'string') {
      var o = {}
      o[varMap] = true
      varMap = o
    }
    var mapCount = Object.keys(varMap).length
    // first, build our map of module access
    falafel(contents, falafelOpts, function(node) {
      if (node.type === 'VariableDeclaration') {
        node.declarations.forEach(function(dec) {
          var accessed = nodeIsAccessingModule(dec.init, varMap)
          if (varMap[dec.init.name] || accessed) {
            varMap[dec.id.name] = accessed || dec.init.name
          }
        })
      }
    })
    // if we've changed the var map, run the tree again to make sure we have the full map.
    if (Object.keys(varMap).length > mapCount) return findModulePropertyAccess(contents, varMap, fn)
    // now that we have the mappings for all the variables, find the property access
    var properties = []
    var out = falafel(String(contents), falafelOpts, function(node) {
      if (node.object && nodeIsAccessingModule(node.object, varMap)) {
        if (fn) {
          fn(node.property.name, node.object, varMap)
        }
        properties.push(node.property.name)
      }
    })
    if (fn) {
      return String(out)
    } else {
      return uniq(properties)
    }
  }

  var nodeIsAccessingModule = function(node, map) {
    if (typeof map === 'string') {
      var o = {}
      o[map] = true
      map = o
    }
    if (node.type === 'CallExpression' && node.callee.property.name === 'module') {
      var args = node.arguments
      var moduleDef = args[0]
      if (moduleDef.type === 'Literal') {
        var moduleName = args[0].value
        if (map[moduleName]) {
          return moduleName
        }
      } else {
        // FIXME: need to resolve access of non-literals
        throw new Error('Cannot analyze non-literal module definition ' + node.parent.source() + '.')
      }
    } else if (node.name && map[node.name]) {
      return node.name
    }
  }

  // var findModuleNodes = function(node, appName, fn) {
  //   var moduleVars = getModuleVars(node, appName)
  //   var moduleVar = moduleVars.moduleVar
  //   var appVar = moduleVars.appVar
  //   if (!appVar) return
  //   if (isMarionetteAppMemberExpression(node.parent, [appName, appVar])) {
  //     // if this is a call expression and the method is 'module', we're invoking a marionette module.
  //     // TODO: marionette allows access of modules by just accessing the module name on App, which is set on the prototype.
  //     // Not sure what the best path is for figuring out when these properties are in fact modules, I suppose we can see if there's a type that looks right.
  //     // We'll need to resolve this before this tool will be accurate.
  //     if (node.parent.parent.type === 'CallExpression' && node.parent.property.name === 'module') {
  //       var args = node.parent.parent.arguments
  //       if (args.length === 1) {
  //         // we're not defining a new module, so we're accessing one.
  //         var moduleDef = args[0]
  //         if (moduleDef.type === 'Literal') {
  //           var moduleName = args[0].value
  //           var def, cNode = node
  //           while (!def) {
  //             if (cNode.type === 'CallExpression') {
  //               def = cNode
  //             }
  //             cNode = cNode.parent
  //           }
  //           fn(moduleName, def)
  //         } else {
  //           // TODO: need to resolve access of non-literals
  //           throw new Error('Cannot analyze non-literal module definition ' + node.parent.parent.source() + '.')
  //         }
  //       } else {
  //         // here's where we'd end up if we found App.module('name', anotherArgument).
  //         // TODO: make sure that we can't access modules by doing the above.
  //       }
  //     }
  //   }
  //   return moduleVar
  // }

  // var accessedMarionetteModules = function(node, appName) {
  //   var modules = []
  //   var moduleVar = findModuleNodes(node, appName, function(moduleName) {
  //     modules.push({name: moduleName})
  //   })
  //   return {module: moduleVar, modules: modules}
  // }

  var processFileDependencies = function(file, contents, appName) {
    var needsRequire = []
    // figure out our top level requires
    falafel(contents, falafelOpts, scoped(function(scope, node) {
      needsRequire = needsRequire.concat(scope.uses.filter(function(variable) {
        // not a native global, we need to require this.
        return eval('typeof ' + variable.name) === 'undefined'
      }).map(function(v) { return v.name }))
    }))
    // now figure out what marionette modules we're using
    var definedModules = {}
    var moduleVars = {}
    var moduleProperties = {}
    var accessedModules = {}
    var accessedProperties = {}
    falafel(contents, falafelOpts, function(node) {
      var defined = marionetteModuleDefinition(node, appName)
      if (defined) {
        logger('found module definition for', defined.name)
        definedModules[defined.name] = definedModules[defined.name] || []
        definedModules[defined.name].push(file)
        moduleVars[defined.module] = defined.name
      }
      var accessed = accessedMarionetteModules(node, appName)
      if (accessed && accessed.modules.length) {
        accessed.modules.forEach(function(info) {
          var module = info.name
          accessedModules[module] = accessedModules[module] || []
          accessedModules[module] = accessedModules[module].concat(file)
        })
      }
    })
    // look at all our member expressions, and if we are setting a property on a module we defined, add those properties to a list.
    falafel(contents, falafelOpts, function(node) {
      if (node.type === 'MemberExpression' && moduleVars[node.object.name]) {
        var moduleName = moduleVars[node.object.name]
        moduleProperties[moduleName] = moduleProperties[moduleName] || {}
        moduleProperties[moduleName][file] = moduleProperties[moduleName][file] || []
        moduleProperties[moduleName][file].push(node.property.name)
      }
    })
    Object.keys(accessedModules).forEach(function(moduleName) {
      accessedProperties[moduleName] = findModulePropertyAccess(contents, moduleName)
    })
    logger('global dependencies -> ', needsRequire)
    console.log(accessedModules, accessedProperties)
    logger('module dependencies -> ', Object.keys(accessedModules))
    return {
      global: needsRequire,
      defined: definedModules,
      accessed: accessedModules,
      properties: moduleProperties,
      accessedProperties: accessedProperties
    }
  }

  var resolveFileDependencies = function(file, addExports) {
    logger('------------- resolving ' + path.relative(process.cwd(), file) + ' ---------------------')
    var globalDependencies = globalModules[file].reduce(function(o, dep) {
      if (dep === appName) {
        o[dep] = appFile
      } else if (globalModuleMap[dep]) {
        o[dep] = globalModuleMap[dep]
      } else {
        logger('WARNING: unknown module ' + dep + ', a require statement will not be generated and this variable must be global.')
      }
      return o
    }, {})

    var contents = getContents(file)
    var dependencies = fileDependencies[file]
    var properties = accessedProperties[file]
    console.log(properties, accessedProperties)
    console.log('deps', fileDependencies[file])
    if (dependencies) {
      dependencies.forEach(function(info) {
        var moduleDefinitionFiles = definedModules[info.name]
        var fileProperties = moduleProperties[info.name]
        console.log(moduleDefinitionFiles)
      })
    }

    return contents

    var moduleImports = {}
    var moduleVars = {}
    if (dependencies) {
      // this file has module dependencies
      dependencies.forEach(function(info) {
        // TODO: figure out what to do with self-referencing modules, I believe this is because modules can be defined in multiple places.
        // this will mean we'll need to figure out who is defining the file that contains the property we're after.
        var moduleDefinitionFiles = definedModules[info.name]
        var fileProperties = moduleProperties[info.name]
        var moduleName = info.name

        var addImport = function(file, property) {
          if (moduleImports[moduleName]) {
            var p = /(\d)?$/
            var m = moduleName.match(p)
            // add or increment a trailing number if there's already a module being imported by this name.
            moduleName = moduleName.replace(p, parseInt(m[1] || '1', 10) + 1)
          }
          moduleVars[info.name] = moduleVars[info.name] || []
          moduleVars[info.name].push({
            name: moduleName,
            property: property
          })
          moduleImports[moduleName] = file
        }
        if (info.properties) {
          info.properties.forEach(function(prop) {
            var file = fileProperties[prop]
            // TODO: perhaps we should allow the user to select an option here instead of bailing?
            if (!file) {
              throw new Error('Found multiple modules by the same name (' +info.name+ '), but was unable to resolve the dependency based on accessed property ('+prop+').')
            } else {
              addImport(file, prop)
            }
          })
        } else {
          // FIXME: race condition or something causes this to be undefined. Fix & remove logging.
          if (!moduleDefinitionFiles) console.log('module definition files is undefined. defined modules: ', definedModules, 'info', info)
          if (moduleDefinitionFiles.length > 1) {
            // TODO: probably allow a user to select a file here too
            logger("WARNING: multiple definitions found for module " + moduleName +", but couldn't find enough prop info to determine which to use. resolution may be innacurate.")
          }
          addImport(moduleDefinitionFiles[0])
        }
      })
    }

    console.log(moduleImports, moduleVars)

    var moduleVar

    Object.keys(moduleVars).forEach(function(name) {
      var definitions = moduleVars[name]
      definitions.forEach(function(moduleInfo) {
        contents = findModulePropertyAccess(contents, name, function(prop, node) {
          if (moduleInfo.property === prop) {
            node.update(moduleInfo.name)
          }
        })
        console.log(contents)
      })
    })

    // define modules as vars, and move the content of their closures to the level above.
    var output = falafel(contents, falafelOpts, function(node) {
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
    output = addImports(file, output, loaderName, moduleImports)
    // add the global imports
    output = addImports(file, output, loaderName, globalDependencies)
    // finally, export our module
    if (addExports) {
      output = addExport(output, loaderName, moduleVar)
    }
    return output
  }

  var addImports = function(file, contents, type, imports) {
    switch (type) {
      case 'commonjs':
        var lines = contents
          .split('\n')
        var importNames = Object.keys(imports)
        if (importNames.length) {
          logger('adding imports:')
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
}
