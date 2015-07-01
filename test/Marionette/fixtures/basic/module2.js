App.module('AnotherModule', function(AnotherModule, MyApp) {
  AnotherModule.someFunction = function() {
    // something
    var anotherModule = MyApp.module('MyModuleName')
  }
})
