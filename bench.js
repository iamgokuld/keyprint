#!/usr/bin/env node
// Reproduce the CMU benchmark with the exact detector code that ships in index.html.
//   ./scripts/get-data.sh                      # downloads DSL-StrongPasswordData.csv (not committed)
//   node bench.js DSL-StrongPasswordData.csv   # prints the tables, writes bench-results.json (~25 s)
//   node bench.js DSL-StrongPasswordData.csv --embed   # also refreshes the results embedded in index.html
'use strict';
const fs = require('fs');
const path = require('path');
const { HTML, load } = require('./test_util');
const { KPB } = load('KP-DETECTORS', 'KP-BENCH');

const args = process.argv.slice(2);
const csv = args.find((a) => !a.startsWith('--')) || 'DSL-StrongPasswordData.csv';
if (!fs.existsSync(csv)) {
  console.error('Missing ' + csv + '. Run scripts/get-data.sh first (data: https://www.cs.cmu.edu/~keystroke/).');
  process.exit(2);
}
const t0 = Date.now();
const subjects = KPB.parseCSV(fs.readFileSync(csv, 'utf8'));
let lastPct = -1;
const res = KPB.runAll(subjects, {}, (d, n) => {
  const pct = Math.floor((d / n) * 20) * 5;
  if (pct !== lastPct) { lastPct = pct; process.stderr.write('\r' + pct + '% '); }
});
process.stderr.write('\n');
res.meta.generated = new Date().toISOString().slice(0, 10);
res.meta.synthetic = false;

const f = (v) => v.toFixed(4);
const ids = Object.keys(res.det);
console.log('\nEER, ' + res.meta.subjects + ' subjects, ' + res.meta.protocol);
console.log('Detector'.padEnd(34) + 'KeyPrint mean (SD)'.padEnd(22) + 'Paper mean (SD)');
ids.forEach((id) => {
  const o = res.det[id], p = res.paper[id];
  console.log(o.name.padEnd(34) + (f(o.mean) + ' (' + f(o.sd) + ')').padEnd(22) + f(p.mean) + ' (' + f(p.sd) + ')');
});
console.log('\nEnrollment size: mean EER (held-out FRR at 5% target)');
console.log('n'.padStart(4) + ids.map((id) => res.det[id].name.split(' ')[0].padStart(20)).join(''));
res.sizes.forEach((n, i) => {
  console.log(String(n).padStart(4) + ids.map((id) => {
    const e = res.det[id].enroll;
    return (e.mean[i].toFixed(3) + ' (' + (e.frr5[i] * 100).toFixed(1) + '%)').padStart(20);
  }).join(''));
});

const json = JSON.stringify(res);
fs.writeFileSync(path.join(__dirname, 'bench-results.json'), json + '\n');
console.log('\nWrote bench-results.json (' + (json.length / 1024).toFixed(0) + ' KB) in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');

if (args.includes('--embed')) {
  const re = /(<script type="application\/json" id="kp-bench-results">)[\s\S]*?(<\/script>)/;
  if (!re.test(HTML)) throw new Error('kp-bench-results script not found in index.html');
  fs.writeFileSync(path.join(__dirname, 'index.html'), HTML.replace(re, (_, a, b) => a + json + b));
  console.log('Updated the results embedded in index.html');
}
