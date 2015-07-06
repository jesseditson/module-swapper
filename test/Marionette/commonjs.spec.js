var assert = require('assert')
var path = require('path')
var debug = require('debug')('marionette-test')
var moduleSwapper = require('../..')

var fixtureBase = __dirname + '/fixtures/'

var jsdiff, diff
if (~process.argv.indexOf('--diff')) {
  require('colors')
  jsdiff = require('diff')
  diff = function(ifiles, ofiles, base) {
    // TODO: maybe use difflines?
    for (var f in ifiles) {
      var diff = jsdiff.diffLines(ifiles[f], ofiles[f])
      process.stderr.write(('\n---------- diff:\n' + path.relative(base, f)).yellow + '\n\n')
      diff.forEach(function(part){
        // green for additions, red for deletions
        // grey for common parts
        var color = part.added ? 'green' :
            part.removed ? 'red' : 'grey'
        var pre = part.added ? '+' : part.removed ? '-' : ' '
        String(part.value).split('\n').forEach(function(l) {
          if (l.length > 0) process.stderr.write(('' + pre + '   ' + l)[color] + '\n')
        })
      })
    }
  }
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
        var count = 0
        for (var f in files) {
          if (isFile(f, 'app.js')) {
            count++
            assertContainsLine(files[f], 'module.exports = App;')
          } else if (isFile(f, 'module.js')) {
            count++
            assertContainsLine(files[f], 'module.exports = Module;')
          } else if (isFile(f, 'module2.js')) {
            count++
            assertContainsLine(files[f], 'module.exports = AnotherModule;')
          }
        }
        assert.equal(count, 3, 'did not find required files.')
        done()
      })
    })

    it('should import the right modules and replace the module calls', function(done) {
      moduleSwapper(opts('basic'), function(err, files, inFiles) {
        var count = 0
        assert.ifError(err)
        for (var f in files) {
          if (isFile(f, 'module.js')) {
            count++
            assertContainsLine(files[f], "var App = require('./app');")
          } else if (isFile(f, 'module2.js')) {
            count++
            assertContainsLine(files[f], "var App = require('./app');")
            assertContainsLine(files[f], "var MyModuleName = require('./module');")
            assertContainsLine(files[f], 'var anotherModule = MyModuleName')
          }
        }
        if (diff) diff(inFiles, files, fixtureBase)
        assert.equal(count, 2, 'did not find required files.')
        done()
      })
    })

  })

  describe('an app with multiple modules with the same name', function() {

    it ('should use the correct version of the file based on what properties were accessed', function(done) {
      moduleSwapper(opts('multipleDefinitions'), function(err, files, inFiles) {
        assert.ifError(err)
        var count = 0
        for (var f in files) {
          if (isFile(f, 'module2.js')) {
            count++
            // make sure we're not importing twice
            assertNotContainsLine(files[f], "var MyModuleName2 = require('./module');")
          } else if (isFile(f, 'module3.js')) {
            count++
            assertContainsLine(files[f], "var App = require('./app');")
            assertContainsLine(files[f], "var MyModuleName = require('./module2');")
            assertContainsLine(files[f], "var MyModuleName2 = require('./module');")
            assertContainsLine(files[f], 'var aFunction = MyModuleName.someFunction')
            assertContainsLine(files[f], 'var aProp = MyModuleName2.aProperty')
          }
        }
        if (diff) diff(inFiles, files, fixtureBase)
        assert.equal(count, 2, 'did not find required files.')
        done()
      })
    })

    it('should correctly calculate the dependency if the module was assigned to a variable', function(done) {
      moduleSwapper(opts('multipleDefinitionsComplex'), function(err, files, inFiles) {
        assert.ifError(err)
        var count = 0
        for (var f in files) {
          if (isFile(f, 'module2.js')) {
            count++
            // make sure we're not importing twice
            assertNotContainsLine(files[f], "var MyModuleName2 = require('./module');")
          } else if (isFile(f, 'module3.js')) {
            count++
            assertContainsLine(files[f], "var App = require('./app');")
            assertContainsLine(files[f], "var MyModuleName = require('./module');")
            assertContainsLine(files[f], "var MyModuleName2 = require('./module2');")
            assertContainsLine(files[f], "var theModule = MyModuleName")
            assertContainsLine(files[f], 'var aFunction = MyModuleName2.someFunction')
            assertContainsLine(files[f], 'var aProp = MyModuleName.aProperty')
          }
        }
        if (diff) diff(inFiles, files, fixtureBase)
        assert.equal(count, 2, 'did not find required files.')
        done()
      })
    })

  })

})
