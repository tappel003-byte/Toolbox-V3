/**
 * The colour scale and the readings pill: reachable, resizable, and the same
 * size wherever they are put.
 * Run: node tests/report-floor-chrome-qa.mjs   (needs a static server on 8765)
 *
 * Three faults Tim found on his own job, all of them real:
 *
 *  - "There's nothing to change the contour legend. You can't change the pill
 *    size." Both controls exist, far down the rail under Labels & layers --
 *    but the rail pinned its buttons and gave the controls whatever height
 *    was left. On a 1536 x 864 screen that was 64px of a 1,000px panel, which
 *    reads as gone. The rail is one scroller now.
 *  - Pressing + on Stats pill size moved the readout and not the pill. Floor
 *    Survey keeps that size on the device and announces it on the window;
 *    Report Builder read the number when it drew a sheet and never listened,
 *    so nothing was redrawn. Legend size never had the fault, because it
 *    travels in the slide's own settings.
 *  - "The pill actually compresses if you move it too far to the right." An
 *    absolutely positioned box with width:auto is squeezed by its container's
 *    edge: at the right margin the pill went 138px -> 84px and wrapped.
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-chrome-qa';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1700, height: 1050, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const plan = (() => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, 1200, 900);
    x.strokeStyle = '#111';
    x.lineWidth = 6;
    x.strokeRect(50, 50, 1100, 800);
    return c.toDataURL('image/jpeg', 0.9);
  })();
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Janis';
  rec.lastName = 'Fensterer';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-qa', plan);
  cv.plan = { id: 'plan-qa', width: 1200, height: 900 };
  cv.frontDoorFacing = 'N';
  const poly = [{ x: 60, y: 60 }, { x: 1140, y: 60 }, { x: 1140, y: 840 }, { x: 60, y: 840 }];
  const points = [];
  let n = 0;
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      n += 1;
      points.push({ id: 'p' + n, floorId: cv.id, index: n,
        x: 180 + c * 250, y: 200 + r * 220, value: 7 + ((n * 9) % 27) / 10 });
    }
  }
  rec.floorSurvey = { id: 'fs-qa', inspectionDate: '2026-10-09', byCanvasId: {
    [cv.id]: { canvasId: cv.id, points,
      areas: [{ id: 'a1', name: 'Main Level', polygon: poly, createdAt: 1 }], boundary: poly } } };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 7000));
const at = await page.evaluate(() => [...document.querySelectorAll('.rb-thumb')]
  .findIndex((t) => /Floor ·/i.test((t.querySelector('.rb-thumb__caption') || {}).textContent || '')));
await page.evaluate((n) => document.querySelectorAll('.rb-thumb')[n].click(), at);
await new Promise((r) => setTimeout(r, 4000));

const box = (id) => page.evaluate((b) => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const stage = sheet.querySelector('[data-rb-floor-stage]');
  const el = sheet.querySelector('[data-rb-floor-box="' + b + '"]');
  if (!el || !stage) return null;
  const r = el.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height),
    leftPct: +(((r.left - sr.left) / sr.width) * 100).toFixed(1),
    topPct: +(((r.top - sr.top) / sr.height) * 100).toFixed(1) };
}, id);

async function dragBy(id, dx, dy) {
  const at2 = await page.evaluate((b) => {
    const el = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box="' + b + '"]');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
  await page.mouse.move(at2.x, at2.y);
  await page.mouse.down();
  await page.mouse.move(at2.x + dx, at2.y + dy, { steps: 10 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 420));
}

// --- The rail shows its controls, on a short screen as well as a tall one ---
async function controlsRoom() {
  return page.evaluate(() => {
    const body = document.querySelector('[data-rb-rail-body]');
    const controls = document.querySelector('.rb-ws__controls');
    const h = (el) => (el ? Math.round(el.getBoundingClientRect().height) : 0);
    return { body: h(body), controls: h(controls),
      wanted: controls ? controls.scrollHeight : 0 };
  });
}
const tall = await controlsRoom();
await page.setViewport({ width: 1536, height: 864 });
await new Promise((r) => setTimeout(r, 2200));
const short = await controlsRoom();
check('the Floor Survey controls keep their full height on a short screen',
  short.controls >= short.wanted - 2 && tall.controls >= tall.wanted - 2 &&
  short.controls > 300,
  JSON.stringify({ tall, short }));

const named = await page.evaluate(() => {
  const panel = document.querySelector('.rb-panel');
  const names = [...panel.querySelectorAll('label')].map((n) => (n.textContent || '').trim());
  return { legend: names.includes('Legend size'), pill: names.includes('Stats pill size') };
});
check('Legend size and Stats pill size are both in the rail',
  named.legend && named.pill, JSON.stringify(named));
await page.setViewport({ width: 1700, height: 1050 });
await new Promise((r) => setTimeout(r, 2000));

// --- Both size controls actually move their piece on the sheet ---
async function bump(label, times) {
  for (let i = 0; i < times; i += 1) {
    const ok = await page.evaluate((t) => {
      const b = [...document.querySelectorAll('.rb-panel button[aria-label]')]
        .find((n) => new RegExp('^Increase ' + t + '$', 'i').test(n.getAttribute('aria-label') || ''));
      if (!b) return false;
      b.click();
      return true;
    }, label);
    if (!ok) return false;
    await new Promise((r) => setTimeout(r, 700));
  }
  await new Promise((r) => setTimeout(r, 1200));
  return true;
}

const legendWas = await box('legend-0');
check('Legend size is a control that can be pressed', await bump('Legend size', 3));
const legendNow = await box('legend-0');
check('and pressing it makes the colour scale on the sheet bigger',
  legendNow.w > legendWas.w + 5 && legendNow.h > legendWas.h + 5,
  JSON.stringify({ was: legendWas, now: legendNow }));

const pillWas = await box('pill-0');
check('Stats pill size is a control that can be pressed', await bump('Stats pill size', 3));
const pillNow = await box('pill-0');
check('and pressing it makes the readings on the sheet bigger',
  pillNow.w > pillWas.w + 5 && pillNow.h > pillWas.h + 1,
  JSON.stringify({ was: pillWas, now: pillNow }));

// --- Neither piece is squeezed by the edge of the paper ---
const pillMiddle = await box('pill-0');
for (let i = 0; i < 7; i += 1) await dragBy('pill-0', 170, 0);
const pillRight = await box('pill-0');
check('the readings keep their size pushed to the right-hand edge',
  pillRight.w === pillMiddle.w && pillRight.h === pillMiddle.h && pillRight.leftPct > 80,
  JSON.stringify({ middle: pillMiddle, right: pillRight }));

for (let i = 0; i < 7; i += 1) await dragBy('pill-0', 0, 130);
const pillBottom = await box('pill-0');
check('and pushed to the foot of the sheet',
  pillBottom.w === pillMiddle.w && pillBottom.h === pillMiddle.h && pillBottom.topPct > 70,
  JSON.stringify({ middle: pillMiddle, bottom: pillBottom }));

const legendMiddle = await box('legend-0');
for (let i = 0; i < 7; i += 1) await dragBy('legend-0', 170, 0);
const legendRight = await box('legend-0');
check('the colour scale does the same',
  legendRight.w === legendMiddle.w && legendRight.h === legendMiddle.h &&
  legendRight.leftPct > 80,
  JSON.stringify({ middle: legendMiddle, right: legendRight }));

// --- Locking a piece does not change its size ---
//
// The lock used to prefer a size the piece had been locked at before, so
// after unlocking it, resizing it and locking it again, it jumped back to
// the older size the instant it was locked. Tim: "lock contour vs unlock the
// legend changes size."
async function toggle(label) {
  await page.evaluate((t) => {
    const b = [...document.querySelectorAll('[data-rb-floor-piece-lock]')]
      .find((n) => new RegExp('^(Lock|Unlock) ' + t + '$', 'i').test((n.textContent || '').trim()));
    if (b) b.click();
  }, label);
  await new Promise((r) => setTimeout(r, 2200));
}
await toggle('contour legend');            // locked, at whatever size it is
const lockedFirst = await box('legend-0');
await toggle('contour legend');            // unlocked again
await bump('Legend size', 2);              // and made bigger
const biggerUnlocked = await box('legend-0');
await toggle('contour legend');            // locked at the NEW size
const lockedAgain = await box('legend-0');
check('locking a piece leaves it exactly the size it already was',
  Math.abs(lockedAgain.w - biggerUnlocked.w) <= 1 &&
  Math.abs(lockedAgain.h - biggerUnlocked.h) <= 1 &&
  biggerUnlocked.w > lockedFirst.w,
  JSON.stringify({ lockedFirst, biggerUnlocked, lockedAgain }));
await toggle('contour legend');            // leave it unlocked for what follows

// --- A locked piece still answers its own size control ---
await page.evaluate(() => {
  const b = [...document.querySelectorAll('[data-rb-floor-piece-lock]')]
    .find((n) => /^Lock high\/low\/delta$/i.test((n.textContent || '').trim()));
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 2200));
const lockedWas = await box('pill-0');
await bump('Stats pill size', 3);
const lockedNow = await box('pill-0');
check('a locked piece is still resized by the control that sizes it',
  lockedNow.w > lockedWas.w + 2,
  JSON.stringify({ was: lockedWas, now: lockedNow }));

await page.screenshot({ path: `${OUT}/report-floor-chrome-qa.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
