/**
 * isMarionetteApp: determines if a node is creating a new marionette app, and returns it's name if so.
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

module.exports = isMarionetteApp
