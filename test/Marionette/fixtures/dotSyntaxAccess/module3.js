App.module('SomeModule', function(Module, MyApp) {
  var theModule = MyApp.MyModuleName
  var prop = MyApp.MyModuleName.aProperty
  var aFunction = theModule.someFunction
  var reassigned = theModule
  var aProp = reassigned.aProperty
})
