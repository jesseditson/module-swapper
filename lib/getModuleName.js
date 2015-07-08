var getModuleName = function(module, moduleMap) {
  while(typeof moduleMap[module] === 'string') {
    module = moduleMap[module]
  }
  return module
}

module.exports = getModuleName
