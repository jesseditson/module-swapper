var marionetteModuleDefinition = require('./marionetteModuleDefinition')

/**
 * getModuleVars: retrieves the defined module name and app name for inside of a marionette module scope
**/
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

module.exports = getModuleVars
