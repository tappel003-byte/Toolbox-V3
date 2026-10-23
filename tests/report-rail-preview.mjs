/**
 * The rail shows the page, and shows all of it.
 *
 * Run: node tests/report-rail-preview.mjs   (static server on 8765)
 *
 * Two faults, one screenshot. Tim, Oct 23, 2026: "The slides don't show
 * fully. Look at the preview slides. We do need to work a little bit on this
 * rail."
 *
 * 1. fitThumb scales the preview by boxWidth / PAPER_W -- 1632, the paper --
 *    but the preview sheet was still laid out at 680 x 440, the stage's size
 *    from before the sheet became the paper. So every preview drew at 680 /
 *    1632 of its box: the page squeezed into the top-left corner of the
 *    stamp, white to the right of it and below.
 *
 * 2. The rail's padding was written against a .rb-rail class the element has
 *    not carried for some time, so its labels and buttons sat flush against
 *    the window edge and the wider ones were cut off: "AGES" for PAGES.
 *
 * Both are measured here against the box each thing has to live in, because
 * both failures looked fine in the DOM and only showed up on screen.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-rail-preview';
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
await page.setViewport({ width: 1366, height: 820, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const img = (() => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 900);
    x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(30, 30, 1140, 840);
    return c.toDataURL('image/jpeg', 0.9);
  })();
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Rail'; rec.lastName = 'Preview';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-rp', img);
  cv.plan = { id: 'plan-rp', width: 1200, height: 900 };
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
  rec.floorSurvey = { id: 'fs-rp', inspectionDate: '2026-10-09', byCanvasId: {
    [cv.id]: { canvasId: cv.id, points,
      areas: [{ id: 'a0', name: 'Main Level', polygon: poly, createdAt: 1 }],
      boundary: poly },
  } };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-thumb__sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 7000));

const rail = await page.evaluate(() => {
  const ws = document.querySelector('.rb-ws');
  const wsRect = ws.getBoundingClientRect();
  const boxes = [...document.querySelectorAll('.rb-thumb__sheet')].map((host) => {
    const sheet = host.querySelector('.rb-sheet--thumb');
    const hr = host.getBoundingClientRect();
    const sr = sheet ? sheet.getBoundingClientRect() : null;
    return {
      boxW: hr.width, boxH: hr.height,
      drawnW: sr ? sr.width : 0, drawnH: sr ? sr.height : 0,
      // Unzoomed: the preview's own layout size, which has to BE the paper's
      // or the scale fitThumb applies is against the wrong number.
      laidOutW: sheet ? sheet.offsetWidth : 0,
      laidOutH: sheet ? sheet.offsetHeight : 0,
    };
  });
  // Nothing in the rail may start left of the rail.
  const clipped = [...ws.querySelectorAll('*')].filter((el) => {
    if (!el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.left < wsRect.left - 0.5;
  }).map((el) => (el.className || el.tagName) + ' @' +
    Math.round(el.getBoundingClientRect().left));
  return {
    railLeft: wsRect.left, railW: wsRect.width,
    boxes,
    clipped: clipped.slice(0, 6),
    docOverflow: document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  };
});

check('the rail drew some previews', rail.boxes.length >= 3,
  String(rail.boxes.length));

const fill = rail.boxes.map((b) => ({
  w: b.boxW ? b.drawnW / b.boxW : 0,
  h: b.boxH ? b.drawnH / b.boxH : 0,
}));
const worst = fill.reduce((a, b) => (b.w < a.w ? b : a), fill[0] || { w: 0, h: 0 });

check('every preview fills the width of its box',
  fill.every((f) => f.w >= 0.92),
  `worst ${(worst.w * 100).toFixed(0)}% wide (${Math.round(rail.boxes[0].drawnW)} of ${Math.round(rail.boxes[0].boxW)}px)`);
check('and fills the height of it too',
  fill.every((f) => f.h >= 0.92),
  `worst ${(worst.h * 100).toFixed(0)}% tall`);
check('because the preview is laid out at the paper\'s own size',
  rail.boxes.every((b) => b.laidOutW === 1632 && b.laidOutH === 1056),
  `${rail.boxes[0].laidOutW} x ${rail.boxes[0].laidOutH}`);

check('nothing in the rail is cut off at its left edge',
  rail.clipped.length === 0, rail.clipped.join(', ') || 'none');
check('and the page itself does not scroll sideways',
  rail.docOverflow <= 0, String(rail.docOverflow));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
