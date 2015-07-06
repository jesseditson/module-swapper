var falafel = require('falafel')
var moduleName = require('./moduleName')

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
  var definitions = {}
  var mapCount = Object.keys(varMap).length
  // first, build our map of module access
  contents = falafel(contents, this.falafelOpts, function(node) {
    if (node.type === 'VariableDeclaration') {
      node.declarations.forEach(function(dec) {
        var accessed = moduleName(dec.init, varMap)
        if (accessed && !varMap[dec.init.name]) {
          varMap[accessed.name] = true
        }
        if ((varMap && varMap[dec.init.name]) || accessed) {
          var name = accessed ? accessed.name : dec.init.name
          varMap[dec.id.name] = name
          definitions[name] = definitions[name] || []
          definitions[name].push({
            start: accessed ? accessed.start : node.start,
            end: accessed ? accessed.end : node.end
          })
          if (opts.reassignmentFn) {
            opts.reassignmentFn(dec.id.name, name, varMap[name] === true, dec.init)
          }
        }
      })
    }
  })
  // if we've changed the var map, run the tree again to make sure we have the full map.
  if (Object.keys(varMap).length > mapCount) return findModulePropertyAccess.call(this, contents, varMap, opts)
  if (opts.reassignmentFn) return String(contents)
  // now that we have the mappings for all the variables, find the property access
  var properties = {}
  var out = falafel(String(contents), this.falafelOpts, function(node) {
    var which = moduleName(node.object, varMap)
    if (node.object && which) {
      if (opts.propertyFn) {
        opts.propertyFn(node.property.name, node.object, which, varMap)
      }
      properties[which.name] = properties[which.name] || []
      properties[which.name].push(node.property.name)
      definitions[which.name] = definitions[which.name] || []
      definitions[which.name].push({
        start: which.start,
        end: which.end
      })
    }
  })
  if (opts.propertyFn) {
    return String(out)
  } else {
    return {
      definitions: definitions,
      moduleMap: varMap,
      properties: properties
    }
  }
}

module.exports = findModulePropertyAccess
