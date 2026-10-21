/**
 * Leaving Report Builder lets go of the visit.
 * Run: node tests/report-builder-teardown.mjs   (needs a static server on 8765)
 *
 * Tim, switching between the applications on a real job: "I was getting a not
 * enough memory reload and that's going to be a problem."
 *
 * It was. Opening Report Builder and leaving it kept about a megabyte on a job
 * with twelve photographs -- every time, linear over a dozen laps, and none of
 * it came back under a forced collection. On a two-hundred-photograph job that
 * is roughly 14 MB a visit.
 *
 * The cause was one listener. The formatting ribbon listens on the whole page
 * for a click outside an open menu, and its teardown removed a different one.
 * A listener is a live reference to everything its function can see: that
 * ribbon, the callback Report Builder handed it, and through that the whole
 * session -- including the undo history, which holds a full copy of the
 * report. So each visit left one behind, holding one entire report.
 *
 * This is the general rule, not that one listener: whatever a visit puts on
 * the page, leaving takes off again. The count must come back to where it
 * started, however many times the investigator goes in and out.
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
const FILE = 'rb-teardown';
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
await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 });

// Count what is listening on the page, before any application code runs.
await page.evaluateOnNewDocument(() => {
  window.__live = new Map();
  let seq = 0;
  [[document, 'document'], [window, 'window']].forEach(function (pair) {
    const target = pair[0];
    const label = pair[1];
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    target.addEventListener = function (type, handler, options) {
      if (handler) {
        if (!handler.__id) handler.__id = ++seq;
        const where = (new Error().stack || '').split('\n').slice(2, 3)
          .map((line) => line.trim().replace(/^at\s+/, '')).join('');
        window.__live.set(handler.__id, { label: label, type: type, where: where });
      }
      return add(type, handler, options);
    };
    target.removeEventListener = function (type, handler, options) {
      if (handler && handler.__id) window.__live.delete(handler.__id);
      return remove(type, handler, options);
    };
  });
});

await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const all = await window.ToolboxDB.getAllCustomerFiles();
  if (all.length) await window.ToolboxDB.permanentlyDeleteCustomerFiles(all);
  const sheet = document.createElement('canvas');
  sheet.width = 900;
  sheet.height = 700;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 900, 700);
  ctx.strokeStyle = '#222222';
  ctx.strokeRect(40, 40, 820, 620);
  await window.ToolboxDB.putMedia('plan-teardown', sheet.toDataURL('image/png'));

  const record = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Dana';
  record.lastName = 'Teardown';
  record.propertyAddress = '3 Release Road';
  const canvas = record.planSetup.canvases[0];
  canvas.name = 'Main Level';
  canvas.plan = { id: 'plan-teardown', width: 900, height: 700 };
  const pins = [];
  for (let i = 1; i <= 6; i += 1) {
    const photoId = 'ph-teardown-' + i;
    await window.ToolboxDB.putMedia(photoId, sheet.toDataURL('image/jpeg', 0.7));
    pins.push({
      id: 'pin-' + i, num: i, canvasId: canvas.id,
      x: 0.2 + i * 0.1, y: 0.3, location: 'Room ' + i,
      description: 'Observation ' + i, photos: [{ id: photoId }],
    });
  }
  record.distress = {
    mode: 'internal', startNum: 1, nextNum: 7, activeCanvasId: canvas.id, pins: pins,
  };
  await window.ToolboxDB.saveCustomerFile(record);
}, FILE);

async function go(hash, waitMs) {
  await page.evaluate((want) => { window.location.hash = want; }, hash);
  await new Promise((done) => setTimeout(done, waitMs));
}

const listening = () => page.evaluate(() => {
  const rows = [];
  window.__live.forEach((item) => rows.push(item.label + ' ' + item.type + ' ' + item.where));
  return rows;
});

await go(`#/file/${FILE}`, 1500);
const before = await listening();

await go(`#/file/${FILE}/report`, 3500);
const during = await listening();
check('the report screen listens on the page while it is open',
  during.length > before.length,
  JSON.stringify({ before: before.length, during: during.length }));

await go(`#/file/${FILE}`, 1200);
const afterOne = await listening();
check('and has taken all of it off again when you leave',
  afterOne.length === before.length,
  JSON.stringify({
    before: before.length,
    after: afterOne.length,
    leftBehind: afterOne.filter((row) => before.indexOf(row) === -1),
  }));

// However many times. One visit leaving one listener behind is a slow leak;
// a day of them is a dead tab.
for (let lap = 0; lap < 4; lap += 1) {
  await go(`#/file/${FILE}/report`, 2500);
  await go(`#/file/${FILE}`, 900);
}
const afterMany = await listening();
check('and still nothing left behind after five visits',
  afterMany.length === before.length,
  JSON.stringify({
    before: before.length,
    after: afterMany.length,
    leftBehind: afterMany.filter((row) => before.indexOf(row) === -1),
  }));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
