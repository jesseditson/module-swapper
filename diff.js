require('colors')
var path = require('path')
var jsdiff = require('diff')

module.exports = diff = function(ifiles, ofiles, base) {
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
