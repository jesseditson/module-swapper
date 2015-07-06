var isMarionetteAppMemberExpression = require('./isMarionetteAppMemberExpression')

/**
 * marionetteModuleDefinition: gets information about the scope of a marionette module definition
 * returns an object with the module varaible, the app variable, and the name of the module.
 */
var marionetteModuleDefinition = function(node, appNames) {
  // TODO: I think we can just set properties on the variable assigned to the result of MyApp.module, we should handle that here.
  if (node.type === 'FunctionExpression' && node.parent.type === 'CallExpression') {
    if (isMarionetteAppMemberExpression(node.parent.callee, appNames)) {
      if (node.parent.callee.property.name === 'module') {
        // found a module constructor
        // the module name is the first argument to MyApp.module()
        var moduleName = node.parent.arguments[0].value
        var moduleVar, appVar
        if (node.params[0]) {
          // the moduleVar is what stores the properties of this module, and roughly translates to `module.exports` in CommonJS.
          moduleVar = node.params[0].name
        }
        if (node.params[1]) {
          // the app var is the current var used for the app name.
          appVar = node.params[1].name
        }
        // TODO: using `this` inside of this method is also an acceptable way to set properties. Handle that as well if we need any information about the properties of this module.
        return {module: moduleVar, app: appVar, name: moduleName}
      }
    }
  }
}

module.exports = marionetteModuleDefinition
