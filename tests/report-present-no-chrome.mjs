/**
 * Nothing on a sheet being SHOWN to somebody is editor chrome.
 *
 * Run: node tests/report-present-no-chrome.mjs   (static server on 8765)
 *
 * Every rule that kept the chrome off the paper lived inside @media print.
 * Presentation is that same deck on a SCREEN, where print rules never fire,
 * so the flip chart carried all of it: the dashed outline round a text box,
 * the corner pulls, the x on the aerial, the Paste overview button, the
 * plan's own grips.
 *
 * Tim, on a preview sheet: "Look at the small white layout. That's our text
 * box. I don't want it visible." And on the next: "the white line exists in
 * these photos too."
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-present-chrome';
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
  rec.firstName = 'Present'; rec.lastName = 'Chrome';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-pc', img);
  cv.plan = { id: 'plan-pc', width: 1200, height: 900 };
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
  const pins = [];
  for (let k = 1; k <= 4; k += 1) {
    const pid = 'ph-pc-' + k;
    await window.ToolboxDB.putMedia(pid, img);
    pins.push({ id: 'pin-' + k, num: k, canvasId: cv.id, x: 200 + k * 180, y: 400,
      location: 'Room ' + k, description: 'A caption.', photos: [{ id: pid }],
      note: 'Pen log note ' + k });
  }
  rec.distress = { updatedAt: new Date().toISOString(), mode: 'internal', startNum: 1,
    nextNum: pins.length + 1, activeCanvasId: cv.id, pins };
  rec.floorSurvey = { id: 'fs-pc', inspectionDate: '2026-10-09', byCanvasId: {
    [cv.id]: { canvasId: cv.id, points,
      areas: [{ id: 'a0', name: 'Main Level', polygon: poly, createdAt: 1 }],
      boundary: poly },
  } };
  const aid = 'cover-aerial-pc';
  await window.ToolboxDB.putMedia(aid, img);
  rec.reportBuilder = { coverLayout: { overviewMediaId: aid } };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 7000));

await page.waitForSelector('#rb-present', { timeout: 10000 });
await page.click('#rb-present');
await page.waitForFunction(
  () => !!document.querySelector('.rb-print--present .rb-sheet.is-present-current'),
  { timeout: 60000 });
await new Promise((r) => setTimeout(r, 2000));

// Every piece of chrome, across every sheet in the deck -- not only the one
// on show, because the flip chart walks through all of them.
const CHROME = [
  '[data-plan-resize]', '.rb-penlog__move', '.rb-penlog__resize',
  '.rb-floor-overview__remove', '.rb-cover-box__move', '.rb-cover-box__resize',
  '.rb-floor-box__resize', '.rb-floor-toolbar', '.rb-cover__contents-jump',
  '.rb-cover__overview-actions', '.rb-cover__overview-empty', '.rb-floor-empty',
  '.rb-brand__resize', '.rb-discussion__move', '.rb-discussion__resize',
  '.rb-discussion__overflow', '.rb-ov__resize', '.rb-ov__remove', '.rb-ov__hint',
];

const shown = await page.evaluate((sels) => {
  const deck = document.querySelector('.rb-print--present');
  const out = [];
  sels.forEach((sel) => {
    [...deck.querySelectorAll(sel)].forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display !== 'none' && cs.visibility !== 'hidden') {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) out.push(sel);
      }
    });
  });
  return [...new Set(out)];
}, CHROME);
check('no editor chrome is drawn anywhere in the flip chart',
  shown.length === 0, shown.join(' ') || 'none');

const outlined = await page.evaluate(() => {
  const deck = document.querySelector('.rb-print--present');
  const out = [];
  ['.rb-cover-box', '.rb-floor-box', '.rb-discussion__box', '[data-rb-rich]']
    .forEach((sel) => {
      [...deck.querySelectorAll(sel)].forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) out.push(sel);
      });
    });
  return [...new Set(out)];
});
check('and no box draws its placement outline', outlined.length === 0,
  outlined.join(' ') || 'none');

// The deck still has its sheets -- this did not simply blank the thing.
const sheets = await page.evaluate(() =>
  document.querySelectorAll('.rb-print--present .rb-sheet').length);
check('the deck still holds every sheet', sheets >= 4, String(sheets));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
