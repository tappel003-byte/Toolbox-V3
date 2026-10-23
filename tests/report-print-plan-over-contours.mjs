/**
 * The printed figure draws the plan the way the slide draws it.
 *
 * Run: node tests/report-print-plan-over-contours.mjs  (static server on 8765)
 *
 * TopoTab mounts PlanCanvas with planOnTop, so on screen the order is: contour
 * base, then the plan multiplied over it, then the readings. renderTopoBase
 * says as much in its own comment -- "Meant to sit UNDER the wall plan."
 *
 * The report figure composer drew the plan FIRST at planOpacity 0.62 and then
 * put the whole of renderTopo over it, so the contour fill buried the walls,
 * the room names and anything else printed into the plan image. Same frame as
 * the slide, different picture.
 *
 * This compares what is PAINTED, not where the boxes sit: the earlier print
 * test would pass with every mark inside an identically placed image covered
 * up. The plan here carries a magenta band down its left side and a red mark,
 * both inside the camera's region, so burying them is visible in the numbers.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-plan-over';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

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
    c.width = 1200; c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 900);
    x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(30, 30, 1140, 840);
    // Painted INTO the plan image, inside the camera's region, so the only
    // way it disappears is the contour fill covering it.
    x.fillStyle = '#ff00ff'; x.fillRect(60, 100, 120, 700);
    x.fillStyle = '#c00'; x.font = 'bold 44px sans-serif';
    x.fillText('LEFT', 40, 460);
    return c.toDataURL('image/jpeg', 0.92);
  })();
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Plan'; rec.lastName = 'Over';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-over', plan);
  cv.plan = { id: 'plan-over', width: 1200, height: 900 };
  cv.frontDoorFacing = 'E';
  const poly = [{ x: 40, y: 40 }, { x: 1160, y: 40 }, { x: 1160, y: 860 }, { x: 40, y: 860 }];
  const points = [];
  let n = 0;
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      n += 1;
      points.push({ id: 'p' + n, floorId: cv.id, index: n,
        x: 120 + c * 300, y: 150 + r * 280, value: 7 + ((n * 9) % 27) / 10 });
    }
  }
  rec.floorSurvey = { id: 'fs-over', inspectionDate: '2026-10-09', byCanvasId: {
    [cv.id]: { canvasId: cv.id, points,
      areas: [{ id: 'a0', name: 'Main Level', polygon: poly, createdAt: 1 }],
      boundary: poly },
  } };
  // Panned and zoomed, the state a real slide is left in.
  rec.reportBuilder = { floorCamera: { cx: 0.42, cy: 0.5, zoom: 1.35, rel: true } };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 7000));
const at = await page.evaluate(() => [...document.querySelectorAll('.rb-thumb')]
  .findIndex((t) => /Main Level/i.test((t.querySelector('.rb-thumb__caption') || {}).textContent || '')));
check('the job made a Main Level sheet', at >= 0, String(at));
await page.evaluate((n) => document.querySelectorAll('.rb-thumb')[n].click(), at);
await new Promise((r) => setTimeout(r, 5000));

await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
await page.click('#rb-print');
await page.waitForFunction(() => window.__printed === true, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 900));

// Where the plan's own magenta band falls, as a fraction of each image.
const ink = await page.evaluate(() => {
  function magentaSpan(canvas) {
    const w = canvas.width, h = canvas.height;
    let data;
    try { data = canvas.getContext('2d').getImageData(0, 0, w, h).data; }
    catch (e) { return { error: String(e) }; }
    let left = -1, right = -1, count = 0;
    for (let y = 0; y < h; y += 3) {
      for (let x = 0; x < w; x += 3) {
        const i = (y * w + x) * 4;
        // The band is #ff00ff, so whatever it is multiplied over, its GREEN
        // stays at zero and its blue does not. That separates it from the red
        // High pill (green 74, drawn live but not composed -- the chrome is
        // placed separately on the report sheet) and from the red LEFT text
        // (blue 0). A looser test counted the pill and read the live span
        // wider than the still's, measuring the wrong thing.
        if (data[i + 1] < 15 && data[i + 2] > 50 && data[i] > 50) {
          if (left < 0 || x < left) left = x;
          if (x > right) right = x;
          count += 1;
        }
      }
    }
    if (left < 0) return { none: true, w, h };
    return { w, h, left: +(left / w).toFixed(3), right: +(right / w).toFixed(3), count };
  }
  const out = {};
  const lc = document.querySelector('.rb-stage .rb-sheet [data-rb-topo-live] canvas');
  out.live = lc ? magentaSpan(lc) : { missing: true };
  const img = document.querySelector('.rb-print .rb-topo-still');
  if (img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    out.still = magentaSpan(c);
  } else out.still = { missing: true };
  return out;
});

check('the slide shows the plan over the contours', !ink.live.none && !ink.live.missing,
  JSON.stringify(ink.live));
check('and so does the printed figure', !ink.still.none && !ink.still.missing,
  JSON.stringify(ink.still));
const near = (a, b, tol = 0.03) => Math.abs((a || 0) - (b || 0)) <= tol;
check('the plan falls in the same place in both',
  !ink.live.none && !ink.still.none
    && near(ink.live.left, ink.still.left) && near(ink.live.right, ink.still.right),
  JSON.stringify({ live: ink.live, still: ink.still }));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
