/**
 * A figure that cannot be built says so on the sheet.
 *
 * Run: node tests/report-failed-sheet-says-so.mjs   (static server on 8765)
 *
 * buildPrintDeck wraps each page in a try/catch that only warned to the
 * console, and handed the printer whatever had been assembled before the
 * throw. On a Floor Survey slide the rail is built first, so the sheet went
 * out carrying its title block, its figure number and its logo, with no
 * drawing, no colour scale, no readings -- and nothing to say anything had
 * gone wrong.
 *
 * A report left here that way: four blank figures, 678 KB with no plan
 * images in it at all, and the only trace a line in a console nobody had
 * open. Tim, on whether to chase that failure: "I can always double check
 * that before I print it."
 *
 * He should not have to notice it himself.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-failed-sheet';
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
  rec.firstName = 'Failed'; rec.lastName = 'Sheet';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-fs', img);
  cv.plan = { id: 'plan-fs', width: 1200, height: 900 };
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
  rec.floorSurvey = { id: 'fs-fs', inspectionDate: '2026-10-09', byCanvasId: {
    [cv.id]: { canvasId: cv.id, points,
      areas: [{ id: 'a0', name: 'Main Level', polygon: poly, createdAt: 1 }],
      boundary: poly },
  } };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 7000));

// Break the floor figure's renderer the way a bad run breaks it, then print.
await page.evaluate(() => {
  window.print = () => { window.__printed = true; };
  const fl = window.ToolboxReportFloorLayout;
  const real = fl.renderPage;
  fl.renderPage = function () { throw new Error('figure unavailable (simulated)'); };
  window.__restoreFloor = () => { fl.renderPage = real; };
});
await page.click('#rb-print');
await page.waitForFunction(() => window.__printed === true, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 900));

const deck = await page.evaluate(() => {
  const sheets = [...document.querySelectorAll('.rb-print .rb-sheet')];
  const floor = sheets.find((s) => s.getAttribute('data-page-type') === 'floor');
  const notice = floor ? floor.querySelector('[data-rb-sheet-failed]') : null;
  return {
    sheets: sheets.length,
    floorFound: !!floor,
    saysSo: !!notice,
    text: notice ? (notice.textContent || '').trim().slice(0, 60) : '',
    visible: notice ? getComputedStyle(notice).display !== 'none' : false,
    othersIntact: sheets.filter((s) => !s.querySelector('[data-rb-sheet-failed]')).length,
  };
});

check('the floor sheet is in the deck', deck.floorFound, JSON.stringify(deck));
check('and it says it could not be prepared', deck.saysSo, deck.text);
check('the notice is drawn, not hidden as editor chrome', deck.visible, String(deck.visible));
check('and the rest of the report still printed',
  deck.othersIntact >= 2, JSON.stringify({ sheets: deck.sheets, intact: deck.othersIntact }));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
