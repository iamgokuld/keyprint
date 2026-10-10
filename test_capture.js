// node test_capture.js — regression tests for the merged M1/M2 capture rules (KP-CAPTURE block in index.html).
'use strict';
const { load, check, done } = require('./test_util');
const { KP, KPC } = load('KP-DETECTORS', 'KP-CAPTURE');

const CODES = ['Period', 'KeyT', 'KeyI', 'KeyE', 'Digit5', 'KeyR', 'KeyO', 'KeyA', 'KeyN', 'KeyL', 'Enter'];
const KEYS = KP.EXPECTED_KEYS;
const ev = (key, code, t, extra) => Object.assign({ key, code, timeStamp: t, repeat: false, ctrlKey: false, altKey: false, metaKey: false }, extra || {});

/** A clean attempt: key i down at start + 150i ms, held 80 ms (Return 100 ms). Returns [{kind, e}]. */
function clean(start) {
  const out = [];
  KEYS.forEach((k, i) => {
    const d = start + 150 * i;
    out.push({ kind: 'down', e: ev(k, CODES[i], d) });
    out.push({ kind: 'up', e: ev(k, CODES[i], d + (i === 10 ? 100 : 80)) });
  });
  return out.sort((a, b) => a.e.timeStamp - b.e.timeStamp);
}
function feed(cap, events) {
  return events.map(({ kind, e }) => (kind === 'down' ? cap.keydown(e) : kind === 'up' ? cap.keyup(e) : cap.blur()));
}
const last = (a) => a[a.length - 1];
const complete = (res) => res.filter((r) => r.type === 'complete');

console.log('Clock');
{
  const cap = KPC.createCapture();
  const res = feed(cap, clean(1000.25));
  const c = complete(res);
  check('clean attempt completes once', c.length === 1);
  check('times are e.timeStamp / 1000', c[0].ks[0].down === 1.00025 && c[0].ks[10].up === (1000.25 + 1500 + 100) / 1000);
  check('31 features, H.period = 80 ms', c[0].x.length === 31 && Math.abs(c[0].x[0] - 0.08) < 1e-9);
  check('DD = 150 ms everywhere', KP.FEATURE_NAMES.every((n, i) => !n.startsWith('DD.') || Math.abs(c[0].x[i] - 0.15) < 1e-9));
}

console.log('Stray keys before "."');
{
  const cap = KPC.createCapture();
  const pre = feed(cap, [{ kind: 'down', e: ev('x', 'KeyX', 10) }, { kind: 'up', e: ev('x', 'KeyX', 20) }, { kind: 'down', e: ev('Backspace', 'Backspace', 30) }]);
  check('stray keys reported as stray, not spoiled', pre[0].type === 'stray' && pre[2].type === 'stray');
  check('no reject counted', cap.rejects() === 0);
  check('next clean attempt completes', complete(feed(cap, clean(100))).length === 1);
}

console.log('Chords and modifiers ignored');
{
  const cap = KPC.createCapture();
  const evs = clean(0);
  const mid = evs.findIndex((x) => x.kind === 'down' && x.e.key === 'e');
  evs.splice(mid, 0,
    { kind: 'down', e: ev('c', 'KeyC', 290, { ctrlKey: true }) },
    { kind: 'down', e: ev('Tab', 'Tab', 291, { altKey: true }) },
    { kind: 'down', e: ev('r', 'KeyR', 292, { metaKey: true }) },
    { kind: 'down', e: ev('AltGraph', 'AltRight', 293) },
    { kind: 'down', e: ev('Fn', '', 294) },
    { kind: 'down', e: ev('Shift', 'ShiftLeft', 295) });
  const res = feed(cap, evs);
  check('Ctrl/Alt/Meta chords, AltGraph, Fn, Shift do not spoil', !res.some((r) => r.type === 'spoil'));
  check('modifier events pass through to the browser', res.filter((r) => r.passThrough).length === 6);
  check('attempt still completes', complete(res).length === 1);
}

console.log('Shift released before R');
{
  const cap = KPC.createCapture();
  const evs = clean(0).map((x) => x);
  const iR = evs.findIndex((x) => x.kind === 'up' && x.e.key === 'R');
  evs[iR] = { kind: 'up', e: ev('r', 'KeyR', evs[iR].e.timeStamp) };   // key reads lowercase after Shift is up
  check('keyup matched by code', complete(feed(cap, evs)).length === 1);
}

console.log('Spoiled attempts reset at once and are counted');
{
  const cap = KPC.createCapture();
  const r1 = feed(cap, [{ kind: 'down', e: ev('.', 'Period', 0) }, { kind: 'down', e: ev('y', 'KeyY', 100) }]);
  check('typo -> spoil with position and keys', last(r1).type === 'spoil' && last(r1).reason === 'typo' && last(r1).pos === 1 && last(r1).want === 't' && last(r1).got === 'y');
  check('attempt cleared immediately', cap.attempt() === null);
  const r2 = feed(cap, [{ kind: 'down', e: ev('.', 'Period', 200) }, { kind: 'down', e: ev('Backspace', 'Backspace', 300) }]);
  check('Backspace -> spoil', last(r2).reason === 'backspace');
  feed(cap, [{ kind: 'down', e: ev('.', 'Period', 400) }]);
  const r3 = cap.blur();
  check('blur mid-attempt -> spoil', r3.type === 'spoil' && r3.reason === 'blur');
  check('reject counter = 3', cap.rejects() === 3 && r3.rejects === 3);
  check('blur with no attempt is ignored', cap.blur().type === 'ignore' && cap.rejects() === 3);
  check('late keyups from a spoiled attempt are ignored', cap.keyup(ev('.', 'Period', 500)).type === 'ignore');
  check('Escape restarts without counting', (feed(cap, [{ kind: 'down', e: ev('.', 'Period', 600) }]), cap.keydown(ev('Escape', 'Escape', 650)).type === 'restart') && cap.rejects() === 3);
  check('fresh attempt after spoils completes', complete(feed(cap, clean(1000))).length === 1);
}

console.log('Bug fix: keys after all 11 are down');
{
  const cap = KPC.createCapture();
  // Hold Return, press another key (and auto-repeat) before releasing it.
  const evs = clean(0).filter((x) => !(x.kind === 'up' && x.e.key === 'Enter'));
  evs.push({ kind: 'down', e: ev('x', 'KeyX', 1560) }, { kind: 'down', e: ev('Enter', 'Enter', 1570, { repeat: true }) },
    { kind: 'down', e: ev('.', 'Period', 1580) }, { kind: 'up', e: ev('Enter', 'Enter', 1600) });
  const res = feed(cap, evs);
  check('no spoil (no "expected undefined")', !res.some((r) => r.type === 'spoil'), JSON.stringify(res.filter((r) => r.type === 'spoil')));
  check('extra keydowns ignored', res.filter((r) => r.type === 'ignore').length >= 3);
  check('attempt completes with Return hold 100 ms', complete(res).length === 1 && Math.abs(complete(res)[0].x[30] - 0.1) < 1e-9);
  check('auto-repeat ignored mid-attempt', (() => {
    const c2 = KPC.createCapture(); const e2 = clean(0);
    e2.splice(1, 0, { kind: 'down', e: ev('.', 'Period', 30, { repeat: true }) });
    return complete(feed(c2, e2)).length === 1 && c2.rejects() === 0;
  })());
}

console.log('M1 import / migration');
{
  const vec = (k) => KP.FEATURE_NAMES.map((_, j) => 0.05 + 0.001 * j + k * 1e-4);
  const exp = { schema: 1, passphrase: '.tie5Roanl', featureNames: KP.FEATURE_NAMES.slice(), attempts: Array.from({ length: 13 }, (_, k) => ({ vector: vec(k) })) };
  const p = KPC.fromM1(exp, 10, 0.07);
  check('schema 1 export -> M2 profile', p.app === 'KeyPrint' && p.samples.length === 10 && p.frr === 0.07 && p.fromM1 === 13);
  check('keeps the latest 10 attempts', p.samples[0] === exp.attempts[3].vector && p.samples[9] === exp.attempts[12].vector);
  const ms = (k) => ({ H: Array.from({ length: 11 }, (_, i) => 80 + i + k), DD: Array.from({ length: 10 }, (_, i) => 150 + i), UD: Array.from({ length: 10 }, (_, i) => 70 - i) });
  const ls = { attempts: [ms(0), ms(1)] };
  const q = KPC.fromM1(ls, 10);
  check('keyprint.v1 localStorage (H/DD/UD ms) -> seconds in CMU order', q.samples.length === 2 && q.samples[0].length === 31 &&
    q.samples[0][0] === 0.08 && q.samples[0][1] === 0.15 && q.samples[0][2] === 0.07 && q.samples[0][30] === 0.09 && q.samples[1][0] === 0.081);
  let t1 = false; try { KPC.fromM1(Object.assign({}, exp, { featureNames: KP.FEATURE_NAMES.slice().reverse() })); } catch (e) { t1 = true; }
  check('rejects an export with a different feature order', t1);
  let t2 = false; try { KPC.fromM1({ attempts: [{ foo: 1 }] }); } catch (e) { t2 = true; }
  check('rejects an attempt with no data', t2);
  const m2 = { app: 'KeyPrint', samples: [vec(0)] };
  check('M2 profiles pass through unchanged', KPC.fromM1(m2) === m2);
}

console.log('Rhythm chart stats');
{
  const st = KPC.featureStats([[1, 2], [3, 2], [5, 2]]);
  check('mean and sample SD per feature', st.mean[0] === 3 && st.sd[0] === 2 && st.sd[1] === 0 && st.n === 3);
  check('single sample -> SD 0', KPC.featureStats([[1, 2]]).sd.every((v) => v === 0));
}

done();
