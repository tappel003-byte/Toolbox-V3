/**
 * Every text block on a sheet's rail is the investigator's to change.
 * Run: node tests/report-rail-editable.mjs   (needs a static server on 8765)
 *
 * Tim: "All text on the rail needs to be editable by the user." The rail is
 * generated -- the client from the Customer File, the date and the readings
 * from the survey, the figure number from the slide's place in the book --
 * and generated is right until the one time it is not. So every block takes
 * his words when he writes any, keeps the generated line when he does not,
 * and gives the generated line back when he empties it.
 *
 * What this guards: that each block can be typed into, that what is typed
 * reaches the Customer File and survives leaving and coming back, that an
 * untouched block is still generated, that emptying one restores it, and
 * that the stamps in the page rail stay inert.
 */
import { createRequire } from 'module';
import { mkdir, writeFile } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-rail-edit';
const results = [];
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async ({ png, id }) => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('toolbox', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(['customerFiles', 'media'], 'readwrite');
    transaction.objectStore('customerFiles').clear();
    transaction.objectStore('media').clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  const record = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Dana';
  record.lastName = 'Okafor';
  record.propertyAddress = '42 Rail Road\nSanta Fe, NM 87505';
  const canvasId = record.planSetup.canvases[0].id;
  await window.ToolboxDB.putMedia('plan-rail', png);
  record.planSetup.canvases[0].plan = { id: 'plan-rail', width: 400, height: 300 };
  record.planSetup.canvases[0].frontDoorFacing = 'N';
  const poly = [
    { x: 40, y: 40 }, { x: 360, y: 40 }, { x: 360, y: 260 }, { x: 40, y: 260 },
  ];
  record.floorSurvey = {
    id: 'fs-rail',
    inspectionDate: '2026-05-04',
    byCanvasId: {
      [canvasId]: {
        canvasId,
        points: [
          { id: 'p1', floorId: canvasId, x: 80, y: 80, value: 5.5, index: 1 },
          { id: 'p2', floorId: canvasId, x: 200, y: 100, value: 10.0, index: 2 },
          { id: 'p3', floorId: canvasId, x: 120, y: 180, value: 7.2, index: 3 },
          { id: 'p4', floorId: canvasId, x: 300, y: 150, value: 8.1, index: 4 },
        ],
        areas: [{ id: 'a1', name: 'Main', polygon: poly, createdAt: 1 }],
        boundary: poly,
      },
    },
  };
  await window.ToolboxDB.saveCustomerFile(record);
}, { png: TINY_PNG, id: FILE });

async function openFloorSheet() {
  await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('.rb-thumb[data-page-id^="floor-"]'), { timeout: 20000 });
  // Clicked from inside the page: the rail of stamps is rebuilt whenever the
  // book re-renders, which can happen between resolving a handle and using it.
  await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id^="floor-"]').click());
  await page.waitForFunction(
    () => document.querySelector('.rb-sheet [data-rb-rail-field="client"]'), { timeout: 20000 });
}

const railText = (key) => page.evaluate((k) => {
  const el = document.querySelector(`.rb-sheet [data-rb-rail-field="${k}"]`);
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
}, key);

/** Type into a block the way the investigator does, and wait for the save. */
async function typeInto(key, value) {
  await page.evaluate(({ k, v }) => {
    const el = document.querySelector(`.rb-sheet [data-rb-rail-field="${k}"]`);
    el.focus();
    el.textContent = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { k: key, v: value });
  await page.waitForFunction(
    () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''),
    { timeout: 10000 });
}

await openFloorSheet();

const blocks = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet');
  return [...sheet.querySelectorAll('[data-rb-rail-field]')].map((n) => ({
    key: n.getAttribute('data-rb-rail-field'),
    editable: n.getAttribute('contenteditable') === 'true',
    rich: n.getAttribute('data-rb-rich'),
    text: n.textContent.replace(/\s+/g, ' ').trim(),
  }));
});
const keys = blocks.map((b) => b.key);
check('the rail offers the client, the address, the title and the date',
  ['client', 'address', 'head:title', 'title', 'head:date', 'date', 'corrected']
    .every((k) => keys.indexOf(k) !== -1),
  keys.join(', '));
check('the figure number is a block of its own', keys.indexOf('figure') !== -1, keys.join(', '));
check('every block is editable and carries a rich-text key',
  blocks.length > 0 && blocks.every((b) => b.editable && b.rich === 'rail:' + b.key),
  JSON.stringify(blocks.filter((b) => !b.editable)));
// The client line is the residence title the decks use -- "Okafor Residence",
// set over two lines -- not the full name.
check('the blocks start on the generated lines',
  /Okafor\s*Residence/.test(blocks.find((b) => b.key === 'client')?.text || '') &&
  /42 Rail Road/.test(blocks.find((b) => b.key === 'address')?.text || '') &&
  /May 4, 2026|05\/04\/2026/.test(blocks.find((b) => b.key === 'date')?.text || ''),
  JSON.stringify(blocks.slice(0, 3)));

// A reading is text on the rail like any other, and is keyed by its boundary
// so a surface renamed in Floor Survey keeps the words written about it.
await page.evaluate(() => document.querySelector('[data-rb-floor-import]')?.click());
await page.waitForFunction(() => !!document.querySelector('[data-rb-floor-box="topo"]'), { timeout: 20000 });
await page.waitForFunction(
  () => document.querySelectorAll('.rb-sheet .rb-rail__reading').length >= 3, { timeout: 20000 });
const readingKeys = await page.evaluate(() => [...document.querySelectorAll('.rb-sheet [data-rb-rail-field]')]
  .map((n) => n.getAttribute('data-rb-rail-field'))
  .filter((k) => k.indexOf('lvl:') === 0));
check('each reading label and value is its own block, keyed by boundary',
  ['lvl:a1:name', 'lvl:a1:hi:label', 'lvl:a1:hi:value', 'lvl:a1:lo:value', 'lvl:a1:delta:value']
    .every((k) => readingKeys.indexOf(k) !== -1),
  readingKeys.join(', '));

await typeInto('client', 'Okafor Trust');
await typeInto('corrected', 'Corrected for Floor Differences');
await typeInto('lvl:a1:hi:value', '10.0 in at the hearth');

const stored = await page.evaluate(async (id) => {
  const record = await window.ToolboxDB.getCustomerFile(id);
  const floor = (record.reportBuilder?.pages || []).find((p) => p.type === 'floor');
  const plain = (value) => !value ? '' : (value.paragraphs || [])
    .map((para) => (para.runs || []).map((run) => run.text || '').join('')).join('\n');
  const rail = floor?.reportText?.rail || {};
  return {
    keys: Object.keys(rail).sort(),
    client: plain(rail.client),
    corrected: plain(rail.corrected),
    hi: plain(rail['lvl:a1:hi:value']),
  };
}, FILE);
check('what is typed is saved on the Customer File, and only that',
  stored.client === 'Okafor Trust' &&
  stored.corrected === 'Corrected for Floor Differences' &&
  stored.hi === '10.0 in at the hearth' &&
  stored.keys.length === 3,
  JSON.stringify(stored));

await openFloorSheet();
const reopened = {
  client: await railText('client'),
  corrected: await railText('corrected'),
  date: await railText('date'),
};
check('the words come back on reopening, and an untouched block is still generated',
  reopened.client === 'Okafor Trust' &&
  reopened.corrected === 'Corrected for Floor Differences' &&
  /May 4, 2026|05\/04\/2026/.test(reopened.date || ''),
  JSON.stringify(reopened));

// Emptying a block is the way back to the generated line. It is restored on
// leaving the block, not on the keystroke that empties it, so a line can be
// cleared and retyped without the old text landing back under the caret.
await typeInto('client', '');
const whileEmpty = await railText('client');
await page.evaluate(() => document.querySelector('.rb-sheet [data-rb-rail-field="client"]').blur());
await page.waitForFunction(
  () => /Okafor/.test(document.querySelector('.rb-sheet [data-rb-rail-field="client"]')?.textContent || ''),
  { timeout: 10000 });
const restored = await railText('client');
const afterClear = await page.evaluate(async (id) => {
  const record = await window.ToolboxDB.getCustomerFile(id);
  const floor = (record.reportBuilder?.pages || []).find((p) => p.type === 'floor');
  return Object.keys(floor?.reportText?.rail || {}).sort();
}, FILE);
check('emptying a block drops the override and the generated line returns',
  whileEmpty === '' && /Okafor/.test(restored || '') && afterClear.indexOf('client') === -1,
  JSON.stringify({ whileEmpty, restored, afterClear }));

const thumbs = await page.evaluate(() => {
  const stamps = [...document.querySelectorAll('.rb-sheet--thumb')];
  const fields = stamps.flatMap((s) => [...s.querySelectorAll('[contenteditable="true"]')]);
  return { stamps: stamps.length, writable: fields.length };
});
check('the page stamps stay inert', thumbs.stamps > 0 && thumbs.writable === 0, JSON.stringify(thumbs));

await page.screenshot({ path: `${OUT}/report-rail-editable.png`, fullPage: false });
await writeFile(`${OUT}/report-rail-editable.json`, JSON.stringify(results, null, 2));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
