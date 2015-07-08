var falafel = require('falafel')
var moduleName = require('./moduleName')
var getModuleVars = require('./getModuleVars')
var getModuleName = require('./getModuleName')

/**
 * findModulePropertyAccess: analyzes a block of javascript and determines what modules and properties we're using.
 * optionally calls back a function for any node that accessed a property.
 */
var findModulePropertyAccess = function(contents, varMap, opts) {
  // if this is a string, set it to the root (true indicates that this is the original module name)
  if (typeof varMap === 'string') {
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
  var moduleVars = {}
  var variableProperties = {}
  var appVars = []
  if (opts.appName) appVars.push(opts.appName)
  // first, build our map of module access
  contents = falafel(contents, this.falafelOpts, function(node) {
    if (opts.appName && !Object.keys(moduleVars).length) {
      moduleVars = getModuleVars(node, opts.appName)
      if (moduleVars.appVar) appVars.push(moduleVars.appVar)
    }
    if (node.type === 'VariableDeclaration') {
      node.declarations.forEach(function(dec) {
        var accessed = moduleName(dec.init, varMap, appVars)
        if (accessed && !varMap[dec.init.name || accessed.name]) {
          varMap[accessed.name] = true
        }
        if ((varMap && varMap[dec.init.name]) || accessed) {
          var name = accessed ? accessed.name : dec.init.name
          varMap[dec.id.name] = name
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
  var properties = {}
  var out = falafel(String(contents), this.falafelOpts, function(node) {
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
      declarations: declarations
    }
  }
}

module.exports = findModulePropertyAccess
