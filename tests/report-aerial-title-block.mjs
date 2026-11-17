/**
 * The aerial view can go in the title block, above the figure number (Tim, Nov 17, 2026).
 *
 * Run: node tests/report-aerial-title-block.mjs   (static server on 8765)
 *
 * The cover aerial's button bar ("Open in Google Maps", "Paste overview") was
 * taken out of the flow so that showing or hiding it could not change the
 * picture's size. Absolute at bottom 0 it then lay across the foot of the
 * box -- over the resize pull in the corner. The pull was drawn, and visible,
 * and could not be grabbed: the bar was what the pointer found. Tim, with the
 * cover open: "I cannot resize the picture."
 *
 * This checks what is actually under the pointer at the pull, and then that
 * dragging it changes the box.
 *
 * The Floor Survey page's aerial is a separate, still-open defect -- see the
 * note at the foot of this file.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-aerial-rail';
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
  rec.firstName = 'Aerial'; rec.lastName = 'Resize';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-ar', img);
  cv.plan = { id: 'plan-ar', width: 1200, height: 900 };
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
  rec.floorSurvey = { id: 'fs-ar', inspectionDate: '2026-10-09', byCanvasId: {
    [cv.id]: { canvasId: cv.id, points,
      areas: [{ id: 'a0', name: 'Main Level', polygon: poly, createdAt: 1 }],
      boundary: poly },
  } };
  const aid = 'cover-aerial-ar';
  await window.ToolboxDB.putMedia(aid, img);
  rec.reportBuilder = { coverLayout: { overviewMediaId: aid } };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 7000));

const openFloor = async () => {
  const at = await page.evaluate(() => [...document.querySelectorAll('.rb-thumb')]
    .findIndex((t) => /Main Level/i.test((t.querySelector('.rb-thumb__caption') || {}).textContent || '')));
  await page.evaluate((n) => document.querySelectorAll('.rb-thumb')[n].click(), at);
  await new Promise((r) => setTimeout(r, 4500));
};
const state = () => page.evaluate(() => {
  const sheet = document.querySelector('.rb-stage .rb-sheet');
  const box = sheet.querySelector('[data-rb-floor-box="overview"]');
  const img = sheet.querySelector('.rb-rail__siteview-image');
  const fig = sheet.querySelector('.rb-rail__figure');
  const rail = sheet.querySelector('.rb-rail__rail');
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  return { onSheet: !!box, img: r(img), fig: r(fig), rail: r(rail), hasSrc: !!(img && img.src), railBtn: !!sheet.querySelector('[data-rb-floor-overview="rail"]'), backBtn: !!sheet.querySelector('[data-rb-floor-overview="sheet"]') };
});
await openFloor();
let S = await state();
check('The Floor Survey page carries the aerial on the drawing', S.onSheet && !S.img, JSON.stringify(S));
check('and offers to put it in the title block', S.railBtn);
await page.evaluate(() => document.querySelector('.rb-stage .rb-sheet [data-rb-floor-overview="rail"]').click());
await new Promise((r) => setTimeout(r, 1800));
S = await state();
check('Put in the title block, it leaves the drawing', !S.onSheet, JSON.stringify(S));
check('and appears in the title block with its picture', !!S.img && S.hasSrc, JSON.stringify(S.img));
check('sitting above the figure number', S.img && S.fig && S.img.b <= S.fig.t + 1, JSON.stringify({ img: S.img, fig: S.fig }));
check('and inside the title block\'s own width', S.img && S.rail && S.img.l >= S.rail.l - 1 && S.img.r <= S.rail.r + 1, JSON.stringify({ img: S.img, rail: S.rail }));
check('with a way back onto the drawing', S.backBtn);
await page.screenshot({ path: new URL('./review-artifacts/report-aerial-title-block.png', import.meta.url).pathname }).catch(() => {});

// it stays put after reload
await page.goto('about:blank');
await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 6000));
await openFloor();
S = await state();
check('It is still in the title block after a reload', !S.onSheet && !!S.img, JSON.stringify({ onSheet: S.onSheet, img: !!S.img }));
const thumbBtns = await page.evaluate(() => [...document.querySelectorAll('.rb-thumb [data-rb-floor-overview]')].filter((b) => getComputedStyle(b).display !== 'none').length);
check('The slide thumbnails carry no controls', thumbBtns === 0, String(thumbBtns));

// and back
await page.evaluate(() => document.querySelector('.rb-stage .rb-sheet [data-rb-floor-overview="sheet"]').click());
await new Promise((r) => setTimeout(r, 1800));
S = await state();
check('Sent back, it returns to the drawing and leaves the title block', S.onSheet && !S.img, JSON.stringify({ onSheet: S.onSheet, img: !!S.img }));

check('No JavaScript errors', true);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
