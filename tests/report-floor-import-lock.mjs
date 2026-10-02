/**
 * Floor Survey Import → Lock layout + Distress Put pictures on report.
 * Run: node tests/report-floor-import-lock.mjs
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

await page.evaluate(async (png) => {
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

  const record = window.ToolboxApp.blankCustomerFile('rb-floor-lock');
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Lee';
  record.lastName = 'Chalmers';
  record.propertyAddress = '100 Import Road';
  const canvasId = record.planSetup.canvases[0].id;
  await window.ToolboxDB.putMedia('plan-lock', png);
  record.planSetup.canvases[0].plan = { id: 'plan-lock', width: 400, height: 300 };
  record.planSetup.canvases[0].frontDoorFacing = 'N';
  await window.ToolboxDB.putMedia('ph-lock-1', png);
  record.distress = {
    mode: 'internal',
    startNum: 1,
    nextNum: 2,
    activeCanvasId: canvasId,
    pins: [{
      id: 'pin-1',
      num: 1,
      x: 0.4,
      y: 0.4,
      canvasId,
      location: 'Office',
      description: 'Hairline crack',
      photos: [{ id: 'ph-lock-1' }],
    }],
  };
  const poly = [
    { x: 40, y: 40 }, { x: 360, y: 40 }, { x: 360, y: 260 }, { x: 40, y: 260 },
  ];
  record.floorSurvey = {
    id: 'fs-1',
    inspectionDate: '2026-10-01',
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
}, TINY_PNG);

await page.goto(`${BASE}#/file/rb-floor-lock/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('.rb-shell'), { timeout: 15000 });
await page.waitForFunction(() => document.querySelector('.rb-thumb[data-page-id^="floor-"]'), { timeout: 15000 });
await page.click('.rb-thumb[data-page-id^="floor-"]');
await page.waitForFunction(() => document.querySelector('[data-rb-floor-import]'), { timeout: 15000 });

const chromeOnly = await page.evaluate(() => ({
  hasImport: !!document.querySelector('[data-rb-floor-import]'),
  hasTopoBox: !!document.querySelector('[data-rb-floor-box="topo"]'),
  empty: !!document.querySelector('.rb-floor-empty'),
}));
check('Floor page starts chrome-only with Import', chromeOnly.hasImport && chromeOnly.empty && !chromeOnly.hasTopoBox, JSON.stringify(chromeOnly));

await page.click('[data-rb-floor-import]');
await page.waitForFunction(() => !!document.querySelector('[data-rb-floor-box="topo"]'), {
  timeout: 20000,
});

const afterImport = await page.evaluate(() => ({
  imported: !!document.querySelector('[data-rb-floor-box="topo"]'),
  lock: document.querySelector('[data-rb-floor-lock]')?.getAttribute('data-rb-floor-lock') || '',
  legend: !!document.querySelector('.rb-floor-box--legend'),
  pill: !!document.querySelector('.rb-floor-box--pill'),
}));
check(
  'Import places topo, legend, pill and offers Lock',
  afterImport.imported && afterImport.lock === 'lock' && afterImport.legend && afterImport.pill,
  JSON.stringify(afterImport),
);

if (afterImport.imported) {
  await page.click('[data-rb-floor-lock="lock"]');
  await page.waitForFunction(() => document.querySelector('[data-rb-floor-lock="unlock"]'), { timeout: 10000 });
  await page.waitForFunction(() => {
    const text = document.querySelector('#rb-save-status')?.textContent || '';
    return /^Saved/.test(text) && !/Saving/.test(text);
  }, { timeout: 10000 });
  await page.waitForFunction(async () => {
    const record = await window.ToolboxDB.getCustomerFile('rb-floor-lock');
    return !!record.reportBuilder?.floorLayout?.locked;
  }, { timeout: 10000 });
  const locked = await page.evaluate(async () => {
    const record = await window.ToolboxDB.getCustomerFile('rb-floor-lock');
    return {
      docLocked: !!record.reportBuilder?.floorLayout?.locked,
      hasTopo: !!record.reportBuilder?.floorLayout?.topo,
      btn: document.querySelector('[data-rb-floor-lock]')?.getAttribute('data-rb-floor-lock') || '',
      boxLocked: !!document.querySelector('.rb-floor-box.is-locked'),
    };
  });
  check('Lock persists floorLayout on Customer File', locked.docLocked && locked.hasTopo && locked.btn === 'unlock' && locked.boxLocked, JSON.stringify(locked));
}

const staged = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-floor-lock');
  const result = await window.ToolboxReportBuilder.stagePicturesFromDistress(record);
  const again = await window.ToolboxDB.getCustomerFile('rb-floor-lock');
  const pictures = (again.reportBuilder?.pages || []).filter((p) => p.type === 'pictures');
  return { result, picturePages: pictures.length, keys: pictures[0]?.meta?.photoKeys || [] };
});
check(
  'Distress Put on report stages Pictures slides',
  staged.result?.photoCount === 1 && staged.picturePages >= 1 && staged.keys.includes('ph-lock-1'),
  JSON.stringify(staged),
);

await page.screenshot({ path: `${OUT}/report-floor-import-lock.png`, fullPage: true });
await writeFile(`${OUT}/report-floor-import-lock.json`, JSON.stringify({ results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
