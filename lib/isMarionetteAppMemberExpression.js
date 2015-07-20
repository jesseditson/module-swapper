/**
 * isMarionetteAppMemberExpression: checks if a node is a marionette member expression, returns true or false.
 * a node is a member expression if it is accessing a property of one of our app names.
 */
var isMarionetteAppMemberExpression = function(node, appNames) {
  if (typeof appNames === 'string') appNames = [appNames]
  appNames = appNames.filter(function(n) { return !!n })
  if (node.type === 'MemberExpression') {
    // accessing a property of an object.
    // if we're accessing a Marionette object, check if this is a module.
    var objectName = node.object.name
    if (node.object.type === 'LogicalExpression') {
      // node could be (MyApp || {}).something, in which case I believe there will be a `left` and `right` entry on node.object.
      // TODO: need to verify that this is the only case that object.name would be undefined.
      if (~appNames.indexOf(node.object.left.name)) return node.object.left
      if (~appNames.indexOf(node.object.right.name)) return node.object.right
    }
    return ~appNames.indexOf(objectName) ? node.object : false
  }
}

module.exports = isMarionetteAppMemberExpression
