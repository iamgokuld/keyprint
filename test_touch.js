// node test_touch.js — keypad capture (KP-TOUCH block in index.html): 31 + 22 features, multi-touch, spoil rules,
// detectors on 53-dim vectors, synthetic volunteers.
'use strict';
const { load, check, done } = require('./test_util');
const { KP, KPB, KPT } = load('KP-DETECTORS', 'KP-BENCH', 'KP-TOUCH');

const KEYS = KP.EXPECTED_KEYS;
/** A clean keypad attempt: key i down at start + 200i ms, held 90 ms, pointer ids 1..11, offsets by key index. */
function clean(start, opts) {
  opts = opts || {};
  const ev = [];
  KEYS.forEach((k, i) => {
    const d = start + 200 * i, id = opts.sameId ? 1 : i + 1;
    ev.push({ kind: 'down', e: { key: k, id, timeStamp: d, dx: (i - 5) / 20, dy: 0.1 } });
    ev.push({ kind: 'up', e: { id, timeStamp: d + (opts.hold ? opts.hold(i) : 90) } });
  });
  return ev.sort((a, b) => a.e.timeStamp - b.e.timeStamp || (a.kind === 'up' ? -1 : 1));
}
const feed = (cap, evs) => evs.map(({ kind, e }) => (kind === 'down' ? cap.down(e) : cap.up(e)));
const complete = (res) => res.filter((r) => r.type === 'complete');
const near = (a, b) => Math.abs(a - b) < 1e-9;

console.log('Feature layout');
check('53 = 31 timing + 22 position', KPT.DIM === 53 && KPT.TIMING_DIM === 31 && KPT.POS_NAMES.length === 22);
check('timing names unchanged, position after', KPT.FEATURE_NAMES.slice(0, 31).join() === KP.FEATURE_NAMES.join() &&
  KPT.FEATURE_NAMES[31] === 'X.period' && KPT.FEATURE_NAMES[32] === 'Y.period' && KPT.FEATURE_NAMES[52] === 'Y.Return');
check('keypad has exactly the 11 passphrase keys', KPT.KEYPAD_ROWS.flat().sort().join() === KEYS.slice().sort().join());
const o = KPT.offset(130, 260, { left: 100, top: 200, width: 60, height: 80 });
check('offset normalised to key size', near(o.dx, 0) && near(o.dy, 0.25));
check('offset at the right edge = +0.5', near(KPT.offset(160, 240, { left: 100, top: 200, width: 60, height: 80 }).dx, 0.5));

console.log('Clean attempt');
{
  const cap = KPT.createTapCapture();
  const c = complete(feed(cap, clean(5000.5)));
  check('one complete attempt', c.length === 1);
  const x = c[0].x;
  check('53 features out', x.length === 53 && x.every(Number.isFinite));
  check('H / DD / UD from pointer timestamps (s)', near(x[0], 0.09) && near(x[1], 0.2) && near(x[2], 0.11));
  check('X/Y offsets per key in order', near(x[31], -0.25) && near(x[32], 0.1) && near(x[51], 0.25));
  check('timingOnly = first 31', KPT.timingOnly(x).length === 31 && KPT.timingOnly(x).join() === x.slice(0, 31).join());
}

console.log('Multi-touch');
{
  // holds of 260 ms with 200 ms spacing: every tap overlaps the next one
  const cap = KPT.createTapCapture();
  const c = complete(feed(cap, clean(0, { hold: () => 260 })));
  check('overlapping taps recorded', c.length === 1);
  check('negative UD on overlap', c.length === 1 && near(c[0].x[2], -0.06), c[0] && c[0].x[2]);
  // two fingers released in reverse order: matched by pointerId, not order
  const cap2 = KPT.createTapCapture(), ev = [];
  KEYS.forEach((k, i) => ev.push({ kind: 'down', e: { key: k, id: 100 + i, timeStamp: i * 100, dx: 0, dy: 0 } }));
  KEYS.forEach((k, i) => ev.push({ kind: 'up', e: { id: 110 - i, timeStamp: 2000 + i * 10 } }));
  const r2 = complete(feed(cap2, ev));
  check('reverse release order matched by pointerId', r2.length === 1 && near(r2[0].x[30], 2.0 - 1.0) && near(r2[0].x[0], 2.1));
}

console.log('Rules');
{
  const cap = KPT.createTapCapture();
  check('stray before "." ignored', cap.down({ key: 't', id: 9, timeStamp: 1, dx: 0, dy: 0 }).type === 'stray' && cap.attempt() === null);
  cap.down({ key: '.', id: 1, timeStamp: 10, dx: 0, dy: 0 });
  const s = cap.down({ key: 'i', id: 2, timeStamp: 20, dx: 0, dy: 0 });
  check('wrong key spoils + counts', s.type === 'spoil' && s.reason === 'typo' && s.want === 't' && s.rejects === 1 && cap.attempt() === null);
  check('release of a spoiled tap ignored', cap.up({ id: 1, timeStamp: 30 }).type === 'ignore');
  cap.down({ key: '.', id: 3, timeStamp: 40, dx: 0, dy: 0 });
  const c = cap.interrupt('cancel');
  check('pointercancel spoils a started attempt', c.type === 'spoil' && c.reason === 'cancel' && cap.rejects() === 2);
  check('interrupt with no attempt is ignored', cap.interrupt('hidden').type === 'ignore' && cap.rejects() === 2);
  // taps after all 11 are down are ignored (Return still held)
  const cap2 = KPT.createTapCapture(), ev = clean(0);
  const retUp = ev.pop();
  const res = feed(cap2, ev);
  check('extra tap while Return held ignored', cap2.down({ key: 'a', id: 77, timeStamp: 2050, dx: 0, dy: 0 }).type === 'ignore');
  check('then completes', complete(res).length === 0 && cap2.up(retUp.e).type === 'complete');
  // the same pointer id pressing again before release is ignored
  const cap3 = KPT.createTapCapture();
  cap3.down({ key: '.', id: 1, timeStamp: 0, dx: 0, dy: 0 });
  check('duplicate pointerdown id ignored', cap3.down({ key: 't', id: 1, timeStamp: 5, dx: 0, dy: 0 }).type === 'ignore');
}

console.log('Detectors on 53-dim vectors');
const users = KPT.syntheticVolunteers({ seed: 3, users: 2, reps: 20 });
check('synthetic volunteers: 20 reps × 53', users[0].reps.length === 20 && users[0].reps.every((x) => x.length === 53 && x.every(Number.isFinite)));
const S = users[0].reps.slice(0, 10), gen = users[0].reps.slice(10), imp = users[1].reps;
KP.DETECTORS.forEach((d) => {
  const m = d.train(S), gs = gen.map((x) => d.score(m, x)), is = imp.map((x) => d.score(m, x));
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  check(d.name + ': finite, impostor > genuine', gs.concat(is).every(Number.isFinite) && avg(is) > avg(gs), avg(gs).toFixed(2) + ' vs ' + avg(is).toFixed(2));
});
check('LOO thresholds on 53 dims', KP.DETECTORS.every((d) => KP.looScores(d, S).every(Number.isFinite)));
check('same seed -> same data', JSON.stringify(KPT.syntheticVolunteers({ seed: 9, users: 1, reps: 2 })) === JSON.stringify(KPT.syntheticVolunteers({ seed: 9, users: 1, reps: 2 })));

console.log('bench-mobile protocol on synthetic volunteers');
function meanEer(users, f) {
  const e = users.map((u, ui) => {
    const m = KP.scaledManhattan.train(u.reps.slice(0, 10).map(f)), imp = [];
    users.forEach((v, vi) => { if (vi !== ui) imp.push(...v.reps.slice(0, 5)); });
    return KPB.eer(u.reps.slice(10).map((x) => KP.scaledManhattan.score(m, f(x))), imp.map((x) => KP.scaledManhattan.score(m, f(x)))).eer;
  });
  return e.reduce((s, v) => s + v, 0) / e.length;
}
const withPos = KPT.syntheticVolunteers({ seed: 1, users: 12 }), noPos = KPT.syntheticVolunteers({ seed: 1, users: 12, posSignal: 0 });
const a = meanEer(withPos, KPT.timingOnly), b = meanEer(withPos, (x) => x), c = meanEer(noPos, (x) => x);
check('timing-only EER in a realistic range (0.1–0.35)', a > 0.1 && a < 0.35, a.toFixed(3));
check('position signal present -> timing+position EER lower', b < a - 0.02, a.toFixed(3) + ' -> ' + b.toFixed(3));
check('no position signal -> no real gain', c > a - 0.02, a.toFixed(3) + ' -> ' + c.toFixed(3));

done();
