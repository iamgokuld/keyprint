// node test_capture.js — keyboard capture rules (KP-TIMING, KP-CAPTURE blocks in index.html). The page only knows a hash of
// the password, so capture records any characters until Return and hands back the typed text for the caller to check.
'use strict';
const { load, check, done } = require('./test_util');
const { KP, KPF, KPC } = load('KP-DETECTORS', 'KP-TIMING', 'KP-CAPTURE');

const PW = 'Tr0ub4dor!';   // 10 characters + Return = 11 keys
const code = (k) => (k === 'Enter' ? 'Enter' : /[a-z]/i.test(k) ? 'Key' + k.toUpperCase() : /[0-9]/.test(k) ? 'Digit' + k : k === '!' ? 'Digit1' : 'X' + k);
const KEYS = PW.split('').concat('Enter');
const ev = (key, c, t, extra) => Object.assign({ key, code: c, timeStamp: t, repeat: false, ctrlKey: false, altKey: false, metaKey: false }, extra || {});

/** A clean attempt: key i down at start + 150i ms, held 80 ms (Return 100 ms). Returns [{kind, e}]. */
function clean(start, keys) {
  keys = keys || KEYS;
  const out = [];
  keys.forEach((k, i) => {
    const d = start + 150 * i;
    out.push({ kind: 'down', e: ev(k, code(k), d) });
    out.push({ kind: 'up', e: ev(k, code(k), d + (k === 'Enter' ? 100 : 80)) });
  });
  return out.sort((a, b) => a.e.timeStamp - b.e.timeStamp);
}
function feed(cap, events) {
  return events.map(({ kind, e }) => (kind === 'down' ? cap.keydown(e) : kind === 'up' ? cap.keyup(e) : cap.blur()));
}
const last = (a) => a[a.length - 1];
const complete = (res) => res.filter((r) => r.type === 'complete');

console.log('Timing features for any length');
{
  check('names: 3n − 2, CMU order', KPF.names(11).length === 31 && KPF.names(3).join() === 'H.k1,DD.k1.k2,UD.k1.k2,H.k2,DD.k2.Return,UD.k2.Return,H.Return');
  const ks = []; for (let i = 0; i < 11; i++) ks.push({ down: i * 0.2, up: i * 0.2 + 0.08 + i * 0.001 });
  check('same numbers as the frozen CMU formulas for 11 keys', KPF.timings(ks).join() === KP.featuresFromKeystrokes(ks).join());
  check('9 keys (8 characters + Return) -> 25 timings', KPF.timings(ks.slice(0, 9)).length === 25);
  let t = false; try { KPF.timings([{ down: 0, up: 1 }]); } catch (e) { t = true; }
  check('rejects a single keystroke', t);
}

console.log('Clock and typed text');
{
  const cap = KPC.createCapture();
  const c = complete(feed(cap, clean(1000.25)));
  check('clean attempt completes once', c.length === 1);
  check('typed text handed back without Return', c[0].typed === PW);
  check('times are e.timeStamp / 1000', c[0].ks[0].down === 1.00025 && c[0].ks[10].up === (1000.25 + 1500 + 100) / 1000);
  check('31 features for 11 keys, first hold = 80 ms', c[0].x.length === 31 && Math.abs(c[0].x[0] - 0.08) < 1e-9);
  check('DD = 150 ms everywhere', KPF.names(11).every((n, i) => !n.startsWith('DD.') || Math.abs(c[0].x[i] - 0.15) < 1e-9));
  const c8 = complete(feed(KPC.createCapture(), clean(0, 'Abcdef1!'.split('').concat('Enter'))));
  check('8-character password -> 25 features', c8.length === 1 && c8[0].x.length === 25 && c8[0].typed === 'Abcdef1!');
  const sp = complete(feed(KPC.createCapture(), clean(0, 'a b'.split('').concat('Enter'))));
  check('space counts as a character', sp.length === 1 && sp[0].typed === 'a b');
}

console.log('Stray keys');
{
  const cap = KPC.createCapture();
  const pre = feed(cap, [{ kind: 'down', e: ev('Enter', 'Enter', 10) }, { kind: 'up', e: ev('Enter', 'Enter', 20) },
    { kind: 'down', e: ev('Backspace', 'Backspace', 30) }, { kind: 'down', e: ev('ArrowLeft', 'ArrowLeft', 40) }]);
  check('Return, Backspace, arrows with nothing typed are stray', pre[0].type === 'stray' && pre[2].type === 'stray' && pre[3].type === 'stray');
  check('no reject counted', cap.rejects() === 0);
  check('next clean attempt completes', complete(feed(cap, clean(100))).length === 1);
}

console.log('Chords and modifiers ignored');
{
  const cap = KPC.createCapture();
  const evs = clean(0);
  const mid = evs.findIndex((x) => x.kind === 'down' && x.e.key === 'u');
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
  check('attempt still completes with the right text', complete(res).length === 1 && complete(res)[0].typed === PW);
}

console.log('Shift released before the capital');
{
  const cap = KPC.createCapture();
  const evs = clean(0);
  const iT = evs.findIndex((x) => x.kind === 'up' && x.e.key === 'T');
  evs[iT] = { kind: 'up', e: ev('t', 'KeyT', evs[iT].e.timeStamp) };   // key reads lowercase after Shift is up
  const c = complete(feed(cap, evs));
  check('keyup matched by code', c.length === 1 && c[0].typed === PW);
}

console.log('Spoiled attempts reset at once and are counted');
{
  const cap = KPC.createCapture();
  const r1 = feed(cap, [{ kind: 'down', e: ev('T', 'KeyT', 0) }, { kind: 'down', e: ev('Backspace', 'Backspace', 100) }]);
  check('Backspace -> spoil', last(r1).type === 'spoil' && last(r1).reason === 'backspace' && last(r1).pos === 1);
  check('attempt cleared immediately', cap.attempt() === null);
  const r2 = feed(cap, [{ kind: 'down', e: ev('T', 'KeyT', 200) }, { kind: 'down', e: ev('ArrowLeft', 'ArrowLeft', 300) }]);
  check('non-character key -> spoil', last(r2).reason === 'key' && last(r2).got === 'ArrowLeft');
  feed(cap, [{ kind: 'down', e: ev('T', 'KeyT', 400) }]);
  const r3 = cap.blur();
  check('blur mid-attempt -> spoil', r3.type === 'spoil' && r3.reason === 'blur');
  check('reject counter = 3', cap.rejects() === 3 && r3.rejects === 3);
  check('blur with no attempt is ignored', cap.blur().type === 'ignore' && cap.rejects() === 3);
  check('late keyups from a spoiled attempt are ignored', cap.keyup(ev('T', 'KeyT', 500)).type === 'ignore');
  check('Escape restarts without counting', (feed(cap, [{ kind: 'down', e: ev('T', 'KeyT', 600) }]), cap.keydown(ev('Escape', 'Escape', 650)).type === 'restart') && cap.rejects() === 3);
  const long = []; for (let i = 0; i <= KPC.MAX_CHARS; i++) long.push({ kind: 'down', e: ev('a', 'KeyA', 1000 + i) }, { kind: 'up', e: ev('a', 'KeyA', 1000.5 + i) });
  check('more than 64 characters -> spoil', feed(cap, long).some((r) => r.reason === 'long') && cap.rejects() === 4);
  check('fresh attempt after spoils completes', complete(feed(cap, clean(5000))).length === 1);
}

console.log('Keys after Return');
{
  const cap = KPC.createCapture();
  // Hold Return, press another key (and auto-repeat) before releasing it.
  const evs = clean(0).filter((x) => !(x.kind === 'up' && x.e.key === 'Enter'));
  evs.push({ kind: 'down', e: ev('x', 'KeyX', 1560) }, { kind: 'down', e: ev('Enter', 'Enter', 1570, { repeat: true }) },
    { kind: 'down', e: ev('T', 'KeyT', 1580) }, { kind: 'up', e: ev('Enter', 'Enter', 1600) });
  const res = feed(cap, evs);
  check('no spoil', !res.some((r) => r.type === 'spoil'), JSON.stringify(res.filter((r) => r.type === 'spoil')));
  check('extra keydowns ignored', res.filter((r) => r.type === 'ignore').length >= 3);
  check('attempt completes with Return hold 100 ms, text unchanged', complete(res).length === 1 && Math.abs(complete(res)[0].x[30] - 0.1) < 1e-9 && complete(res)[0].typed === PW);
  check('auto-repeat ignored mid-attempt', (() => {
    const c2 = KPC.createCapture(); const e2 = clean(0);
    e2.splice(1, 0, { kind: 'down', e: ev('T', 'KeyT', 30, { repeat: true }) });
    return complete(feed(c2, e2)).length === 1 && c2.rejects() === 0;
  })());
}

done();
