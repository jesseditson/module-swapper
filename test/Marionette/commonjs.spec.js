var assert = require('assert')
var debug = require('debug')('marionette-test')
var moduleSwapper = require('../..')

var opts = function(fixture, o) {
  var base = {
    dir: __dirname + '/fixtures/' + fixture,
    logger: debug,
    loader: 'commonjs'
  }
  for (var opt in o) {
    base[opt] = o[opt]
  }
  return base
}

var assertContainsLine = function(file, line) {
  var lines = file.split('\n').map(function(s) { return s.trim() })
  assert(~lines.indexOf(line), 'Failed to find ' + line + ' in:\n' + lines.join('\n'))
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

  describe("basic app (using App.module('name') syntax)", function() {

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

    it ('should import the right modules and replace the module calls', function(done) {
      moduleSwapper(opts('basic'), function(err, files) {
        assert.ifError(err)
        for (var f in files) {
          if (isFile(f, 'module.js')) {
            assertContainsLine(files[f], "var App = require('./app');")
          } else if (isFile(f, 'module2.js')) {
            assertContainsLine(files[f], "var App = require('./app');")
            assertContainsLine(files[f], "var MyModuleName = require('./module');")
            assertContainsLine(files[f], 'var anotherModule = MyModuleName')
          }
        }
        done()
      })
    })

  })

  describe('an app with multiple modules with the same name', function() {

    it ('should properly calculate module dependencies', function(done) {
      moduleSwapper(opts('multipleDefinitions'), function(err, files) {
        assert.ifError(err)
        for (var f in files) {
          if (isFile(f, 'module3.js')) {
            assertContainsLine(files[f], "var App = require('./app');")
            assertContainsLine(files[f], "var MyModuleName = require('./module2');")
            assertContainsLine(files[f], "var MyModuleName2 = require('./module');")
            assertContainsLine(files[f], 'var aFunction = MyModuleName.someFunction')
            assertContainsLine(files[f], 'var aProp = MyModuleName2.aProperty')
          }
        }
        done()
      })
    })

  })

})
