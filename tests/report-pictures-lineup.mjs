/**
 * Every picture on a Pictures sheet is clipped to the identical plate, and a
 * long description shrinks its own type rather than lifting its picture.
 * Run: node tests/report-pictures-lineup.mjs   (needs a static server on 8765)
 *
 * The caption used to take the room its words needed, with the plate above it
 * giving way. One wordy description therefore sat its photograph higher than
 * the ones beside it, and a row of pictures no longer lined up.
 *
 * Tim, on his own deck: "Pictures look good except for the one in the upper
 * right hand corner, which has apparently too much text to center the
 * picture." And: "If you clip the picture the exact same size every fucking
 * time, the middle never changes... I want to shrink the font. I said that
 * already."
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
const FILE = 'rb-lineup';
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

// Eight photographs of deliberately different shapes -- tall, wide, square --
// because the plate must be the same whatever the picture in it is.
await page.evaluate(async (id) => {
  const shot = (w, h, tone) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = tone;
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#222';
    x.fillRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
    return c.toDataURL('image/jpeg', 0.85);
  };
  const plan = shot(1200, 900, '#ffffff');
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Dana';
  rec.lastName = 'Whitfield';
  rec.propertyAddress = '44 Audit Road\nSanta Fe, NM 87505';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-lineup', plan);
  cv.plan = { id: 'plan-lineup', width: 1200, height: 900 };

  // One description far longer than the rest: the case that used to break
  // the row.
  const long = 'Stair-step separation through the mortar joints continuing up ' +
    'the full height of the wall from the foundation to the top plate, with ' +
    'displacement measured at the widest point and daylight visible through ' +
    'the joint at the north end of the run near the chimney chase.';
  const shapes = [[900, 1200], [1600, 900], [1000, 1000], [900, 1400],
    [1500, 1000], [1200, 1200], [800, 1200], [1600, 1100]];
  const pins = [];
  for (let i = 0; i < shapes.length; i += 1) {
    const photoId = 'ph-line-' + (i + 1);
    await window.ToolboxDB.putMedia(photoId, shot(shapes[i][0], shapes[i][1], '#cdd6c8'));
    pins.push({ id: 'pin-line-' + (i + 1), num: i + 1, canvasId: cv.id,
      x: 200 + (i % 4) * 220, y: 250 + Math.floor(i / 4) * 300,
      location: 'Room ' + (i + 1),
      description: i === 3 ? long : 'Crack at the sill.',
      photos: [{ id: photoId }] });
  }
  rec.distress = { updatedAt: new Date().toISOString(), mode: 'internal', startNum: 1,
    nextNum: pins.length + 1, activeCanvasId: cv.id, pins };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 5000));

const at = await page.evaluate(() => [...document.querySelectorAll('.rb-thumb')]
  .findIndex((t) => /Pictures/i.test((t.querySelector('.rb-thumb__caption') || {}).textContent || '')));
check('the job produced a Pictures sheet', at >= 0, String(at));
await page.evaluate((n) => document.querySelectorAll('.rb-thumb')[n].click(), at);
await page.waitForFunction(
  () => document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) .rb-pictures-page__cell').length >= 4,
  { timeout: 20000 });
await new Promise((r) => setTimeout(r, 2500));

/** Every cell, measured against the sheet it is drawn on. */
const cells = () => page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  return [...sheet.querySelectorAll('.rb-pictures-page__cell')].map((cell) => {
    const frame = cell.querySelector('.rb-pictures-page__frame');
    const cap = cell.querySelector('.rb-pictures-page__caption');
    const img = cell.querySelector('.rb-pictures-page__image');
    const fr = frame.getBoundingClientRect();
    const cr = cap.getBoundingClientRect();
    return {
      frameTop: Math.round(fr.top), frameH: Math.round(fr.height),
      capTop: Math.round(cr.top), capH: Math.round(cr.height),
      size: Math.round(parseFloat(getComputedStyle(cap).fontSize) * 100) / 100,
      overflows: cap.scrollHeight > cap.clientHeight + 1,
      imgBottom: img ? Math.round(img.getBoundingClientRect().bottom) : null,
      chars: (cap.value || '').length,
    };
  });
});

const before = await cells();
const spread = (list, key) => Math.max(...list.map((c) => c[key])) - Math.min(...list.map((c) => c[key]));

check('every plate is the same height, whatever picture is in it',
  spread(before, 'frameH') <= 1,
  JSON.stringify(before.map((c) => c.frameH)));

check('every caption block is the same height too',
  spread(before, 'capH') <= 1,
  JSON.stringify(before.map((c) => c.capH)));

// Pictures in one row sit on a common bottom edge, which is what "lined up"
// means to the eye.
const rowOne = before.slice(0, 4);
check('the pictures along a row sit on the same line',
  spread(rowOne, 'imgBottom') <= 2,
  JSON.stringify(rowOne.map((c) => c.imgBottom)));

const longAt = before.findIndex((c) => c.chars > 150);
check('the long description shrank its own type instead',
  longAt >= 0 && before[longAt].size < before[(longAt + 1) % before.length].size &&
  !before[longAt].overflows,
  JSON.stringify({ long: before[longAt], neighbour: before[(longAt + 1) % before.length] }));

check('and no caption is cut off',
  before.every((c) => !c.overflows),
  JSON.stringify(before.map((c) => ({ size: c.size, over: c.overflows }))));

// Typing a long description into a short one must not move its picture.
const movedCell = 0;
const frameBefore = before[movedCell].frameTop;
await page.evaluate((n) => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const cap = sheet.querySelectorAll('.rb-pictures-page__caption')[n];
  cap.focus();
  cap.value = 'Displacement across the slab joint measured at the midspan of the ' +
    'room and again at the corner, with the floor falling away toward the ' +
    'exterior wall over the whole of that distance and the tile cracked ' +
    'through on the same line.';
  cap.dispatchEvent(new Event('input', { bubbles: true }));
}, movedCell);
await new Promise((r) => setTimeout(r, 1500));
const after = await cells();

check('typing a long description does not move its picture',
  after[movedCell].frameTop === frameBefore &&
  after[movedCell].frameH === before[movedCell].frameH,
  JSON.stringify({ was: before[movedCell], now: after[movedCell] }));

check('the type came down to hold it',
  after[movedCell].size < before[movedCell].size && !after[movedCell].overflows,
  JSON.stringify({ was: before[movedCell].size, now: after[movedCell].size }));

check('and the rest of the row never moved',
  after.slice(1, 4).every((c, i) => c.frameTop === before[i + 1].frameTop),
  JSON.stringify({ was: before.slice(1, 4).map((c) => c.frameTop),
    now: after.slice(1, 4).map((c) => c.frameTop) }));

// The printed deck is built fresh and has to measure itself: a caption that
// fitted on screen only because its type came down printed at full size, and
// what did not fit the block printed missing.
await page.evaluate(() => { window.print = () => {}; });
await page.emulateMediaType('print');
await page.click('#rb-print');
await page.waitForFunction(
  () => !!document.querySelector('.rb-print .rb-pictures-page__caption'), { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1800));
const printed = await page.evaluate(() => {
  const sheet = [...document.querySelectorAll('.rb-print .rb-sheet')]
    .find((el) => el.querySelector('.rb-pictures-page__caption'));
  return [...sheet.querySelectorAll('.rb-pictures-page__cell')].map((cell) => {
    const cap = cell.querySelector('.rb-pictures-page__caption');
    const frame = cell.querySelector('.rb-pictures-page__frame');
    return {
      frameH: Math.round(frame.getBoundingClientRect().height),
      size: Math.round(parseFloat(getComputedStyle(cap).fontSize) * 100) / 100,
      overflows: cap.scrollHeight > cap.clientHeight + 1,
      chars: (cap.value || '').length,
    };
  });
});
check('the printed sheet keeps identical plates and loses no words',
  printed.length === before.length &&
  Math.max(...printed.map((c) => c.frameH)) - Math.min(...printed.map((c) => c.frameH)) <= 1 &&
  printed.every((c) => !c.overflows),
  JSON.stringify(printed));
await page.emulateMediaType(null);

await page.screenshot({ path: `${OUT}/report-pictures-lineup.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
