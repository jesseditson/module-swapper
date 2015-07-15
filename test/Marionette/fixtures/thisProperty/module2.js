App.module('MyModuleName', function(Module, MyApp) {
  Module.someFunction = function() {
    // reference to missing property defined in another module
    var someProp = MyApp.module('MyModuleName').aProperty
  }
  var self = this
  self.property2 = 'selfprop'
})
