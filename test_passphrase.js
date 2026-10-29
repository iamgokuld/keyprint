// node test_passphrase.js — custom passphrases (KP-PASSPHRASE block in index.html): layout, validation, capture, touch.
'use strict';
const { load, check, done } = require('./test_util');
const { KP, KPP, KPC, KPT } = load('KP-DETECTORS', 'KP-PASSPHRASE', 'KP-CAPTURE', 'KP-TOUCH');

const CMU = KP.FEATURE_NAMES.slice();
const ev = (key, code, t) => ({ key, code, timeStamp: t, repeat: false, ctrlKey: false, altKey: false, metaKey: false });
/** Clean keyboard attempt for the active passphrase: key i down at 150i ms, held 80 ms. */
function type(cap) {
  let r = null;
  KP.EXPECTED_KEYS.forEach((k, i) => { cap.keydown(ev(k, 'K' + i, 150 * i)); r = cap.keyup(ev(k, 'K' + i, 150 * i + 80)); });
  return r;
}

console.log('Default layout');
{
  KPP.configure('');
  check('default is .tie5Roanl', KPP.DEFAULT === '.tie5Roanl' && KP.PASSPHRASE === '.tie5Roanl');
  check('configure(default) rebuilds the exact CMU names', KP.FEATURE_NAMES.join() === CMU.join() && KP.DIM === 31);
  check('key names from characters match CMU', '.tie5Roanl'.split('').map(KPP.keyName).join() === 'period,t,i,e,five,Shift.r,o,a,n,l');
}

console.log('Validation');
{
  check('too short', /at least 4/.test(KPP.check('abc')));
  check('too long', /at most 32/.test(KPP.check('a'.repeat(33))));
  check('non-ASCII refused', !!KPP.check('café') && !!KPP.check('tab\there'));
  check('letters, digits, spaces, symbols ok', KPP.check('Hello 42!') === null && KPP.check('~`|\\"\'{}') === null);
  let threw = false; try { KPP.configure('ab'); } catch (e) { threw = true; }
  check('configure throws on a bad passphrase and keeps the layout', threw && KP.PASSPHRASE === '.tie5Roanl' && KP.DIM === 31);
}

console.log('Custom layout');
{
  KPP.configure('Hi 2u!');
  check('expected keys are the characters then Enter', KP.EXPECTED_KEYS.join('|') === 'H|i| |2|u|!|Enter');
  check('key names', KP.KEY_NAMES.join() === 'Shift.h,i,space,two,u,exclam,Return');
  check('3n − 2 features in CMU order', KP.DIM === 19 && KP.FEATURE_NAMES[0] === 'H.Shift.h' && KP.FEATURE_NAMES[1] === 'DD.Shift.h.i' && KP.FEATURE_NAMES[18] === 'H.Return');
  check('CMU layout kept for the benchmark', KP.CMU_FEATURE_NAMES.join() === CMU.join());
  const r = type(KPC.createCapture());
  check('keyboard attempt completes with 19 features', r.type === 'complete' && r.x.length === 19 && Math.abs(r.x[0] - 0.08) < 1e-9);
  const cap = KPC.createCapture();
  check('attempt must start with the first character', cap.keydown(ev('.', 'Period', 0)).type === 'stray' && cap.keydown(ev('H', 'KeyH', 1)).type === 'start');
  check('wrong key spoils with the wanted key', (() => { const s = cap.keydown(ev('x', 'KeyX', 2)); return s.type === 'spoil' && s.want === 'i'; })());
}

console.log('Repeated characters');
{
  KPP.configure('aaab');
  check('repeats allowed', KP.EXPECTED_KEYS.join('') === 'aaabEnter' && KP.DIM === 13);
  check('keyboard attempt with repeats completes', type(KPC.createCapture()).type === 'complete');
}

console.log('Detectors and synthetic samples');
{
  KPP.configure('correct horse');
  const S = KPP.syntheticSamples(5, 10);
  check('10 samples of 3n − 2 numbers', S.length === 10 && S.every((x) => x.length === KP.DIM && KP.DIM === 40));
  const t = KP.trainAll(S);
  check('all detectors train and score finitely', KP.DETECTORS.every((d) => isFinite(d.score(t[d.id].model, S[0]))));
  const out = KPP.withDefault(() => KP.runSyntheticTests({ seed: 3 }));
  check('self-test runs on the default layout', out.allPass);
  check('withDefault restores the custom layout', KP.PASSPHRASE === 'correct horse' && KP.DIM === 40);
}

console.log('Touch keypad');
{
  KPP.configure('Zebra 9');
  KPT.configure();
  const keys = KPT.KEYPAD_ROWS.flat();
  check('keypad has each distinct key once, plus Return last', keys.length === 8 && keys[keys.length - 1] === 'Enter' && new Set(keys).size === 8);
  check('keys sorted so the keypad does not spell the passphrase', keys.slice(0, -1).join('') === [...'Zebra 9'].sort().join(''));
  check('rows of at most 5', KPT.KEYPAD_ROWS.every((r) => r.length <= 5));
  check('timing + 2 position features per key', KPT.TIMING_DIM === 22 && KPT.DIM === 22 + 16);
  const cap = KPT.createTapCapture();
  let r = null;
  KP.EXPECTED_KEYS.forEach((k, i) => { cap.down({ key: k, id: i, timeStamp: 100 * i, dx: 0, dy: 0 }); r = cap.up({ id: i, timeStamp: 100 * i + 60 }); });
  check('tap attempt completes with ' + KPT.DIM + ' features', r.type === 'complete' && r.x.length === KPT.DIM);
  check('synthetic phone volunteers follow the key count', KPT.syntheticVolunteers({ users: 1, reps: 2 })[0].reps[0].length === KPT.DIM);
  KPP.configure('');
  KPT.configure();
  check('back to default: CMU keypad and 53 features', KPT.KEYPAD_ROWS.flat().join('') === '5etioanlR.Enter' && KPT.DIM === 53);
}

done();
