App.module('SomeModule', function(Module, MyApp) {
  var theModule = MyApp.module('MyModule.Name')
  var prop = MyApp.module('MyModule.Name').aProperty
  var aFunction = theModule.someFunction
  var reassigned = theModule
  var aProp = reassigned.aProperty
})
