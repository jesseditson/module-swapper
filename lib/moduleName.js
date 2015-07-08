moduleName = function(node, map, appNames) {
  if (!node) return
  if (typeof map === 'string') {
    var o = {}
    o[map] = true
    map = o
  } else if (map && Object.keys(map).length === 0) {
    map = null
  }
  var nodeName
  if (node.type === 'CallExpression' && node.callee.property.name === 'module') {
    var args = node.arguments
    var moduleDef = args[0]
    if (moduleDef.type === 'Literal') {
      var moduleName = args[0].value
      if (!map || map[moduleName]) {
        nodeName = moduleName
      }
    } else {
      // FIXME: need to resolve access of non-literals
      throw new Error('Cannot analyze non-literal module definition ' + node.parent.source() + '.')
    }
  } else {
    // console.log(node.type, map, node.property && node.property.name, node.object && node.object.name)
    if (node.type === 'Identifier' && (!map || map[node.name])) {
      nodeName = node.name
    } else if (node.type === 'MemberExpression' && (!map || map[node.property.name]) && ~appNames.indexOf(node.object.name)) {
      nodeName = node.property.name
    } else if (appNames && node.type === 'MemberExpression' && ~appNames.indexOf(node.object.name)) {
      // we're accessing a property of the app, return it as a module.
      nodeName = node.property.name
    }
  }
  if (nodeName) {
    return {
      name: nodeName,
      start: node.start,
      end: node.end
    }
  }
}

module.exports = moduleName
