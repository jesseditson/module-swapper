moduleName = function(node, map, appNames, allowAccess) {
  if (!node) return
  if (typeof map === 'string') {
    var o = {}
    o[map] = true
    map = o
  } else if (map && Object.keys(map).length === 0) {
    map = null
  }
  var nodeName
  var declared
  if (node.type === 'CallExpression' && node.callee.property && node.callee.property.name === 'module') {
    var args = node.arguments
    var moduleDef = args[0]
    var newAssignment = node.parent.parent.type === 'AssignmentExpression' && node.parent.parent.parent.type === 'VariableDeclaration'
    declared = newAssignment || node.parent.parent.type === 'NewExpression'
    if (moduleDef.type === 'Literal') {
      var moduleName = args[0].value
      if (!map || map[moduleName]) {
        nodeName = moduleName
      }
    } else {
      // FIXME: need to resolve access of non-literals
      throw new Error('Cannot analyze non-literal module definition ' + node.parent.source() + '.')
    }
  } else if (map && allowAccess && node.parent.type === 'MemberExpression') {
    var name = node.parent.object.name
    if (map[name]) {
      nodeName = name
    }
  }
  if (nodeName) {
    // console.log('moduleName node', node.parent.source(), declared, node.parent.type, node.type)
    return {
      declared: declared,
      name: nodeName,
      start: node.start,
      end: node.end
    }
  }
}

module.exports = moduleName
