moduleName = function(node, map) {
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
  } else if (node.name && (!map || map[node.name])) {
    nodeName = node.name
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
