/**
 * What the Import button promises is what lands on the slide.
 * Run: node tests/report-floor-import-promise.mjs   (needs a static server on 8765)
 *
 * The button on an empty Floor Survey page says "Loads topo, legend, and
 * H/L/Δ onto this slide." There was a stretch when that was not true: while
 * the slide could not draw its own chrome, the drawing arrived on its own and
 * the colour scale, the pill and the High/Low markers did not. The slide
 * draws them again, and a report saved during that stretch has the three
 * flags cleared once on open, so this guards the promise rather than the
 * wording.
 *
 * The chrome is drawn on the canvas rather than in the page, so it is read
 * the way the eye reads it: the High marker's red and the Low marker's blue
 * are the two colours nothing else on a topo uses, and they are the letters
 * of the H/L/\u0394 pill as well as the markers. The colour scale is left to
 * the stored settings, which is where it was switched off before.
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
const FILE = 'rb-import-promise';
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
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 700;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 900, 700);
  ctx.strokeStyle = '#222222';
  ctx.lineWidth = 4;
  ctx.strokeRect(40, 40, 820, 620);
  await window.ToolboxDB.putMedia('plan-promise', canvas.toDataURL('image/png'));

  const record = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Ruth';
  record.lastName = 'Alder';
  record.propertyAddress = '3 Promise Street\nSanta Fe, NM 87505';
  const canvasId = record.planSetup.canvases[0].id;
  record.planSetup.canvases[0].name = 'Main Level';
  record.planSetup.canvases[0].plan = { id: 'plan-promise', width: 900, height: 700 };
  record.planSetup.canvases[0].frontDoorFacing = 'N';
  const poly = [{ x: 60, y: 60 }, { x: 840, y: 60 }, { x: 840, y: 640 }, { x: 60, y: 640 }];
  const points = [];
  let i = 0;
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      i += 1;
      points.push({
        id: 'p' + i, floorId: canvasId, index: i,
        x: 140 + col * 150, y: 150 + row * 140, value: 7 + ((i * 7) % 25) / 10,
      });
    }
  }
  record.floorSurvey = {
    id: 'fs-promise',
    inspectionDate: '2026-10-01',
    byCanvasId: {
      [canvasId]: {
        canvasId, points,
        areas: [{ id: 'a1', name: 'Main Level', polygon: poly, createdAt: 1 }],
        boundary: poly,
      },
    },
  };
  await window.ToolboxDB.saveCustomerFile(record);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('.rb-thumb[data-page-id^="floor-"]'), { timeout: 20000 });
await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id^="floor-"]').click());
await page.waitForFunction(() => document.querySelector('[data-rb-floor-import]'), { timeout: 20000 });

const promised = await page.evaluate(
  () => (document.querySelector('.rb-floor-toolbar__hint')?.textContent || '').trim());
check('the button still promises the topo, the legend and the H/L/Δ',
  /topo/i.test(promised) && /legend/i.test(promised) && /H\/L/i.test(promised), promised);

await page.click('[data-rb-floor-import]');
await page.waitForFunction(() => !!document.querySelector('[data-rb-floor-box="topo"]'), { timeout: 25000 });
await new Promise((resolve) => setTimeout(resolve, 2500));

/** What is actually painted on the slide's drawing. */
const painted = await page.evaluate(() => {
  const canvases = [...document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) canvas')];
  const canvas = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!canvas) return { ok: false, reason: 'no canvas on the slide' };
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  let data;
  try {
    data = ctx.getImageData(0, 0, width, height).data;
  } catch (err) {
    return { ok: false, reason: 'getImageData ' + err.message };
  }
  // The High marker and the pill's H are #b51d16; the Low and its L are
  // #1f5f9f. An earth-tone contour fill carries neither.
  const near = (r, g, b, R, G, B) => Math.abs(r - R) < 26 && Math.abs(g - G) < 26 && Math.abs(b - B) < 26;
  let high = 0;
  let low = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (near(r, g, b, 181, 29, 22)) high += 1;
      else if (near(r, g, b, 31, 95, 159)) low += 1;
    }
  }
  return { ok: true, high, low, width, height };
});

check('the High and Low markers are on the slide',
  painted.ok && painted.high > 20 && painted.low > 20, JSON.stringify(painted));

// The legend and the pill are the chrome the old build switched off as a set,
// and the slide records what it is drawing with.
const settings = await page.evaluate(async (id) => {
  const record = await window.ToolboxDB.getCustomerFile(id);
  const view = record.reportBuilder?.floorView || {};
  const floor = (record.reportBuilder?.pages || []).find((p) => p.type === 'floor');
  const meta = (floor && floor.meta && floor.meta.settings) || {};
  const read = (key) => (meta[key] !== undefined ? meta[key] : view[key]);
  return {
    legend: read('showLegend'),
    pill: read('showStatsPill'),
    highLow: read('showHighLow'),
    imported: !!(floor && floor.meta && floor.meta.imported),
  };
}, FILE);
check('the slide is imported and nothing has the chrome switched off',
  settings.imported && settings.legend !== false && settings.pill !== false &&
    settings.highLow !== false, JSON.stringify(settings));

// And what the panel changes, the drawing shows.
//
// Every control in the slide's Floor Survey panel went through one callback
// that still named a mount removed when a sheet gained the option of two
// drawings. It threw on every press: the setting was stored, the drawing was
// never told, and the colour scale, the pill, the labels and the palette all
// read as doing nothing. Tim: "the contour legend on the FS pages does not
// resize."
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const drawing = () => page.evaluate(() => {
  const canvas = [...document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) canvas')]
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];
  return canvas ? canvas.toDataURL().length + ':' + canvas.toDataURL().slice(-64) : '';
});
const beforeLegend = await drawing();
for (let i = 0; i < 3; i += 1) {
  await page.evaluate(() => document.querySelector('[aria-label="Increase Legend size"]')?.click());
  await new Promise((resolve) => setTimeout(resolve, 300));
}
await new Promise((resolve) => setTimeout(resolve, 1200));
const afterLegend = await drawing();
check('the colour scale resizes from the panel, on the drawing',
  !!beforeLegend && afterLegend !== beforeLegend,
  JSON.stringify({ changed: afterLegend !== beforeLegend }));
check('and nothing threw while it did', errors.length === 0, errors.join(' | '));

await page.screenshot({ path: `${OUT}/report-floor-import-promise.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
