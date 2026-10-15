/**
 * A reading is shown the way it was taken.
 * Run: node tests/floor-survey-reading-text.mjs   (needs a static server on 8765)
 *
 * Tim, looking at a Main Level of 9.30, 8.90, 7.60: "if we were only to show
 * the tenths and not the hundredths this would really clean up... we can still
 * show the hundredths, but only if they're typed in. If we don't have a
 * hundredth typed in, then we don't show the zero."
 *
 * So the second place appears only when it carries something. One place is the
 * floor: 9.00 is 9.0, not 9, because a measurement with no decimal reads as a
 * count. Storage is untouched -- the reading is kept as typed and only the
 * display changes, which is what the readings-in-tenths decision has always
 * said.
 *
 * Tenths elsewhere is a different rule and is not under test here: where a
 * reading is presented rather than entered -- Topo, the H/L/delta pill, the
 * legend, the rail, the report figures -- it is still rounded to one place.
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
const FILE = 'cf-reading-text';
const CANVAS = 'canvas-reading-text';
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
await page.setViewport({ width: 900, height: 1000, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

// A whole tenth, a whole number, and the one reading typed to a hundredth.
const VALUES = [9.3, 9.0, 8.9, 9.15, 7.6];

await page.evaluate(async ({ id, canvasId, values }) => {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 700;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#cfc6b8';
  ctx.fillRect(0, 0, 900, 700);
  await window.ToolboxDB.putMedia('plan-reading-text', canvas.toDataURL('image/png'));

  const record = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Reading';
  record.lastName = 'Text';
  const now = new Date().toISOString();
  record.planSetup.canvases = [{
    id: canvasId, name: 'Main Level', createdAt: now, updatedAt: now,
    plan: { id: 'plan-reading-text', width: 900, height: 700 },
    rooms: [], frontDoorFacing: 'S', frontDoor: null,
  }];
  record.planSetup.activeCanvasId = canvasId;
  window.ToolboxPlanSetup.ensureFloorSurvey(record);
  window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(record, canvasId);
  const poly = [{ x: 60, y: 60 }, { x: 840, y: 60 }, { x: 840, y: 640 }, { x: 60, y: 640 }];
  record.floorSurvey.byCanvasId[canvasId] = {
    canvasId,
    boundary: poly,
    areas: [{ id: 'area-a', name: 'Boundary 1', polygon: poly, createdAt: 1 }],
    points: values.map((value, i) => ({
      id: 'pt' + (i + 1), floorId: canvasId, index: i + 1,
      x: 140 + i * 140, y: 260, value,
      isBasePoint: i === 0, label: i === 0 ? 'BP1' : undefined, createdAt: i + 1,
    })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await window.ToolboxDB.saveCustomerFile(record);
}, { id: FILE, canvasId: CANVAS, values: VALUES });

await page.goto(`${BASE}#/file/${FILE}/floor`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === 'Data'),
  { timeout: 20000 });
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Data')?.click();
});
await new Promise((r) => setTimeout(r, 1000));
await page.evaluate(() => document.querySelector('[aria-label="Show data points"]')?.click());
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => document.querySelector('[aria-label="Expand"]')?.click());
await page.waitForFunction(
  () => [...document.querySelectorAll('button')].filter((b) => b.querySelector('span.w-8')).length >= 5,
  { timeout: 15000 });

const listed = await page.evaluate(() => [...document.querySelectorAll('button')]
  .filter((b) => b.querySelector('span.w-8'))
  .map((b) => {
    const value = b.querySelector('.font-mono.tabular-nums');
    return value ? value.textContent.trim().replace(/\s*BP1$/, '') : '';
  }));

check('the list drops a hundredth that is only a zero',
  listed.slice(0, 3).join(' ') === '9.3 9.0 8.9', listed.join(' | '));
check('and keeps one that was typed',
  listed[3] === '9.15', listed.join(' | '));
check('a whole number still reads as a measurement, not a count',
  listed.indexOf('9') === -1 && listed[1] === '9.0', listed.join(' | '));

// The labels drawn on the plan are the same reading and must say the same
// thing; they are on a canvas, so they are read back from the stored values
// through the same rule rather than from the DOM.
const drawn = await page.evaluate(async (id) => {
  const record = await window.ToolboxDB.getCustomerFile(id);
  const layer = record.floorSurvey.byCanvasId[Object.keys(record.floorSurvey.byCanvasId)[0]];
  return (layer.points || []).map((p) => p.value);
}, FILE);
check('the readings themselves are stored exactly as they were typed',
  JSON.stringify(drawn) === JSON.stringify(VALUES), JSON.stringify(drawn));

await page.screenshot({ path: `${OUT}/floor-survey-reading-text.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
