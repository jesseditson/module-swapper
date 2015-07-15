var isMarionetteAppMemberExpression = require('./isMarionetteAppMemberExpression')

/**
 * findModuleNodes: finds access of marionette modules
 * given a node and an appName, returns the variable name the module being accessed (if any) from this node is being assigned to.
 * calls a callback for each node with the name of the module being accessed with the definition node.
**/
var findModuleNodes = function(node, appName, fn) {
  var moduleVars = getModuleVars(node, appName)
  var moduleVar = moduleVars.moduleVar
  var appVar = moduleVars.appVar
  if (!appVar) return
  if (isMarionetteAppMemberExpression(node.parent, [appName, appVar])) {
    // if this is a call expression and the method is 'module', we're invoking a marionette module.
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
          // TODO: need to resolve access of non-literals
          throw new Error('Cannot analyze non-literal module definition ' + node.parent.parent.source() + '.')
        }
      } else {
        // here's where we'd end up if we found App.module('name', anotherArgument).
        // TODO: make sure that we can't access modules by doing the above.
      }
    }
  }
  return moduleVar
}

module.exports = findModuleNodes
