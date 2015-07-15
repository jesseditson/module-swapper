# module-swapper
A tool for swapping module loading systems on large codebases.


#Marionette

- all modules must be created using the `.module` function

*good*
```javascript
App.module('MyModule', function(Module) {
  // definition
  Module.prop = 'whatever'
})
```

*bad*
```javascript
var thing = App.module('MyModule')
thing.prop = whatever
```

- all modules must define a module parameter during creation

*good*
```javascript
App.module('MyModule', function(Module) {
  // definition
})
```

*bad*
```javascript
App.module('MyModule', function() {
  // definition
})
```

- all module properties must be set on a parameter

*good*
```javascript
App.module('MyModule', function(Module) {
  Module.myProperty = 'whatever'
})
```

*bad*
```javascript
App.module('MyModule', function() {
  this.myProperty = 'whatever'
})
```

- all modules must be accessed via the `.module` function:

*good*
```javascript
var MyModule = App.module('MyModule')
```

*bad*
```javascript
var MyModule = App.MyModule
```

- modules must be accessed as they are defined:

*good*
```javascript
// if defined as
App.module('Thing.One', function() { })
// must be accessed as
var ThingOne = App.module('Thing.One')
```

*bad*
```javascript
var ThingOne = App.module('Thing').One
```
