// Shared by the test_*.js files and bench.js: load a marked block from index.html (no browser needed).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function block(name) {
  const re = new RegExp('// ==== ' + name + ' BEGIN ====[\\s\\S]*?// ==== ' + name + ' END ====');
  const m = HTML.match(re);
  if (!m) throw new Error('block ' + name + ' not found in index.html');
  return m[0];
}

/** Evaluate blocks in one sandbox and return its globals (KP, KPC, KPB). */
function load(...names) {
  const ctx = vm.createContext({ console });
  names.forEach((n) => vm.runInContext(block(n).replace(/if \(typeof module[^\n]*\n/, ''), ctx, { filename: 'index.html#' + n }));
  return ctx;
}

let failed = 0, passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function done() {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

module.exports = { HTML, block, load, check, done };
