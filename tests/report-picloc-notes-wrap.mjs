/**
 * Picture Locations schedule: Notes wrap so the box can go skinnier
 * (Tim, Nov 23, 2026).
 *
 * Run: node tests/report-picloc-notes-wrap.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-picloc-notes-wrap';
const OUT = '/opt/cursor/artifacts';
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
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

const unit = await page.evaluate(() => {
  const api = window.ToolboxPenLog;
  const grid = api.buildSchedule(
    [{ id: 'p1', number: 1, photoLabel: '1', note: 'long note', location: 'Garage' }],
    {},
    true,
    { x: 8.8, y: 0.45, w: 5.5, h: 10.1, z: 2 },
  );
  const cols = grid.style.gridTemplateColumns || '';
  // Chrome serializes the zero floor as 0px.
  const floors = cols.match(/minmax\(0(?:px)?,\s*[\d.]+fr\)/g) || [];
  return {
    cols,
    hasMinmax: floors.length === 3,
  };
});
check('buildSchedule uses minmax(0, …fr) so Notes can shrink',
  unit.hasMinmax, JSON.stringify(unit));

await page.evaluate(async (id) => {
  const img = (() => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 800;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 800);
    x.strokeStyle = '#111'; x.lineWidth = 4; x.strokeRect(80, 60, 1040, 680);
    return c.toDataURL('image/jpeg', 0.9);
  })();
  await ToolboxDB.putMedia('plan-notes-wrap', img);
  const rec = ToolboxApp.blankCustomerFile(id);
  ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Ryan'; rec.lastName = 'Haddow';
  rec.propertyAddress = '8511 Calle Norte\nFarmington, NM 87402';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Floor';
  cv.plan = { id: 'plan-notes-wrap', width: 1200, height: 800 };
  const long =
    'Ceiling crack, coming off the high in the home and the high in the garage';
  rec.reportBuilder = {
    schema: 'toolbox.report-builder',
    schemaVersion: 1,
    penLog: {
      notes: {
        'pin-0': long,
        'pin-1': 'Garage — Cracked slab at Tim wall corner crack',
        'pin-2': 'Dining Room — Hairline tile crack spreading across the field',
      },
    },
    penLogLayout: {
      plan: { x: 0.4, y: 0.45, w: 10.5, h: 10.1, z: 1 },
      schedule: { x: 11.1, y: 0.45, w: 3.5, h: 10.1, z: 2 },
    },
  };
  const pins = [
    {
      id: 'pin-0', canvasId: cv.id, x: 0.35, y: 0.4,
      description: long, photos: ['ph-0'], areaName: 'Living Room',
    },
    {
      id: 'pin-1', canvasId: cv.id, x: 0.55, y: 0.45,
      description: 'Garage crack', photos: ['ph-1'], areaName: 'Garage',
    },
    {
      id: 'pin-2', canvasId: cv.id, x: 0.45, y: 0.6,
      description: 'Tile crack', photos: ['ph-2'], areaName: 'Dining Room',
    },
  ];
  rec.distress = { updatedAt: new Date().toISOString(), activeCanvasId: cv.id, pins };
  await ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-shell')?.getAttribute('data-report-ready') === 'true',
  { timeout: 90000 },
);
await new Promise((r) => setTimeout(r, 2000));

await page.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb')].find((el) =>
    (el.querySelector('.rb-thumb__caption')?.textContent || '').includes('Picture'));
  if (t) t.click();
});
await new Promise((r) => setTimeout(r, 1200));

const wide = await page.evaluate(() => {
  const schedule = document.querySelector('.rb-stage .rb-penlog__schedule');
  const note = document.querySelector('.rb-stage .rb-penlog__note');
  const sheet = document.querySelector('.rb-stage .rb-sheet:not(.rb-sheet--thumb)');
  if (!schedule || !note || !sheet) return null;
  const sr = sheet.getBoundingClientRect();
  const br = schedule.getBoundingClientRect();
  const nr = note.getBoundingClientRect();
  const cs = getComputedStyle(note);
  return {
    boxWIn: br.width / sr.width * 17,
    noteH: nr.height,
    noteW: nr.width,
    whiteSpace: cs.whiteSpace,
    overflowWrap: cs.overflowWrap,
    gridCols: schedule.querySelector('.rb-penlog__grid')?.style.gridTemplateColumns || '',
  };
});
check('Schedule opens with a measurable Notes field',
  wide && wide.noteW > 40 && wide.boxWIn > 2.5,
  JSON.stringify(wide));
check('Editor note CSS wraps (pre-wrap / anywhere)',
  wide && /pre-wrap/.test(wide.whiteSpace) && /anywhere|break-word/.test(wide.overflowWrap),
  JSON.stringify({ whiteSpace: wide?.whiteSpace, overflowWrap: wide?.overflowWrap }));

await page.screenshot({ path: `${OUT}/rb-picloc-notes-wrap-wide.png` }).catch(() => {});

const skinny = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-stage .rb-sheet:not(.rb-sheet--thumb)');
  const schedule = document.querySelector('.rb-stage .rb-penlog__schedule');
  const note = document.querySelector('.rb-stage textarea.rb-penlog__note');
  if (!sheet || !schedule || !note) return { err: 'missing' };
  const sr = sheet.getBoundingClientRect();
  const h0 = note.getBoundingClientRect().height;
  const w0In = schedule.getBoundingClientRect().width / sr.width * 17;
  // Same as mid corner-drag: shrink the box, then layoutSchedule wraps Notes.
  const midBox = { x: 14.5, y: 0.45, w: 1.7, h: 10.1, z: 2 };
  schedule.style.width = ((midBox.w / 17) * 100) + '%';
  schedule.style.left = ((midBox.x / 17) * 100) + '%';
  window.ToolboxPenLog.layoutSchedule(schedule, midBox);
  const h1 = note.getBoundingClientRect().height;
  const w1In = schedule.getBoundingClientRect().width / sr.width * 17;
  const cols = schedule.querySelector('.rb-penlog__grid')?.style.gridTemplateColumns || '';
  return {
    h0,
    h1,
    w0In,
    w1In,
    wrappedTaller: h1 > h0 + 4,
    gotSkinnier: w1In < w0In - 0.8,
    cols,
    hasMinmax: /minmax\(0/.test(cols),
  };
});
check('layoutSchedule makes the schedule box skinnier',
  skinny.gotSkinnier, JSON.stringify(skinny));
check('Notes grow taller when the box goes skinny (text wrapped)',
  skinny.wrappedTaller, JSON.stringify({ h0: skinny.h0, h1: skinny.h1, w1In: skinny.w1In }));
check('Live layout keeps minmax(0) column tracks',
  skinny.hasMinmax, skinny.cols);

await page.screenshot({ path: `${OUT}/rb-picloc-notes-wrap-after.png` }).catch(() => {});

// Also force layoutSchedule at 1.6 in and confirm fitCount still returns ≥1
const fit = await page.evaluate(() => {
  const api = window.ToolboxPenLog;
  const pins = [
    { id: 'a', number: 1, photoLabel: '1', note: 'Ceiling crack, coming off the high in the home and the high in the garage', location: 'Living Room' },
    { id: 'b', number: 2, photoLabel: '2', note: 'Garage — Cracked slab at Tim wall corner crack', location: 'Garage' },
    { id: 'c', number: 3, photoLabel: '3', note: 'Dining Room — Hairline tile crack spreading', location: 'Dining Room' },
  ];
  const wideBox = { x: 8.8, y: 0.45, w: 5.5, h: 10.1, z: 2 };
  const skinnyBox = { x: 14.8, y: 0.45, w: 1.6, h: 10.1, z: 2 };
  const wideFit = api.fitCount(pins, wideBox);
  const skinnyFit = api.fitCount(pins, skinnyBox);
  return {
    wideFit,
    skinnyFit,
    skinnyFitsFewerOrEqual: skinnyFit <= wideFit,
    skinnyAtLeastOne: skinnyFit >= 1,
  };
});
check('Skinny schedule still measures a real fitCount (≥1, ≤ wide)',
  fit.skinnyAtLeastOne && fit.skinnyFitsFewerOrEqual,
  JSON.stringify(fit));

// Seed already-skinny layout and confirm paint path wraps too.
const FILE2 = FILE + '-skinny';
await page.evaluate(async (id) => {
  const img = (() => {
    const c = document.createElement('canvas');
    c.width = 800; c.height = 600;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 600);
    x.strokeStyle = '#111'; x.lineWidth = 3; x.strokeRect(40, 30, 720, 540);
    return c.toDataURL('image/jpeg', 0.9);
  })();
  await ToolboxDB.putMedia('plan-notes-wrap-2', img);
  const rec = ToolboxApp.blankCustomerFile(id);
  ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Ryan'; rec.lastName = 'Haddow';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Floor';
  cv.plan = { id: 'plan-notes-wrap-2', width: 800, height: 600 };
  const long =
    'Ceiling crack, coming off the high in the home and the high in the garage';
  rec.reportBuilder = {
    schema: 'toolbox.report-builder',
    schemaVersion: 1,
    penLog: { notes: { 'pin-0': long } },
    penLogLayout: {
      plan: { x: 0.4, y: 0.45, w: 12.5, h: 10.1, z: 1 },
      schedule: { x: 13.2, y: 0.45, w: 1.7, h: 10.1, z: 2 },
    },
  };
  rec.distress = {
    updatedAt: new Date().toISOString(),
    activeCanvasId: cv.id,
    pins: [{
      id: 'pin-0', canvasId: cv.id, x: 0.4, y: 0.45,
      description: long, photos: ['ph-0'], areaName: 'Living Room',
    }],
  };
  await ToolboxDB.saveCustomerFile(rec);
}, FILE2);

await page.goto(`${BASE}#/file/${FILE2}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-shell')?.getAttribute('data-report-ready') === 'true',
  { timeout: 90000 },
);
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb')].find((el) =>
    (el.querySelector('.rb-thumb__caption')?.textContent || '').includes('Picture'));
  if (t) t.click();
});
await new Promise((r) => setTimeout(r, 1000));

const painted = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-stage .rb-sheet:not(.rb-sheet--thumb)');
  const schedule = document.querySelector('.rb-stage .rb-penlog__schedule');
  const note = document.querySelector('.rb-stage textarea.rb-penlog__note')
    || document.querySelector('.rb-stage .rb-penlog__note');
  if (!sheet || !schedule || !note) return null;
  const sr = sheet.getBoundingClientRect();
  const line = parseFloat(getComputedStyle(note).lineHeight) || 14;
  const h = note.getBoundingClientRect().height;
  return {
    boxWIn: schedule.getBoundingClientRect().width / sr.width * 17,
    noteH: h,
    lines: h / line,
    multiLine: h > line * 1.6,
  };
});
check('Painted skinny schedule wraps the long note onto multiple lines',
  painted && painted.boxWIn < 2.2 && painted.multiLine,
  JSON.stringify(painted));

check('No page errors', pageErrors.length === 0, pageErrors.join(' | '));

await page.screenshot({ path: `${OUT}/rb-picloc-notes-wrap-skinny.png` }).catch(() => {});
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
