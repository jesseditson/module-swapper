App.module('MyModule.Name', function(Module, MyApp) {
  Module.someFunction = function() {
    // reference to missing property defined in another module
    var someProp = MyApp.module('MyModule.Name').aProperty
  }
})
