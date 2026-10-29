// node test_e2e.js — browser tests with Playwright + Chromium (not part of `npm test`; needs `npm i -D playwright`).
// Phone (375×667, touch, DPR 2): create a password, real touch input via CDP on the full on-screen keyboard (Shift, 123),
// keypad attempt -> 31 + 22 features, multi-touch, Backspace, enroll + verify, canvas DPR + resize, touch targets, no overflow.
// Desktop (1440×900): password rules and inline errors, keyboard attempt -> 31 features, wrong password not counted,
// "Is it really you?" always on Verify -> security question -> retrain, Reset on the Enroll step only, no shared passphrase anywhere, How it works, Detectors tab.
// Writes docs/screenshots/*.png.
'use strict';
const path = require('path');
const fs = require('fs');
const { check, done } = require('./test_util');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('@playwright/test')); }

const URL = 'file://' + path.join(__dirname, 'index.html');
const SHOTS = path.join(__dirname, 'docs', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const PW = 'Tr0ub4dor!', Q = 'What was my first bike called?', A = 'Blue Comet';
const PASS = PW.split('').concat('Enter');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(browser, ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());   // offline-safe; system font fallback
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
  await page.goto(URL);
  return { ctx, page, errors };
}
async function overflow(page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    const wide = [...document.querySelectorAll('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || el.closest('.scroll,.tabs,[hidden]')) return false;
      return r.right > d.clientWidth + 1 || r.left < -1;
    }).slice(0, 5).map((el) => el.tagName + '#' + el.id + '.' + el.className);
    return { sw: d.scrollWidth, cw: d.clientWidth, wide };
  });
}
async function noOverflowAllTabs(page, label) {
  for (const t of ['try', 'detectors', 'how']) {
    await page.click('#tab-' + t); await sleep(120);
    const o = await overflow(page);
    check(label + ' · ' + t + ': no horizontal page scroll', o.sw <= o.cw && o.wide.length === 0, JSON.stringify(o));
  }
  await page.click('#tab-try');
}

/** Real touch input through CDP: Chromium turns these into pointer events with pointerType "touch". */
function toucher(cdp) {
  const active = new Map();
  const pts = () => [...active.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 }));
  return {
    async down(id, x, y) { active.set(id, { x, y }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts() }); },
    async up(id) { active.delete(id); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: pts() }); }
  };
}
/** Boxes of the keys showing now (one keyboard layer at a time), plus the layer keys. */
async function keyBoxes(page, sel) {
  return page.evaluate((sel) => (document.querySelector(sel).scrollIntoView({ block: 'center' }), Object.fromEntries([...document.querySelectorAll(sel + ' .kp-layer:not([hidden]) [data-k],' + sel + ' .kp-layer:not([hidden]) [data-ctl]')].map((b) => {
    const r = b.getBoundingClientRect(); return [b.dataset.k || 'ctl:' + b.dataset.ctl, { x: r.left, y: r.top, w: r.width, h: r.height }];
  }))), sel);
}
/** Tap layer keys (Shift, 123, abc) until key k is showing; they are not part of the attempt. */
async function reach(page, t, sel, k, idRef) {
  for (let n = 0; n < 3; n++) {
    const boxes = await keyBoxes(page, sel);
    if (boxes[k]) return boxes;
    const ctl = /[A-Z]/.test(k) && boxes['ctl:Shift'] ? 'ctl:Shift' : /[a-z]/.test(k) && boxes['ctl:abc'] ? 'ctl:abc'
      : boxes['ctl:123'] ? 'ctl:123' : boxes['ctl:abc'] ? 'ctl:abc' : 'ctl:Shift';
    const b = boxes[ctl], id = idRef.id++;
    await t.down(id, b.x + b.w / 2, b.y + b.h / 2); await sleep(30); await t.up(id); await sleep(40);
  }
  throw new Error('key not on the keyboard: ' + k);
}
/** One keypad attempt. off(i) -> [fx, fy] tap offset in key units; overlap(i) -> true: key i+1 lands before key i lifts. */
async function tapAttempt(page, t, sel, opts) {
  opts = opts || {};
  const keys = opts.keys || PASS, ref = { id: opts.id0 || 1 };
  for (let i = 0; i < keys.length; i++) {
    const boxes = await reach(page, t, sel, keys[i], ref);
    const b = boxes[keys[i]], [fx, fy] = opts.off ? opts.off(i) : [0, 0.1];
    const me = ref.id++;
    await t.down(me, b.x + b.w * (0.5 + fx), b.y + b.h * (0.5 + fy));
    const hold = 45 + Math.round(Math.random() * 30), gap = 70 + Math.round(Math.random() * 40);
    if (opts.overlap && opts.overlap(i) && i < keys.length - 1) {
      // next key lands first, then a finger lifts: overlapping taps (measured: Chromium lifts the newer finger here, so wait a full hold
      // before the first lift to keep both holds realistic)
      const n = boxes[keys[i + 1]], nid = ref.id++;
      await sleep(hold); await t.down(nid, n.x + n.w * 0.5, n.y + n.h * 0.6); await sleep(hold); await t.up(me);
      await sleep(hold); await t.up(nid); await sleep(gap); i++;
    } else { await sleep(hold); await t.up(me); await sleep(gap); }
  }
  return ref.id;
}
async function targets(page, scope) {
  return page.evaluate((scope) => {
    const sel = 'button:not(.kp-key):not([disabled]),[role=tab],select,summary,input[type=range],.kp-key';
    return [...document.querySelectorAll(scope + ' ' + sel + ',' + sel.split(',').map((s) => 'header ' + s).join(','))]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.height && !el.closest('[hidden]'); })
      .map((el) => { const r = el.getBoundingClientRect(); return { el: (el.id || el.className || el.tagName) + ':' + (el.textContent || '').trim().slice(0, 16), key: el.classList.contains('kp-key'), w: r.width, h: r.height }; })
      // a full keyboard puts 10 keys in a row: keyboard keys must be ≥ 44 px tall and ≥ 24 px wide, everything else ≥ 44 × 44
      .filter((t) => t.key ? t.h < 44 || t.w < 24 : t.w < 44 || t.h < 44);
  }, scope);
}

async function waitIdle(page) { await page.waitForFunction(() => !KeyPrint.busy()); await sleep(30); }
async function setUp(page, pw) {
  await page.fill('#su-pass', pw || PW); await page.fill('#su-confirm', pw || PW);
  await page.fill('#su-q', Q); await page.fill('#su-a', A);
  await page.click('#su-create');
  await page.waitForFunction(() => KeyPrint.hasAccount()); await sleep(50);
}
async function typeKeys(page, keys) {
  for (const k of keys) { await page.keyboard.down(k); await sleep(45 + Math.round(Math.random() * 20)); await page.keyboard.up(k); await sleep(60); }
  await waitIdle(page);
}

(async () => {
  const browser = await chromium.launch();

  // ===================== phone =====================
  console.log('Phone 375×667 (touch, DPR 2)');
  const phone = { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  let { ctx, page, errors } = await open(browser, phone);
  const cdp = await ctx.newCDPSession(page), t = toucher(cdp);
  check('first visit asks for a password, nothing to type into yet', await page.isVisible('#setup') && !(await page.isVisible('#keypad')) && !(await page.isVisible('#step-enroll')));
  await noOverflowAllTabs(page, '375 setup');
  await setUp(page);
  check('after setup: keyboard shown, text field hidden', await page.isVisible('#keypad') && !(await page.isVisible('#pass')) && !(await page.isVisible('#setup')));
  check('phone profile selected', (await page.evaluate(() => KeyPrint.device())) === 'mobile');
  const small = await targets(page, '#view-try');
  check('touch targets (keyboard keys ≥ 44 px tall, ≥ 24 px wide; the rest ≥ 44 × 44)', small.length === 0, JSON.stringify(small.slice(0, 6)));
  check('keypad: touch-action / user-select', await page.evaluate(() => {
    const k = getComputedStyle(document.querySelector('.kp-key')), p = getComputedStyle(document.getElementById('keypad'));
    return p.touchAction === 'manipulation' && k.touchAction === 'none' && k.userSelect === 'none';
  }));
  check('keyboard does not show the password', await page.evaluate(() => document.querySelectorAll('#keypad [data-k]').length > 90));
  await noOverflowAllTabs(page, '375');

  // Backspace discards + counter
  const tap = async (k, id) => { const ref = { id: id * 10 }; const b = (await reach(page, t, '#keypad', k, ref))[k]; await t.down(id, b.x + b.w / 2, b.y + b.h / 2); await sleep(50); await t.up(id); await sleep(40); };
  await tap('T', 1); await tap('Backspace', 2);
  check('Backspace discards and counts', /Backspace used.*\(1 this session\)/.test(await page.textContent('#status')));

  // a full attempt with known tap offsets and two overlapping pairs (u→b, d→o), Shift and 123 on the way
  const OFF = (i) => [((i % 5) - 2) * 0.1, i % 2 ? -0.2 : 0.2];
  await tapAttempt(page, t, '#keypad', { id0: 100, off: OFF, overlap: (i) => i === 3 || i === 6 });
  await waitIdle(page);
  const x = await page.evaluate(() => KeyPrint.lastVector());
  check('full keypad attempt -> 31 + 22 = 53 features', Array.isArray(x) && x.length === 53 && x.every(Number.isFinite), x && x.length);
  check('counted as enrollment sample 1', /Sample 1 of 10/.test(await page.textContent('#status')), await page.textContent('#status'));
  const holds = x ? x.filter((v, j) => j < 31 && j % 3 === 0) : [];
  check('hold times plausible (30–300 ms)', holds.length === 11 && holds.every((h) => h > 0.03 && h < 0.3), holds.map((h) => (h * 1000).toFixed(0)).join(' '));
  check('overlapping taps -> negative UD (u→b, d→o)', x && x[11] < 0 && x[20] < 0, x && [x[11], x[20]].map((v) => v.toFixed(3)).join(', '));
  const offErr = x ? Math.max(...PASS.map((_, i) => (i === 4 || i === 7) ? 0 : Math.max(Math.abs(x[31 + 2 * i] - OFF(i)[0]), Math.abs(x[32 + 2 * i] - OFF(i)[1])))) : 1;
  check('tap offsets match where we touched (±0.02 key)', offErr < 0.02, offErr.toFixed(4));
  check('no text field focused (system keyboard never opens)', await page.evaluate(() => !/^(INPUT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName)));
  check('no marks left on the keys after a try (they would show the password)', (await page.$$('#keypad .tap')).length === 0 && await page.isVisible('#keypad [data-k="q"]'));

  // a wrong password is not counted
  await tapAttempt(page, t, '#keypad', { id0: 900, keys: 'Tr0ub4dor?'.split('').concat('Enter') });
  await waitIdle(page);
  check('wrong password not counted', /not the password you created/.test(await page.textContent('#status')) && (await page.evaluate(() => KeyPrint.samples())) === 1);

  // enroll 10 + verify
  for (let k = 1; k < 10; k++) { await tapAttempt(page, t, '#keypad', { id0: 1000 * k, off: (i) => [0.05 * Math.sin(i + k), 0.1] }); await waitIdle(page); }
  check('10 keypad samples -> trained phone profile', await page.evaluate(() => KeyPrint.trained() && KeyPrint.samples() === 10));
  await tapAttempt(page, t, '#keypad', { id0: 50000, off: () => [0, 0.1] }); await waitIdle(page);
  check('verify attempt gives a verdict', /Accepted|Rejected/.test(await page.textContent('#status')));
  check('"Is it really you?" shown after a reject, hidden after an accept', (await page.isVisible('#recover-open')) === /Rejected/.test(await page.textContent('#status')));
  await page.screenshot({ path: path.join(SHOTS, 'mobile-375.png') });
  await page.screenshot({ path: path.join(SHOTS, 'mobile-375-full.png'), fullPage: true });
  const prof = await page.evaluate(() => JSON.parse(localStorage.getItem('keyprint.profile.mobile.v2')));
  const acct = await page.evaluate(() => JSON.parse(localStorage.getItem('keyprint.account.v1')));
  check('phone profile stored with device type and account', prof && prof.device === 'mobile' && prof.samples[0].length === 53 && prof.account === acct.pwSalt);
  check('account keeps only hashes of the password and answer', acct && acct.question === Q && !JSON.stringify(acct).includes(PW) && !/blue comet/i.test(JSON.stringify(acct)));
  check('desktop slot untouched', await page.evaluate(() => localStorage.getItem('keyprint.profile.v3') === null));

  // Detectors tab: three detectors, two plots, the vote table; no benchmark leftovers
  await page.click('#tab-detectors'); await sleep(200);
  check('Detectors tab shows 3 detectors', (await page.$$('#view-detectors .det-list > li')).length === 3);
  check('Detectors tab has 2 plots and a 5-row vote table', (await page.$$('#view-detectors svg.plot')).length === 2 && (await page.$$('#det-votes tbody tr')).length === 5);
  check('benchmark panel and tab are gone', await page.evaluate(() => !document.getElementById('view-bench') && !document.getElementById('tab-bench') && !document.querySelector('canvas')));
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(SHOTS, 'mobile-detectors.png'), fullPage: true });
  await page.setViewportSize({ width: 667, height: 375 }); await sleep(300);
  await noOverflowAllTabs(page, '667 landscape');
  await page.setViewportSize({ width: 360, height: 640 }); await sleep(250);
  await noOverflowAllTabs(page, '360');
  await page.setViewportSize({ width: 375, height: 667 }); await sleep(200);

  check('no JS errors (phone)', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // ===================== desktop =====================
  console.log('Desktop 1440×900');
  ({ ctx, page, errors } = await open(browser, { viewport: { width: 1440, height: 900 } }));
  check('no shared passphrase anywhere in Try it or How it works', await page.evaluate(() =>
    !/tie5Roanl/.test(document.getElementById('view-try').textContent + document.getElementById('view-how').textContent) && !document.getElementById('phrase')));
  check('first visit shows only the password setup', await page.isVisible('#setup') && !(await page.isVisible('#pass')) && !(await page.isVisible('#reset')));
  await page.screenshot({ path: path.join(SHOTS, 'desktop-1440-setup.png') });
  // rules tick as you type
  const ruleState = () => page.evaluate(() => ['len', 'upper', 'number', 'special'].map((r) => document.getElementById('rule-' + r).className || '-').join(','));
  await page.fill('#su-pass', 'abc');
  check('"abc": every rule unmet', (await ruleState()) === 'unmet,unmet,unmet,unmet', await ruleState());
  await page.fill('#su-pass', 'Abcdefg1');
  check('"Abcdefg1": only the special character missing', (await ruleState()) === 'met,met,met,unmet', await ruleState());
  await page.click('#su-create');
  check('Create with a weak password: error, focus on the password, no account', /Fix the highlighted/.test(await page.textContent('#su-error')) &&
    (await page.evaluate(() => document.activeElement.id === 'su-pass' && !KeyPrint.hasAccount())));
  await page.fill('#su-pass', PW); await page.fill('#su-confirm', PW.slice(0, -1) + '?');
  check('confirm mismatch shown inline', /not the same/.test(await page.textContent('#su-confirm-msg')));
  await page.fill('#su-confirm', PW); await page.fill('#su-q', 'Hi'); await page.click('#su-create');
  check('too-short question refused', /at least 5/.test(await page.textContent('#su-q-msg')) && !(await page.evaluate(() => KeyPrint.hasAccount())));
  await page.fill('#su-pass', ''); await page.fill('#su-confirm', '');
  await setUp(page);
  check('setup done: Enroll step with the password box', await page.isVisible('#pass') && !(await page.isVisible('#setup')) && /Password saved/.test(await page.textContent('#status')));
  check('setup form cleared', await page.evaluate(() => ['su-pass', 'su-confirm', 'su-q', 'su-a'].every((id) => document.getElementById(id).value === '')));
  check('keyboard mode', !(await page.isVisible('#keypad')) && (await page.evaluate(() => KeyPrint.device())) === 'desktop');
  await noOverflowAllTabs(page, '1440');
  await page.click('#pass');
  await typeKeys(page, PASS);
  const xd = await page.evaluate(() => KeyPrint.lastVector());
  check('keyboard attempt -> 31 features (10 characters + Return)', xd && xd.length === 31, xd && xd.length);
  check('counted as sample 1', (await page.evaluate(() => KeyPrint.samples())) === 1);
  await typeKeys(page, 'Tr0ub4dor?'.split('').concat('Enter'));
  check('wrong password not counted', /not the password you created/.test(await page.textContent('#status')) && (await page.evaluate(() => KeyPrint.samples())) === 1);
  const tryParts = () => page.evaluate(() => [...document.querySelectorAll('#view-try .stage > *')].filter((el) => el.getBoundingClientRect().height && !el.classList.contains('sr-only')).map((el) => el.id || el.className).join(','));
  check('Enroll shows steps + input, message, Reset', (await tryParts()) === 'capture,status,reset-row', await tryParts());
  check('no third step', !(await page.$('#step-friend')));
  // a saved synthetic 11-key profile for this account loads as trained
  const loadSynthetic = (seed) => page.evaluate((seed) => {
    const a = JSON.parse(localStorage.getItem('keyprint.account.v1'));
    localStorage.setItem('keyprint.profile.v3', JSON.stringify({ app: 'KeyPrint', device: 'desktop', account: a.pwSalt, samples: KP.syntheticProfileSamples(seed, 10), frr: 0.05 }));
  }, seed);
  await loadSynthetic(7);
  await page.reload(); await sleep(150);
  check('desktop profile trained (synthetic example)', await page.evaluate(() => KeyPrint.trained() && KeyPrint.device() === 'desktop'));
  check('Verify step open once trained', await page.evaluate(() => !document.getElementById('step-verify').disabled));
  check('Verify hides Reset, shows "Is it really you?"', (await tryParts()) === 'capture,status,recover-row' && !(await page.isVisible('#reset')), await tryParts());
  check('"Is it really you?" is on Verify before any try', (await page.textContent('#recover-open')) === 'Is it really you?' && await page.isVisible('#recover-open'));
  await page.click('#step-enroll'); await sleep(60);
  check('"Is it really you?" is not on Enroll', !(await page.isVisible('#recover-open')));
  await page.click('#step-verify'); await sleep(60);
  await page.screenshot({ path: path.join(SHOTS, 'desktop-1440.png') });

  // wrong password on Verify: rejected, "Is it really you?" stays
  await page.click('#pass'); await typeKeys(page, 'Tr0ub4dor?'.split('').concat('Enter'));
  check('Verify, wrong password: rejected, "Is it really you?" still offered', /Rejected: that is not the password/.test(await page.textContent('#status')) && await page.isVisible('#recover-open'));
  // right password, but this robot is not the synthetic typist: rejected on rhythm -> "Is it really you?" -> security question
  await typeKeys(page, PASS);
  check('Verify, right password, other rhythm: rejected on rhythm', /Rejected: right password/.test(await page.textContent('#status')), await page.textContent('#status'));
  check('"Is it really you?" still offered after a rhythm reject', await page.isVisible('#recover-open'));
  await page.click('#recover-open');
  check('shows your own question', (await page.textContent('#recover-q')) === Q && await page.evaluate(() => document.activeElement.id === 'recover-a'));
  await page.fill('#recover-a', 'red comet'); await page.click('#recover-check');
  await page.waitForFunction(() => document.getElementById('recover-msg').textContent.length > 0);
  check('wrong answer refused', /not right/.test(await page.textContent('#recover-msg')) && !(await page.isVisible('#retrain')));
  await page.fill('#recover-a', '  blue   COMET '); await page.click('#recover-check');
  await page.waitForSelector('#retrain', { state: 'visible' });
  check('right answer (any case, extra spaces) lets you in and offers retraining', /Correct answer: you are in/.test(await page.textContent('#status')) && !(await page.isVisible('#recover')) && !(await page.isVisible('#recover-open')));
  await page.screenshot({ path: path.join(SHOTS, 'desktop-1440-recover.png') });
  await page.click('#retrain');
  check('Retrain clears the rhythm but keeps the password', await page.evaluate(() => KeyPrint.samples() === 0 && !KeyPrint.trained() && KeyPrint.hasAccount() &&
    document.getElementById('step-enroll').getAttribute('aria-current') === 'step') && !(await page.isVisible('#retrain')));

  // Reset lives on the Enroll step: first click arms, second wipes everything and asks for a new password
  await loadSynthetic(8); await page.reload(); await sleep(150);
  await page.click('#step-enroll'); await sleep(60);
  check('Enroll shows Reset', await page.isVisible('#reset'));
  await page.click('#reset');
  check('Reset asks for a second tap', /again/.test(await page.textContent('#reset')) && (await page.evaluate(() => KeyPrint.samples())) === 10);
  await page.click('#reset');
  check('Reset wipes password, question and profile and returns to setup', await page.evaluate(() => KeyPrint.samples() === 0 && !KeyPrint.trained() && !KeyPrint.hasAccount() &&
    localStorage.getItem('keyprint.account.v1') === null && localStorage.getItem('keyprint.profile.v3') === null) && await page.isVisible('#setup') && !(await page.isVisible('#pass')));
  check('Reset button label restored', (await page.textContent('#reset')).trim() === 'Reset');
  await page.reload(); await sleep(150);
  check('after reload, still asks for a new password', await page.isVisible('#setup'));
  // old shared-passphrase data is cleared, never loaded
  await page.evaluate(() => localStorage.setItem('keyprint.profile.v2', JSON.stringify({ app: 'KeyPrint', device: 'desktop', samples: KP.syntheticProfileSamples(7, 10) })));
  await page.reload(); await sleep(150);
  check('old .tie5Roanl profile removed, not used', await page.evaluate(() => localStorage.getItem('keyprint.profile.v2') === null && !KeyPrint.trained()) && await page.isVisible('#setup'));

  // How it works: plain walkthrough only, no Reset
  await page.click('#tab-how'); await sleep(120);
  check('How it works is a 7-step walkthrough', (await page.$$('#view-how .walk > li')).length === 7);
  check('How it works explains "Is it really you?"', /Is it really you\?/.test(await page.textContent('#view-how .walk')));
  check('old session panels are gone', await page.evaluate(() => ['timeline', 'rhythm', 'overall', 'verdicts', 'devs', 'tally', 'force-keypad', 'thr-table', 'test-out', 'export'].every((id) => !document.getElementById(id))));
  await page.screenshot({ path: path.join(SHOTS, 'desktop-1440-how.png'), fullPage: true });
  await page.click('#view-how a[data-goto="detectors"]'); await sleep(120);
  check('How it works links to the Detectors tab', await page.isVisible('#view-detectors') && (await page.getAttribute('#tab-detectors', 'aria-selected')) === 'true');
  await page.screenshot({ path: path.join(SHOTS, 'desktop-1440-detectors.png'), fullPage: true });
  await page.click('#tab-how'); await sleep(120);
  await page.reload(); await sleep(150);
  check('reload remembers the How it works tab', await page.isVisible('#view-how .walk'));
  check('How it works has no Reset', await page.evaluate(() => !document.querySelector('#view-how button.danger') && !document.getElementById('how-reset')));
  check('no JS errors (desktop)', errors.length === 0, errors.join(' | '));
  await ctx.close();
  await browser.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
