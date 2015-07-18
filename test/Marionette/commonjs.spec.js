var assert = require('assert')
var path = require('path')
var debug = require('debug')('marionette-test')
var moduleSwapper = require('../..')

var fixtureBase = __dirname + '/fixtures/'

var diff
if (~process.argv.indexOf('--diff')) {
  diff = require('../../diff')
}

var opts = function(fixture, o) {
  var base = {
    dir: fixtureBase + fixture,
    logger: debug,
    loader: 'commonjs'
  }
  for (var opt in o) {
    base[opt] = o[opt]
  }
  return base
}

var containsLine = function(file, line) {
  var lines = file.split('\n').map(function(s) { return s.trim() })
  return !!~lines.indexOf(line)
}

var assertNotContainsLine = function(file, line) {
  assert(!containsLine(file, line), 'Found unexpected line ' + line + ' in:\n' + file)
}

var assertContainsLine = function(file, line) {
  assert(containsLine(file, line), 'Failed to find ' + line + ' in:\n' + file)
}

var assertContainsFile = function(files, file) {
  files = Object.keys(files).map(function(f) {
    return f.split('/').slice(-1)[0]
  })
  assert(~files.indexOf(file), 'Expected to find file ' + file + ' in ' + files)
}

var assertContainsFiles = function(files, find) {
  find.forEach(function(f) { assertContainsFile(files, f) })
}

var isFile = function(input, name) {
  var p = new RegExp(name.replace('.','\\.') + '$', 'i')
  return p.test(input)
}

describe('Marionette modules -> commonjs', function() {

  it('should fail if an app is not found.', function(done) {
    moduleSwapper(opts('basic', {fileFilter: /module\.js/}), function(err) {
      assert(err)
      assert.equal(err.message, 'No Marionette app found.')
      done()
    })
  })

  describe("app using App.module('name') syntax", function() {

    it('should process all files', function(done) {
      moduleSwapper(opts('basic'), function(err, files) {
        assert.ifError(err)
        var fileNames = Object.keys(files)
        assert.equal(fileNames.length, 3)
        done()
      })
    })

    it('should properly export the app and module names.', function(done) {
      moduleSwapper(opts('basic'), function(err, files) {
        assert.ifError(err)
        assertContainsFiles(files, ['app.js', 'module.js', 'module2.js'])
        for (var f in files) {
          if (isFile(f, 'app.js')) {
            assertContainsLine(files[f], 'module.exports = App;')
          } else if (isFile(f, 'module.js')) {
            assertContainsLine(files[f], 'module.exports = Module;')
          } else if (isFile(f, 'module2.js')) {
            assertContainsLine(files[f], 'module.exports = AnotherModule;')
          }
        }
        done()
      })
    })

    it('should import the right modules and replace the module calls', function(done) {
      moduleSwapper(opts('basic'), function(err, files, inFiles) {
        assert.ifError(err)
        assertContainsFiles(files, ['app.js', 'module.js', 'module2.js'])
        for (var f in files) {
          if (isFile(f, 'module.js')) {
            assertContainsLine(files[f], "var App = require('./app');")
          } else if (isFile(f, 'module2.js')) {
            assertContainsLine(files[f], "var App = require('./app');")
            assertContainsLine(files[f], "var MyModuleName = require('./module');")
            assertContainsLine(files[f], 'var anotherModule = MyModuleName')
          }
        }
        if (diff) diff(inFiles, files, fixtureBase)
        done()
      })
    })

  })

  describe('an app that defines properties on app', function() {

    it ('should be able to access those properties when accessing app by the curried var', function(done) {
      moduleSwapper(opts('appRedefinition'), function(err, files, inFiles) {
        assert.ifError(err)
        assertContainsFiles(files, ['app.js', 'module.js'])
        for (var f in files) {
          if (isFile(f, 'module.js')) {
            assertContainsLine(files[f], "var App = require('./app');")
            assertContainsLine(files[f], "var test = App.someProp")
          }
        }
        if (diff) diff(inFiles, files, fixtureBase)
        done()
      })
    })
  })

  describe('an app with multiple modules with the same name', function() {

    it ('should use the correct version of the file based on what properties were accessed', function(done) {
      moduleSwapper(opts('multipleDefinitions'), function(err, files, inFiles) {
        assert.ifError(err)
        assertContainsFiles(files, ['app.js', 'module.js', 'module2.js', 'module3.js'])
        for (var f in files) {
          if (isFile(f, 'module2.js')) {
            // make sure we're not importing twice
            assertNotContainsLine(files[f], "var MyModuleName2 = require('./module');")
          } else if (isFile(f, 'module3.js')) {
            assertContainsLine(files[f], "var App = require('./app');")
            assertContainsLine(files[f], "var MyModuleName = require('./module2');")
            assertContainsLine(files[f], "var MyModuleName2 = require('./module');")
            assertContainsLine(files[f], 'var aFunction = MyModuleName.someFunction')
            assertContainsLine(files[f], 'var aProp = MyModuleName2.aProperty')
          }
        }
        if (diff) diff(inFiles, files, fixtureBase)
        done()
      })
    })

    it('should correctly calculate the dependency if the module was assigned to a variable', function(done) {
      moduleSwapper(opts('multipleDefinitionsComplex'), function(err, files, inFiles) {
        assert.ifError(err)
        assertContainsFiles(files, ['app.js', 'module.js', 'module2.js', 'module3.js'])
        for (var f in files) {
          if (isFile(f, 'module2.js')) {
            // make sure we're not importing twice
            assertNotContainsLine(files[f], "var MyModuleName2 = require('./module');")
          } else if (isFile(f, 'module3.js')) {
            assertContainsLine(files[f], "var App = require('./app');")
            assertContainsLine(files[f], "var MyModuleName = require('./module');")
            assertContainsLine(files[f], "var MyModuleName2 = require('./module2');")
            assertContainsLine(files[f], "var theModule = MyModuleName")
            assertContainsLine(files[f], 'var aFunction = MyModuleName2.someFunction')
            assertContainsLine(files[f], 'var aProp = MyModuleName.aProperty')
          }
        }
        if (diff) diff(inFiles, files, fixtureBase)
        done()
      })
    })

  })

})
