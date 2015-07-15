var falafel = require('falafel')
var moduleName = require('./moduleName')
var getModuleVars = require('./getModuleVars')
var getModuleName = require('./getModuleName')
var marionetteModuleDefinition = require('./marionetteModuleDefinition')

/**
 * findModulePropertyAccess: analyzes a block of javascript and determines what modules and properties we're using.
 * optionally calls back a function for any node that accessed a property.
 */
var findModulePropertyAccess = function(contents, varMap, opts) {
  var moduleVars = {}
  // if this is a string, set it to the root (true indicates that this is the original module name)
  if (typeof varMap === 'string') {
    moduleVars.moduleVar = varMap
    var o = {}
    o[varMap] = true
    varMap = o
  }
  if (!varMap) {
    varMap = {}
  }
  opts = opts || {}
  var modules = {}
  var declarations = {}
  var mapCount = Object.keys(varMap).length
  var variableProperties = {}
  var properties = {}
  var appVars = []

  var definedModuleProperties = []
  if (opts.appName) appVars.push(opts.appName)
  // first, build our map of module access
  contents = falafel(contents, this.falafelOpts, function(node) {
    if (opts.appName && !Object.keys(moduleVars).length) {
      moduleVars = getModuleVars(node, opts.appName)
      if (moduleVars.appVar) {
        appVars.push(moduleVars.appVar)
      }
    }
    if (node.type === 'VariableDeclaration') {
      node.declarations.forEach(function(dec) {
        if (!dec.init) return
        var accessed = moduleName(dec.init, varMap, appVars)
        var name = dec.init.name || (accessed && accessed.name)
        if (name && !varMap[name]) {
          modules[name] = modules[name] || []
          modules[name].push({
            start: dec.start,
            end: dec.end
          })
          varMap[name] = true
        }
        if ((varMap && varMap[dec.init.name]) || accessed) {
          if (!varMap[dec.id.name]) varMap[dec.id.name] = name
          if (opts.reassignmentFn) {
            opts.reassignmentFn(dec.id.name, name, varMap[name] === true, dec.init)
          }
        }
      })
    }
  })
  contents = String(contents)
  // if we've changed the var map, run the tree again to make sure we have the full map.
  if (Object.keys(varMap).length > mapCount) return findModulePropertyAccess.call(this, contents, varMap, opts)
  if (opts.reassignmentFn) return String(contents)
  // now that we have the mappings for all the variables, find the property access
  var out = falafel(String(contents), this.falafelOpts, function(node) {

    if (node.type === 'MemberExpression' && moduleVars.moduleVar && node.object.name === moduleVars.moduleVar) {
      if (node.parent.type === 'AssignmentExpression') {
        definedModuleProperties.push(node.property.name)
      }
    }

    if (node.type === 'MemberExpression' && node.object.type === 'ThisExpression') {
      var info, currentNode = node
      while (currentNode && !info) {
        if (currentNode.type === 'BlockStatement') {
          var info = marionetteModuleDefinition(currentNode.parent, appVars)
          if (info && info.module === moduleVars.moduleVar) {
            // we've defined something on the `this` scope of a module.
            definedModuleProperties.push(node.property.name)
            // This always updates - is that ok?
            node.object.update(info.module)
          }
          break
        }
        currentNode = currentNode.parent
      }
    }

    var which = moduleName(node.object, varMap, appVars)
    if (node.object && which) {
      var name = getModuleName(which.name, varMap)
      if (~appVars.indexOf(name) || name === moduleVars.moduleVar) return
      if (!which.declared) {
        modules[name] = modules[name] || []
        modules[name].push({
          start: which.start,
          end: which.end
        })
        if (opts.propertyFn) {
          opts.propertyFn(node.property.name, node.object, which, varMap)
        }
        variableProperties[which.name] = variableProperties[which.name] || []
        variableProperties[which.name].push(node.property.name)
        properties[name] = properties[name] || []
        properties[name].push(node.property.name)
      } else {
        declarations[name] = declarations[name] || []
        declarations[name].push(node.property.name)
      }
    }
  })
  if (opts.propertyFn) {
    return String(out)
  } else {
    return {
      modules: modules,
      moduleMap: varMap,
      properties: properties,
      variableProperties: variableProperties,
      declarations: declarations,
      defined: definedModuleProperties
    }
  }
}

module.exports = findModulePropertyAccess
