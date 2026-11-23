/**
 * Failed/empty legend paints must not loop renderPages forever
 * (Tim, Nov 23, 2026 — pages rail thrash).
 *
 * Run: node tests/report-legend-redraw-bound.mjs  (static server on 8765)
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-legend-bound';

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const img = (() => {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 480;
    const x = c.getContext('2d');
    x.fillStyle = '#eee'; x.fillRect(0, 0, 640, 480);
    x.fillStyle = '#333'; x.fillRect(80, 60, 480, 360);
    return c.toDataURL('image/jpeg', 0.85);
  })();
  await ToolboxDB.putMedia('plan-legend-bound', img);
  const rec = ToolboxApp.blankCustomerFile(id);
  ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Ryan'; rec.lastName = 'Haddow';
  const names = ['Main Floor', 'Garage', 'Patio', 'Basement'];
  rec.planSetup.canvases = names.map((name, i) => ({
    id: 'cv-' + i, name, rooms: [], frontDoorFacing: 'E', frontDoor: null,
    plan: { id: 'plan-legend-bound', width: 640, height: 480 },
  }));
  rec.floorSurvey = { id: 'fs-leg', inspectionDate: '2025-11-21', byCanvasId: {} };
  rec.planSetup.canvases.forEach((cv) => {
    rec.floorSurvey.byCanvasId[cv.id] = {
      canvasId: cv.id,
      points: [{ id: 'a', x: 100, y: 100, value: 0 }, { id: 'b', x: 400, y: 300, value: -1 }],
      areas: [],
      boundary: [{ x: 80, y: 60 }, { x: 560, y: 60 }, { x: 560, y: 420 }, { x: 80, y: 420 }],
    };
  });
  await ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-shell')?.getAttribute('data-report-ready') === 'true',
  { timeout: 60000 },
);

const rebuilds = await page.evaluate(async () => {
  const list = document.querySelector('#rb-page-list');
  let n = 0;
  const mo = new MutationObserver(() => { n += 1; });
  mo.observe(list, { childList: true });
  await new Promise((r) => setTimeout(r, 3500));
  mo.disconnect();
  return n;
});

console.log(JSON.stringify({ rebuilds }));
const ok = rebuilds < 40;
console.log(ok ? `PASS  page-list rebuilds bounded (${rebuilds} < 40)` : `FAIL  too many rebuilds: ${rebuilds}`);
await browser.close();
if (!ok) process.exit(1);
