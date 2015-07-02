App.module('SomeModule', function(Module, MyApp) {
  var theModule = MyApp.module('MyModuleName')
  var prop = MyApp.module('MyModuleName').aProperty
  var aFunction = theModule.someFunction
  var reassigned = theModule
  var aProp = reassigned.aProperty
})
