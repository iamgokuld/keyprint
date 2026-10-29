// node test_e2e.js — browser tests with Playwright + Chromium (not part of `npm test`; needs `npm i -D playwright`).
// Phone (375×667, touch, DPR 2): real touch input via CDP, keypad attempt -> 31 + 22 features, multi-touch, wrong key,
// enroll + verify, canvas DPR + resize, touch targets, no horizontal overflow.
// Desktop (1440×900): keyboard attempt -> 31 features, forced keypad with separate profile. Writes docs/screenshots/*.png.
'use strict';
const path = require('path');
const fs = require('fs');
const { check, done } = require('./test_util');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('@playwright/test')); }

const URL = 'file://' + path.join(__dirname, 'index.html');
const SHOTS = path.join(__dirname, 'docs', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const PASS = ['.', 't', 'i', 'e', '5', 'R', 'o', 'a', 'n', 'l', 'Enter'];
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
  for (const t of ['try', 'bench', 'how']) {
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
async function keyBoxes(page, sel) {
  return page.evaluate((sel) => (document.querySelector(sel).scrollIntoView({ block: 'center' }), Object.fromEntries([...document.querySelectorAll(sel + ' [data-k]')].map((b) => {
    const r = b.getBoundingClientRect(); return [b.dataset.k, { x: r.left, y: r.top, w: r.width, h: r.height }];
  }))), sel);
}
/** One keypad attempt. off(i) -> [fx, fy] tap offset in key units; overlap(i) -> true: key i+1 lands before key i lifts. */
async function tapAttempt(page, t, sel, opts) {
  opts = opts || {};
  const boxes = await keyBoxes(page, sel), keys = opts.keys || PASS;
  let id = opts.id0 || 1;
  for (let i = 0; i < keys.length; i++) {
    const b = boxes[keys[i]], [fx, fy] = opts.off ? opts.off(i) : [0, 0.1];
    const me = id++;
    await t.down(me, b.x + b.w * (0.5 + fx), b.y + b.h * (0.5 + fy));
    const hold = 45 + Math.round(Math.random() * 30), gap = 70 + Math.round(Math.random() * 40);
    if (opts.overlap && opts.overlap(i) && i < keys.length - 1) {
      // next key lands first, then this one lifts: overlapping taps
      const n = boxes[keys[i + 1]], nid = id++;
      await sleep(hold); await t.down(nid, n.x + n.w * 0.5, n.y + n.h * 0.6); await sleep(25); await t.up(me);
      await sleep(hold); await t.up(nid); await sleep(gap); i++;
    } else { await sleep(hold); await t.up(me); await sleep(gap); }
  }
  return id;
}
async function targets(page, scope) {
  return page.evaluate((scope) => {
    const sel = 'button:not(.kp-key):not([disabled]),[role=tab],select,summary,.switch,.consent label,input[type=range],.kp-key';
    return [...document.querySelectorAll(scope + ' ' + sel + ',' + sel.split(',').map((s) => 'header ' + s).join(','))]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.height && !el.closest('[hidden]'); })
      .map((el) => { const r = el.getBoundingClientRect(); return { el: (el.id || el.className || el.tagName) + ':' + (el.textContent || '').trim().slice(0, 16), w: r.width, h: r.height }; })
      .filter((t) => t.w < 44 || t.h < 44);
  }, scope);
}

(async () => {
  const browser = await chromium.launch();

  // ===================== phone =====================
  console.log('Phone 375×667 (touch, DPR 2)');
  const phone = { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  let { ctx, page, errors } = await open(browser, phone);
  const cdp = await ctx.newCDPSession(page), t = toucher(cdp);
  check('keypad shown, text field hidden', await page.isVisible('#keypad') && !(await page.isVisible('#pass')));
  check('phone profile selected', (await page.evaluate(() => KeyPrint.device())) === 'mobile');
  check('not marked as testing on a touch device', !(await page.isVisible('#mode-note')));
  const small = await targets(page, '#view-try');
  check('touch targets ≥ 44 px (Try it)', small.length === 0, JSON.stringify(small.slice(0, 6)));
  const keySize = await page.evaluate(() => { const r = document.querySelector('#keypad [data-k="t"]').getBoundingClientRect(); return [r.width, r.height]; });
  check('keypad keys ≥ 44 × 44', keySize[0] >= 44 && keySize[1] >= 44, keySize.join('×'));
  check('keypad: touch-action / user-select', await page.evaluate(() => {
    const k = getComputedStyle(document.querySelector('.kp-key')), p = getComputedStyle(document.getElementById('keypad'));
    return p.touchAction === 'manipulation' && k.touchAction === 'none' && k.userSelect === 'none';
  }));
  await noOverflowAllTabs(page, '375');

  // wrong key resets + counter
  await t.down(1, ...(await (async () => { const b = (await keyBoxes(page, '#keypad'))['.']; return [b.x + b.w / 2, b.y + b.h / 2]; })())); await sleep(50); await t.up(1);
  const bi = (await keyBoxes(page, '#keypad')).i; await t.down(2, bi.x + bi.w / 2, bi.y + bi.h / 2); await sleep(50); await t.up(2);
  check('wrong key discards and counts', (await page.textContent('#rejects')).trim() === '1 discarded' && /Wrong key/.test(await page.textContent('#status')));

  // a full attempt with known tap offsets and two overlapping pairs
  const OFF = (i) => [((i % 5) - 2) * 0.1, i % 2 ? -0.2 : 0.2];
  await tapAttempt(page, t, '#keypad', { id0: 10, off: OFF, overlap: (i) => i === 1 || i === 6 });
  const x = await page.evaluate(() => KeyPrint.lastVector());
  check('full keypad attempt -> 31 + 22 = 53 features', Array.isArray(x) && x.length === 53 && x.every(Number.isFinite), x && x.length);
  const holds = x ? x.filter((v, j) => j < 31 && j % 3 === 0) : [];
  check('hold times plausible (30–300 ms)', holds.length === 11 && holds.every((h) => h > 0.03 && h < 0.3), holds.map((h) => (h * 1000).toFixed(0)).join(' '));
  check('overlapping taps -> negative UD (t→i, o→a)', x && x[5] < 0 && x[20] < 0, x && [x[5], x[20]].map((v) => v.toFixed(3)).join(', '));
  const offErr = x ? Math.max(...PASS.map((_, i) => (i === 2 || i === 7) ? 0 : Math.max(Math.abs(x[31 + 2 * i] - OFF(i)[0]), Math.abs(x[32 + 2 * i] - OFF(i)[1])))) : 1;
  check('tap offsets match where we touched (±0.02 key)', offErr < 0.02, offErr.toFixed(4));
  check('no text field focused (system keyboard never opens)', await page.evaluate(() => !/^(INPUT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName)));
  check('tap dots drawn on the keypad', (await page.$$('#keypad .tap')).length === 11);

  // enroll 10 + verify
  for (let k = 1; k < 10; k++) await tapAttempt(page, t, '#keypad', { id0: 100 * k, off: (i) => [0.05 * Math.sin(i + k), 0.1] });
  check('10 keypad samples -> trained phone profile', await page.evaluate(() => KeyPrint.trained() && KeyPrint.samples() === 10));
  await tapAttempt(page, t, '#keypad', { id0: 5000, off: () => [0, 0.1] });
  check('verify attempt gives a verdict', /ACCEPT|REJECT/.test(await page.textContent('#overall')));
  check('deviation table names position features sensibly', !/undefined/.test(await page.textContent('#devs')));
  await page.screenshot({ path: path.join(SHOTS, 'mobile-375.png') });
  await page.screenshot({ path: path.join(SHOTS, 'mobile-375-full.png'), fullPage: true });
  const prof = await page.evaluate(() => { return JSON.parse(localStorage.getItem('keyprint.profile.mobile.v1')); });
  check('phone profile stored separately with device type', prof && prof.device === 'mobile' && prof.samples[0].length === 53);
  check('desktop slot untouched', await page.evaluate(() => localStorage.getItem('keyprint.profile.v2') === null || JSON.parse(localStorage.getItem('keyprint.profile.v2')).samples.length === 0));

  // canvases: DPR-scaled, follow resizes
  await page.click('#tab-bench'); await sleep(200);
  const cv = await page.evaluate(() => { const c = document.getElementById('c-roc'); return { w: c.width, cw: c.clientWidth, h: c.height, ch: c.clientHeight }; });
  check('canvas backing store = CSS size × DPR 2', cv.w === Math.round(cv.cw * 2) && cv.h === Math.round(cv.ch * 2), JSON.stringify(cv));
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(SHOTS, 'mobile-bench.png') });
  await page.setViewportSize({ width: 667, height: 375 }); await sleep(300);
  const cv2 = await page.evaluate(() => { const c = document.getElementById('c-roc'); return { w: c.width, cw: c.clientWidth }; });
  check('ResizeObserver redraws on rotate (landscape)', cv2.cw > cv.cw && cv2.w === Math.round(cv2.cw * 2), JSON.stringify(cv2));
  await noOverflowAllTabs(page, '667 landscape');
  await page.setViewportSize({ width: 360, height: 640 }); await sleep(250);
  await noOverflowAllTabs(page, '360');
  await page.setViewportSize({ width: 375, height: 667 }); await sleep(200);

  check('no JS errors (phone)', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // phone, dark mode screenshot
  ({ ctx, page, errors } = await open(browser, Object.assign({ colorScheme: 'dark' }, phone)));
  await page.screenshot({ path: path.join(SHOTS, 'mobile-375-dark.png') });
  await ctx.close();

  // ===================== desktop =====================
  console.log('Desktop 1440×900');
  ({ ctx, page, errors } = await open(browser, { viewport: { width: 1440, height: 900 } }));
  check('keyboard mode by default', await page.isVisible('#pass') && !(await page.isVisible('#keypad')) && (await page.evaluate(() => KeyPrint.device())) === 'desktop');
  await noOverflowAllTabs(page, '1440');
  await page.click('#pass');
  for (const k of PASS) {
    if (k === 'R') await page.keyboard.down('Shift');
    await page.keyboard.down(k); await sleep(50); await page.keyboard.up(k); if (k === 'R') await page.keyboard.up('Shift'); await sleep(60);
  }
  const xd = await page.evaluate(() => KeyPrint.lastVector());
  check('keyboard attempt -> 31 features', xd && xd.length === 31, xd && xd.length);
  await page.evaluate(() => document.getElementById('load-example').click()); await sleep(100);
  check('desktop profile trained (synthetic example)', await page.evaluate(() => KeyPrint.trained() && KeyPrint.device() === 'desktop'));
  await page.screenshot({ path: path.join(SHOTS, 'desktop-1440.png') });
  // force keypad: clearly labelled, separate profile, mouse taps give 53 features
  await page.click('label.switch');
  check('forced keypad labelled as testing', await page.isVisible('#mode-note') && /forced/.test(await page.textContent('#mode-badge')));
  check('switching to keypad loads the (empty) phone profile', await page.evaluate(() => KeyPrint.device() === 'mobile' && KeyPrint.samples() === 0 && !KeyPrint.trained()));
  const bx = await keyBoxes(page, '#keypad');
  for (const k of PASS) { const b = bx[k]; await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2); await page.mouse.down(); await sleep(50); await page.mouse.up(); await sleep(50); }
  check('mouse on forced keypad -> 53 features', (await page.evaluate(() => KeyPrint.lastVector().length)) === 53);
  await page.screenshot({ path: path.join(SHOTS, 'desktop-1440-keypad.png') });
  const imported = await page.evaluate(() => { document.getElementById('json-box').value = JSON.stringify({ app: 'KeyPrint', samples: [] }); document.getElementById('import-text').click(); return document.getElementById('pr-status').textContent; });
  check('a keyboard profile is refused while on the keypad', /keyboard\) profile|keyboard profile/.test(imported), imported);
  await page.click('label.switch');
  check('switching back restores the desktop profile', await page.evaluate(() => KeyPrint.device() === 'desktop' && KeyPrint.trained()));
  check('no JS errors (desktop)', errors.length === 0, errors.join(' | '));
  await ctx.close();
  await browser.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
