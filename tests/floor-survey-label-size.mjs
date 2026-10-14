/**
 * The Data panel's label size is remembered.
 * Run: node tests/floor-survey-label-size.mjs   (needs a static server on 8765)
 *
 * Tim, from the field, with the panel open at 8px: "if I close it and open it
 * up it goes back to 11. I need you to set this to where whatever last
 * setting it goes to it stays on."
 *
 * The dot size and the dot colour beside it were both stored against the
 * Customer File; the label size was the one of the three nobody had stored,
 * so a level set small enough to read a dense plan came back at the default
 * on the next open. This checks the three of them together, because the
 * reason this was missed is that it sits between two that work.
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
const FILE = 'cf-label-size';
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
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(BASE, { waitUntil: 'networkidle0' });

const PLAN_W = 900;
const PLAN_H = 700;
await page.evaluate(async ({ id, planW, planH }) => {
  const canvas = document.createElement('canvas');
  canvas.width = planW;
  canvas.height = planH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#cfc6b8';
  ctx.fillRect(0, 0, planW, planH);
  await window.ToolboxDB.putMedia('plan-label-size', canvas.toDataURL('image/png'));

  const record = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Label';
  record.lastName = 'Size';
  const canvasId = 'canvas-label-size';
  const now = new Date().toISOString();
  record.planSetup.canvases = [{
    id: canvasId,
    name: 'Main Level',
    createdAt: now,
    updatedAt: now,
    plan: { id: 'plan-label-size', width: planW, height: planH },
    rooms: [],
    frontDoorFacing: 'S',
    frontDoor: null,
  }];
  record.planSetup.activeCanvasId = canvasId;
  window.ToolboxPlanSetup.ensureFloorSurvey(record);
  window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(record, canvasId);
  const poly = [
    { x: 120, y: 120 }, { x: 780, y: 120 }, { x: 780, y: 580 }, { x: 120, y: 580 },
  ];
  record.floorSurvey.byCanvasId[canvasId] = {
    canvasId,
    boundary: poly,
    areas: [{ id: 'area-a', name: 'Boundary 1', polygon: poly, createdAt: 1 }],
    points: [
      { id: 'p1', floorId: canvasId, index: 1, x: 300, y: 200, value: 1.0, isBasePoint: true, label: 'BP1', createdAt: 1 },
      { id: 'p2', floorId: canvasId, index: 2, x: 520, y: 300, value: 1.6, createdAt: 1 },
      { id: 'p3', floorId: canvasId, index: 3, x: 400, y: 460, value: 2.1, createdAt: 1 },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await window.ToolboxDB.saveCustomerFile(record);
}, { id: FILE, planW: PLAN_W, planH: PLAN_H });

/** Open the Data tab and unfold the panel's size controls. */
async function openDataPanel() {
  await page.goto(`${BASE}#/file/${FILE}/floor`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === 'Data'),
    { timeout: 20000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Data')?.click();
  });
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate(() => {
    document.querySelector('[aria-label="Show data points"]')?.click();
  });
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(() => {
    document.querySelector('[aria-label="Expand"]')?.click();
  });
  await page.waitForFunction(() => document.querySelector('[aria-label="Smaller label"]'), { timeout: 15000 });
}

/** The px figure printed between a pair of − / + buttons. */
const sizeBeside = (label) => page.evaluate((aria) => {
  const btn = document.querySelector(`[aria-label="${aria}"]`);
  if (!btn) return null;
  const span = [...btn.parentElement.querySelectorAll('span')].find((n) => /px$/.test(n.textContent.trim()));
  return span ? span.textContent.trim() : null;
}, label);

const press = async (aria, times) => {
  for (let i = 0; i < times; i += 1) {
    await page.evaluate((a) => document.querySelector(`[aria-label="${a}"]`).click(), aria);
    await new Promise((r) => setTimeout(r, 200));
  }
};

await openDataPanel();
const started = { text: await sizeBeside('Larger label'), dot: await sizeBeside('Larger dot') };
check('the panel opens on the defaults', started.text === '11px' && started.dot === '2px',
  JSON.stringify(started));

await press('Smaller label', 3);
await press('Larger dot', 2);
const set = { text: await sizeBeside('Larger label'), dot: await sizeBeside('Larger dot') };
check('the controls move', set.text === '8px' && set.dot === '4px', JSON.stringify(set));

await openDataPanel();
const reopened = { text: await sizeBeside('Larger label'), dot: await sizeBeside('Larger dot') };
check('the label size is still what it was set to, as the dot size already was',
  reopened.text === '8px' && reopened.dot === '4px', JSON.stringify(reopened));

// The labels on the plan are drawn at the size the panel reports, so a size
// that only survived in the panel would be no use.
const drawn = await page.evaluate(() => {
  const raw = localStorage.getItem('dpp-font:cf-label-size');
  return raw == null ? null : Number(raw);
});
check('the size is stored against this Customer File', drawn === 8, String(drawn));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
