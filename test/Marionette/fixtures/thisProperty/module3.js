App.module('SomeModule', function() {
  var MyModuleName = App.module('MyModuleName')

  var prop = MyModuleName.aProperty
  var aFunction = MyModuleName.someFunction
  var anotherProp = MyModuleName.property2
})
