#!/usr/bin/env node
// Does tap position help on a phone? Per-user EER with timing-only (31) vs timing + tap position (53) features,
// using the exact detector code in index.html.
//   node bench-mobile.js data/collect/*.json        # Collect-tab exports (one file per volunteer, or a folder)
//   node bench-mobile.js --synthetic [--users 20] [--seed 1] [--pos 0.06]   # synthetic volunteers (pipeline check only)
//   add --out bench-mobile-results.json to save the numbers
// Protocol (mirrors the CMU one at the demo's enrollment size): per volunteer, train on reps 1–10, test on reps 11–20
// (genuine) and on the first 5 reps of every other volunteer (impostors). Only phone-keypad sessions are used.
'use strict';
const fs = require('fs');
const path = require('path');
const { load } = require('./test_util');
const { KP, KPB, KPT } = load('KP-DETECTORS', 'KP-BENCH', 'KP-TOUCH');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] != null ? args[i + 1] : def; };
const N_TRAIN = +opt('--train', 10), N_IMP = +opt('--imp', 5);
const synthetic = args.includes('--synthetic');

function loadFiles(list) {
  const files = [];
  list.forEach((p) => {
    if (fs.statSync(p).isDirectory()) fs.readdirSync(p).filter((f) => f.endsWith('.json')).forEach((f) => files.push(path.join(p, f)));
    else files.push(p);
  });
  const users = [], skipped = [];
  files.forEach((f) => {
    let o; try { o = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { skipped.push(f + ': not JSON'); return; }
    if (o.kind !== 'keyprint-collect') { skipped.push(f + ': not a Collect export'); return; }
    if (o.device !== 'mobile') { skipped.push(f + ': keyboard session'); return; }
    if (o.pointer && /mouse|pen/.test(o.pointer) && !args.includes('--any-pointer')) { skipped.push(f + ': keypad used with ' + o.pointer + ' (pass --any-pointer to include)'); return; }
    if (!Array.isArray(o.reps) || !o.reps.every((x) => Array.isArray(x) && x.length === KPT.DIM)) { skipped.push(f + ': reps must be ' + KPT.DIM + ' numbers'); return; }
    if (o.reps.length < N_TRAIN + 1) { skipped.push(f + ': only ' + o.reps.length + ' reps'); return; }
    users.push({ participant: o.participant || path.basename(f, '.json'), reps: o.reps });
  });
  return { users, skipped };
}

let users, skipped = [], source;
if (synthetic) {
  const pos = +opt('--pos', 0.06);
  users = KPT.syntheticVolunteers({ seed: +opt('--seed', 1), users: +opt('--users', 20), reps: 20, posSignal: pos });
  source = 'SYNTHETIC volunteers (seed ' + opt('--seed', 1) + ', position signal ' + pos + '); checks the pipeline, says nothing about real phones';
} else {
  const list = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--synthetic', '--any-pointer'].includes(args[i - 1])));
  if (!list.length) { console.error('Usage: node bench-mobile.js <collect files or folder> | --synthetic'); process.exit(2); }
  ({ users, skipped } = loadFiles(list));
  source = 'Collect exports: ' + users.length + ' phone volunteers';
}
skipped.forEach((s) => console.error('skip ' + s));
if (users.length < 2) { console.error('Need at least 2 phone volunteers (have ' + users.length + ').'); process.exit(2); }

const SETS = { timing: (x) => KPT.timingOnly(x), both: (x) => x };
const ids = KP.DETECTORS.map((d) => d.id);
const per = users.map((u, ui) => {
  const train = u.reps.slice(0, N_TRAIN), gen = u.reps.slice(N_TRAIN);
  const imp = [];
  users.forEach((v, vi) => { if (vi !== ui) imp.push(...v.reps.slice(0, N_IMP)); });
  const row = { participant: u.participant, nGen: gen.length, nImp: imp.length, eer: {} };
  Object.keys(SETS).forEach((set) => {
    const f = SETS[set];
    row.eer[set] = {};
    KP.DETECTORS.forEach((d) => {
      const m = d.train(train.map(f));
      row.eer[set][d.id] = KPB.eer(gen.map((x) => d.score(m, f(x))), imp.map((x) => d.score(m, f(x)))).eer;
    });
  });
  return row;
});

const ms = (a) => KPB.meanSd(a);
const summary = {};
ids.forEach((id) => {
  const t = per.map((r) => r.eer.timing[id]), b = per.map((r) => r.eer.both[id]);
  summary[id] = {
    name: KP.DETECTORS.find((d) => d.id === id).name, timing: ms(t), both: ms(b),
    better: per.filter((r) => r.eer.both[id] < r.eer.timing[id] - 1e-9).length,
    worse: per.filter((r) => r.eer.both[id] > r.eer.timing[id] + 1e-9).length
  };
});

const f3 = (v) => v.toFixed(3);
console.log('\n' + source);
console.log('Per volunteer: train reps 1–' + N_TRAIN + ', test the rest + first ' + N_IMP + ' reps of each other volunteer.\n');
console.log('Mean EER (SD) over ' + users.length + ' volunteers');
console.log('Detector'.padEnd(20) + 'timing (31)'.padEnd(18) + 'timing+position (53)'.padEnd(24) + 'Δ'.padEnd(9) + 'users better / worse');
ids.forEach((id) => {
  const s = summary[id];
  console.log(s.name.padEnd(20) + (f3(s.timing.mean) + ' (' + f3(s.timing.sd) + ')').padEnd(18) + (f3(s.both.mean) + ' (' + f3(s.both.sd) + ')').padEnd(24) +
    ((s.both.mean - s.timing.mean >= 0 ? '+' : '') + f3(s.both.mean - s.timing.mean)).padEnd(9) + s.better + ' / ' + s.worse);
});
if (args.includes('--per-user')) {
  console.log('\nParticipant'.padEnd(16) + ids.map((id) => (id + ' t / t+p').padStart(26)).join(''));
  per.forEach((r) => console.log(String(r.participant).padEnd(15) + ids.map((id) => (f3(r.eer.timing[id]) + ' / ' + f3(r.eer.both[id])).padStart(26)).join('')));
}
const out = opt('--out', null);
if (out) {
  fs.writeFileSync(out, JSON.stringify({ meta: { source, synthetic, nTrain: N_TRAIN, nImpPerUser: N_IMP, users: users.length, generated: new Date().toISOString().slice(0, 10) }, summary, perUser: per }, null, 1) + '\n');
  console.log('\nWrote ' + out);
}
module.exports = { summary, per };
