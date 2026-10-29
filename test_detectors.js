// node test_detectors.js — detector + EER tests on the code inside index.html (KP-DETECTORS, KP-BENCH blocks),
// plus a check that every number in the Detectors tab's worked example matches the real detector code.
'use strict';
const crypto = require('crypto');
const { HTML, block, load, check, done } = require('./test_util');
const { KP, KPB } = load('KP-DETECTORS', 'KP-BENCH');

// The detector block has been frozen since M2; benchmark numbers depend on it byte for byte.
// If you change it on purpose, re-run bench.js and update this hash.
const FROZEN = '72083a0182f02714e20a7456c78bc8c9603ac05905289c6cb5834bc04f989370';

console.log('Feature layout');
check('31 features', KP.DIM === 31 && KP.FEATURE_NAMES.length === 31);
check('CMU column order (first/last)', KP.FEATURE_NAMES[0] === 'H.period' && KP.FEATURE_NAMES[1] === 'DD.period.t' &&
  KP.FEATURE_NAMES[2] === 'UD.period.t' && KP.FEATURE_NAMES[30] === 'H.Return');
const ks = [{ down: 0, up: 0.1 }, { down: 0.25, up: 0.32 }];
const toy = [];
for (let i = 0; i < 11; i++) toy.push({ down: i * 0.2, up: i * 0.2 + 0.08 });
const x = KP.featuresFromKeystrokes(toy);
check('H / DD / UD formulas', Math.abs(x[0] - 0.08) < 1e-12 && Math.abs(x[1] - 0.2) < 1e-12 && Math.abs(x[2] - 0.12) < 1e-12);
let threw = false; try { KP.featuresFromKeystrokes(ks); } catch (e) { threw = true; }
check('rejects wrong keystroke count', threw);

console.log('Synthetic typists (6 seeds, impostor shifted 1.5 SD)');
[1, 2, 3, 7, 42, 2026].forEach((seed) => {
  const r = KP.runSyntheticTests({ seed });
  check('seed ' + seed + ': impostors score higher for all detectors', r.allPass,
    r.results.map((d) => d.id + ' gen ' + d.meanGen.toFixed(2) + ' imp ' + d.meanImp.toFixed(2)).join(', '));
});

console.log('Shrinkage covariance');
const S = KP.syntheticProfileSamples(5, 10);
const c = KP.shrunkCovariance(S);
check('lambda in [0.05, 1]', c.lambda >= 0.05 && c.lambda <= 1, 'lambda=' + c.lambda);
check('positive definite (10 samples, 31 dims)', (() => { try { KP.spdInverse(c.cov); return true; } catch (e) { return false; } })());
check('LOO scores: one per sample, finite', KP.DETECTORS.every((d) => { const l = KP.looScores(d, S); return l.length === 10 && l.every(isFinite); }));
check('quantile interpolates', KP.quantile([0, 10], 0.95) === 9.5 && KP.quantile([3, 1, 2], 0.5) === 2);

console.log('Equal-error rate');
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
check('separated -> 0', KPB.eer([1, 2, 3], [10, 11, 12]).eer === 0);
check('inverted -> 1', KPB.eer([10, 11, 12], [1, 2, 3]).eer === 1);
check('identical -> 0.5', near(KPB.eer([1, 2, 3, 4], [1, 2, 3, 4]).eer, 0.5, 1e-9));
check('all ties -> 0.5', near(KPB.eer([5, 5, 5], [5, 5, 5, 5]).eer, 0.5, 1e-9));
const r = KP.rng(11), g = KP.gaussian(r);
const a = range(4000, () => g()), b = range(4000, () => g());
check('same distribution -> ~0.5', near(KPB.eer(a, b).eer, 0.5, 0.03), KPB.eer(a, b).eer);
const imp = range(4000, () => 2 + g());
const phi = 0.15865525393145707;   // Φ(−1): N(0,1) vs N(2,1) cross at 1
check('N(0,1) vs N(2,1) -> Φ(−1) ≈ 0.159', near(KPB.eer(a, imp).eer, phi, 0.015), KPB.eer(a, imp).eer);

console.log('Detectors tab worked example (numbers printed on the page)');
const EX = [[100, 200], [112, 218], [88, 184], [106, 208], [94, 192], [104, 206], [96, 196], [108, 214], [92, 186], [100, 196]]
  .map((r) => r.map((v) => v / 1000));
const exLine = {}, exModel = {};
KP.DETECTORS.forEach((d) => { exModel[d.id] = d.train(EX); exLine[d.id] = KP.thresholdAt(KP.looScores(d, EX), 0.05); });
const exScore = (id, h, g) => KP.DETECTORS.find((d) => d.id === id).score(exModel[id], [h / 1000, g / 1000]);
const f2 = (v) => v.toFixed(2);
const DET = (HTML.match(/<div id="view-detectors"[\s\S]*?<!-- =+ HOW IT WORKS/) || [''])[0];
check('Manhattan wobble 6 ms / 9.2 ms', f2(exModel.manhattan.mad[0] * 1000) === '6.00' && f2(exModel.manhattan.mad[1] * 1000) === '9.20');
check('Manhattan LOO scores as printed', DET.includes(KP.looScores(KP.scaledManhattan, EX).map(f2).sort((a, b) => a - b).join(' · ')));
const EXPECT = [
  ['manhattan', null, null, 'line', '4.73'], ['mahalanobis', null, null, 'line', '2.03'], ['nn', null, null, 'line', '0.84'],
  ['manhattan', 110, 220, 'A', '3.84'], ['manhattan', 110, 180, 'B', '3.84'], ['manhattan', 130, 260, 'D', '11.52'], ['manhattan', 116, 220, 'C', '4.84'],
  ['mahalanobis', 110, 220, 'A', '1.83'], ['mahalanobis', 110, 180, 'B', '6.36'], ['mahalanobis', 116, 220, 'C', '2.12'], ['nn', 116, 220, 'C', '0.81']
];
EXPECT.forEach(([id, h, g, what, want]) => {
  const got = f2(h == null ? exLine[id] : exScore(id, h, g));
  check(id + ' ' + what + ' = ' + want + ' (and shown on the page)', got === want && DET.includes(want), got);
});
const VOTES = { A: [110, 220, 'YYY'], E: [100, 205, 'YYN'], B: [110, 180, 'YNN'], C: [116, 220, 'NNY'], D: [130, 260, 'NNN'] };
Object.keys(VOTES).forEach((k) => {
  const [h, g, want] = VOTES[k];
  const got = KP.DETECTORS.map((d) => exScore(d.id, h, g) <= exLine[d.id] ? 'Y' : 'N').join('');
  const yes = got.split('Y').length - 1, row = (DET.match(new RegExp('<th scope="row">' + k + ' \\(' + h + ', ' + g + '\\)</th>(.*?)</tr>')) || [])[1] || '';
  const shown = (row.match(/chip (ok|bad)/g) || []).map((c) => c.endsWith('ok') ? 'Y' : 'N').join('');
  check('vote ' + k + ': ' + want + ' -> ' + (yes >= 2 ? 'accepted' : 'rejected') + ' (table matches)', got === want && shown === want &&
    row.includes((yes >= 2 ? 'Accepted: ' : 'Rejected: only ') + yes + ' of 3 detectors say it is you.'), got + ' shown ' + shown);
});

console.log('Freeze');
const hash = crypto.createHash('sha256').update(block('KP-DETECTORS')).digest('hex');
check('KP-DETECTORS block byte-identical to M2', hash === FROZEN, hash);

done();
