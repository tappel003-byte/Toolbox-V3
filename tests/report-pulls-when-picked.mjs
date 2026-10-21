/**
 * A resize pull shows on the box being worked on, and on no other box, and
 * never on paper.
 * Run: node tests/report-pulls-when-picked.mjs   (needs a static server on 8765)
 *
 * They used to come out on hover, which fails three ways: a pointer passing
 * over a box is not a choice to work on it; a box reached any other way has
 * no pulls at all; and on a Floor Survey sheet one click on the drawing lit
 * every box on the page at once.
 *
 * Tim: "Yes I do like the corner pull but I don't like them visible all the
 * time. I wanted them to where you highlighted it." And: chevrons are the
 * resize pull, "and they only show up when the box is highlighted, period."
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
const FILE = 'rb-pulls';
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

// One level with readings and a photograph, which gives a Floor Survey sheet
// carrying an aerial view and a Picture Locations sheet carrying two boxes.
await page.evaluate(async (id) => {
  const shot = (tone) => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = tone;
    x.fillRect(0, 0, 1200, 900);
    x.strokeStyle = '#111';
    x.lineWidth = 6;
    x.strokeRect(50, 50, 1100, 800);
    return c.toDataURL('image/jpeg', 0.9);
  };
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Dana';
  rec.lastName = 'Whitfield';
  rec.propertyAddress = '44 Audit Road\nSanta Fe, NM 87505';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-pulls', shot('#ffffff'));
  cv.plan = { id: 'plan-pulls', width: 1200, height: 900 };
  cv.frontDoorFacing = 'N';
  const poly = [{ x: 60, y: 60 }, { x: 1140, y: 60 }, { x: 1140, y: 840 }, { x: 60, y: 840 }];
  const points = [];
  let n = 0;
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      n += 1;
      points.push({ id: 'p' + n, floorId: cv.id, index: n,
        x: 180 + c * 250, y: 200 + r * 220, value: 7 + ((n * 7) % 25) / 10 });
    }
  }
  rec.floorSurvey = { id: 'fs-pulls', inspectionDate: '2026-10-09', byCanvasId: {
    [cv.id]: { canvasId: cv.id, points,
      areas: [{ id: 'a1', name: 'Main Level', polygon: poly, createdAt: 1 }], boundary: poly } } };
  await window.ToolboxDB.putMedia('ph-pulls', shot('#cdd6c8'));
  rec.distress = { updatedAt: new Date().toISOString(), mode: 'internal', startNum: 1, nextNum: 2,
    activeCanvasId: cv.id,
    pins: [{ id: 'pin-1', num: 1, canvasId: cv.id, x: 400, y: 400,
      location: 'Kitchen', description: 'Crack at the sill.', photos: [{ id: 'ph-pulls' }] }] };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 6000));

async function openSheet(match) {
  const at = await page.evaluate((m) => [...document.querySelectorAll('.rb-thumb')]
    .findIndex((t) => new RegExp(m, 'i')
      .test((t.querySelector('.rb-thumb__caption') || {}).textContent || '')), match);
  if (at < 0) return false;
  await page.evaluate((n) => document.querySelectorAll('.rb-thumb')[n].click(), at);
  await new Promise((r) => setTimeout(r, 3500));
  return true;
}

/** Every pull on the open sheet, and whether it is drawn. */
const pulls = (selector) => page.evaluate((sel) => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  return [...sheet.querySelectorAll(sel)]
    .map((el) => getComputedStyle(el).display !== 'none');
}, selector);

const atCentre = (selector) => page.evaluate((sel) => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const el = sheet.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, selector);

// --- The cover: boxes that always carry pulls ---
check('the cover is the sheet the report opens on',
  await page.evaluate(() => !!document.querySelector(
    '.rb-sheet:not(.rb-sheet--thumb) [data-rb-cover-box]')));

const coverBefore = await pulls('[data-rb-cover-box] .rb-cover-box__resize');
check('no pull is on show before a box is picked',
  coverBefore.length > 0 && coverBefore.every((shown) => !shown),
  JSON.stringify(coverBefore));

// Hovering is not picking.
const identity = await atCentre('[data-rb-cover-box="identity"]');
if (identity) {
  await page.mouse.move(identity.x, identity.y);
  await new Promise((r) => setTimeout(r, 500));
}
const onHover = await pulls('[data-rb-cover-box="identity"] .rb-cover-box__resize');
check('pointing at a box is not enough to bring them out',
  onHover.length > 0 && onHover.every((shown) => !shown),
  JSON.stringify(onHover));

// Clicking is.
if (identity) {
  await page.mouse.click(identity.x, identity.y);
  await new Promise((r) => setTimeout(r, 600));
}
const onIdentity = await pulls('[data-rb-cover-box="identity"] .rb-cover-box__resize');
check('clicking a cover box brings out its pull',
  onIdentity.length > 0 && onIdentity.every((shown) => shown),
  JSON.stringify(onIdentity));

// And it stays out when the pointer leaves.
await page.mouse.move(20, 1000);
await new Promise((r) => setTimeout(r, 400));
const afterLeaving = await pulls('[data-rb-cover-box="identity"] .rb-cover-box__resize');
check('and they stay out when the pointer goes elsewhere',
  afterLeaving.length > 0 && afterLeaving.every((shown) => shown),
  JSON.stringify(afterLeaving));

// No other box on the cover is lit.
const elsewhere = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  return [...sheet.querySelectorAll('[data-rb-cover-box]')]
    .filter((box) => box.getAttribute('data-rb-cover-box') !== 'identity')
    .map((box) => [...box.querySelectorAll('.rb-cover-box__resize')]
      .some((el) => getComputedStyle(el).display !== 'none'));
});
check('no other box on the sheet lit up with it',
  elsewhere.length > 0 && elsewhere.every((shown) => !shown), JSON.stringify(elsewhere));

// --- A Floor Survey sheet: nothing on show until something is picked ---
if (await openSheet('Floor \u00b7')) {
  const floorPulls = await page.evaluate(() => {
    const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
    return [...sheet.querySelectorAll('.rb-floor-box__resize, [data-plan-resize]')]
      .map((el) => getComputedStyle(el).display !== 'none');
  });
  check('a Floor Survey sheet opens with no pull drawn on it',
    floorPulls.every((shown) => !shown), JSON.stringify(floorPulls));
}

// --- A Picture Locations sheet: two boxes, one picked at a time ---
if (await openSheet('Picture Locations')) {
  const planAt = await atCentre('[data-rb-penlog-box="plan"]');
  if (planAt) {
    await page.mouse.click(planAt.x, planAt.y);
    await new Promise((r) => setTimeout(r, 500));
  }
  const penState = await page.evaluate(() => {
    const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
    const shownIn = (which) => {
      const box = sheet.querySelector('[data-rb-penlog-box="' + which + '"]');
      if (!box) return null;
      return [...box.querySelectorAll('.rb-penlog__move, .rb-penlog__resize')]
        .some((el) => getComputedStyle(el).display !== 'none');
    };
    return { plan: shownIn('plan'), schedule: shownIn('schedule') };
  });
  check('on a Picture Locations sheet only the picked box carries pulls',
    penState.plan === true && penState.schedule === false, JSON.stringify(penState));
}

// --- Nothing prints ---
await page.evaluate(() => { window.print = () => {}; });
await page.emulateMediaType('print');
await page.click('#rb-print');
await page.waitForFunction(() => !!document.querySelector('.rb-print .rb-sheet'), { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));
const printed = await page.evaluate(() => [...document.querySelectorAll(
  '.rb-print .rb-floor-box__resize, .rb-print .rb-cover-box__resize, ' +
  '.rb-print .rb-penlog__resize, .rb-print .rb-penlog__move, ' +
  '.rb-print .rb-cover-box__move, .rb-print [data-plan-resize]')]
  .map((el) => getComputedStyle(el).display !== 'none'));
check('and not one pull is drawn on the printed deck',
  printed.every((shown) => !shown),
  JSON.stringify({ found: printed.length, shown: printed.filter(Boolean).length }));
await page.emulateMediaType(null);

await page.screenshot({ path: `${OUT}/report-pulls-when-picked.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
