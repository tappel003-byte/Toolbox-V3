/**
 * Two separately imported Customer Files must not share Floor Survey state.
 * Run: node tests/customer-file-cross-record.mjs
 * Requires a static server at http://127.0.0.1:8765 (repo root).
 *
 * Same address and identical legacy source ids are intentional. The date edit
 * goes through the Floor Survey inspection-date control, then the other file
 * is opened in the same session.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/index.html';
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
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.goto(BASE, { waitUntil: 'networkidle0' });

const imported = await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('toolbox', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['customerFiles', 'media'], 'readwrite');
    tx.objectStore('customerFiles').clear();
    tx.objectStore('media').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  function planDataUrl() {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 90;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 120, 90);
    ctx.strokeStyle = '#333';
    ctx.strokeRect(4, 4, 112, 82);
    return canvas.toDataURL('image/png');
  }

  function floorFile(date, marker) {
    const bundle = {
      kind: 'floor-survey-bundle',
      bundleVersion: 1,
      exportedAt: Date.now(),
      project: {
        id: 'shared-source-project',
        name: 'Sierra Del Sol LLC',
        address: '1857 Cerros Colorados, Santa Fe, NM',
        client: 'Sierra Del Sol LLC',
        inspector: 'Tim',
        inspectionDate: date,
        notes: 'Notes ' + marker,
        customSurfaces: ['Saltillo'],
        createdAt: 1,
        updatedAt: 2,
      },
      floors: [{
        id: 'shared-floor-id',
        projectId: 'shared-source-project',
        name: 'Main Level',
        order: 0,
        planDataUrl: planDataUrl(),
        planWidth: 120,
        planHeight: 90,
        boundary: [{ x: 5, y: 5 }, { x: 110, y: 5 }, { x: 110, y: 80 }, { x: 5, y: 80 }],
        areas: [{ id: 'shared-area', name: 'Area 1', polygon: [{ x: 5, y: 5 }, { x: 110, y: 5 }, { x: 110, y: 80 }], createdAt: 1 }],
        notes: [{ id: 'shared-note', x: 20, y: 20, text: marker }],
        transitions: [{ id: 'shared-transition', x: 30, y: 30, surfaceA: 'Tile', surfaceB: 'Wood', readingA: 9.1, readingB: 9.4, createdAt: 1 }],
        exclusions: [],
        createdAt: 1,
        updatedAt: 2,
      }],
      points: [
        { id: 'shared-point', floorId: 'shared-floor-id', index: 1, x: 20, y: 20, value: marker === 'A' ? 9.1 : 8.2, isBasePoint: true, label: 'BP1', createdAt: 1 },
      ],
    };
    return new File([JSON.stringify(bundle)], 'cerros-' + marker + '.floorsurvey.json', { type: 'application/json' });
  }

  async function importNew(file) {
    const parsed = await ToolboxCustomerFileImport.inspectFile(file);
    const id = 'cf-' + crypto.randomUUID();
    const result = await ToolboxCustomerFileImport.applyImport(parsed, id, {
      canvasChoice: 'new',
      clientFirstName: 'Sierra Del Sol',
      clientLastName: 'LLC',
      fieldChoices: {},
    });
    return result.destinationId;
  }

  const idA = await importNew(floorFile('2024-03-01', 'A'));
  const idB = await importNew(floorFile('2026-08-11', 'B'));
  const recA = await ToolboxDB.getCustomerFile(idA);
  const recB = await ToolboxDB.getCustomerFile(idB);
  const layer = (record) => Object.values(record.floorSurvey.byCanvasId)[0];
  recA.floorSurvey.inspectionDate = 'MUTATION-SHOULD-NOT-LEAK';
  return {
    idA,
    idB,
    floorIdA: recA.floorSurvey.id,
    floorIdB: recB.floorSurvey.id,
    canvasA: recA.planSetup.canvases[0].id,
    canvasB: recB.planSetup.canvases[0].id,
    planA: recA.planSetup.canvases[0].plan.id,
    planB: recB.planSetup.canvases[0].plan.id,
    pointA: layer(recA).points[0].id,
    pointB: layer(recB).points[0].id,
    dateA: (await ToolboxDB.getCustomerFile(idA)).floorSurvey.inspectionDate,
    dateB: recB.floorSurvey.inspectionDate,
    notesA: (await ToolboxDB.getCustomerFile(idA)).floorSurvey.surveyNotes,
    notesB: recB.floorSurvey.surveyNotes,
    valueA: layer(await ToolboxDB.getCustomerFile(idA)).points[0].value,
    valueB: layer(recB).points[0].value,
    leaked: recB.floorSurvey.inspectionDate,
    sameFloorObject: recA.floorSurvey === recB.floorSurvey,
  };
});

check('Distinct Customer File ids', imported.idA !== imported.idB, imported.idA + ' vs ' + imported.idB);
check('Distinct Floor Survey ids', imported.floorIdA && imported.floorIdA !== imported.floorIdB, imported.floorIdA + ' vs ' + imported.floorIdB);
check('Source project id is not the Customer File id', imported.idA !== 'shared-source-project' && imported.idB !== 'shared-source-project');
check('Distinct canvas ids', imported.canvasA !== imported.canvasB && imported.canvasA !== 'shared-floor-id');
check('Distinct plan media ids', imported.planA !== imported.planB);
check('Distinct point ids', imported.pointA !== imported.pointB && imported.pointA !== 'shared-point');
check('Imported dates stay on their own files', imported.dateA === '2024-03-01' && imported.dateB === '2026-08-11', imported.dateA + ' / ' + imported.dateB);
check('In-memory Floor Survey objects are not shared', imported.sameFloorObject === false && imported.leaked === '2026-08-11');
check('Readings stay with their file', imported.valueA === 9.1 && imported.valueB === 8.2, imported.valueA + ' / ' + imported.valueB);

const beforeB = await page.evaluate(async (id) => JSON.stringify(await ToolboxDB.getCustomerFile(id)), imported.idB);

async function openInspectionDate(customerFileId) {
  await page.evaluate((id) => {
    window.location.hash = '#/file/' + id + '/floor';
  }, customerFileId);
  await page.waitForFunction(() => !/Loading Floor Survey/.test(document.body.innerText), { timeout: 8000 });
  await page.evaluate(() => {
    const more = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'More');
    if (more) more.click();
  });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === 'Setup'));
  await page.evaluate(() => {
    const setup = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Setup');
    if (setup) setup.click();
  });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Topo boundary/.test(b.textContent || '')));
  await page.evaluate(() => {
    const boundary = [...document.querySelectorAll('button')].find((b) => /Topo boundary/.test(b.textContent || ''));
    if (boundary) boundary.click();
  });
  await page.waitForSelector('#fs-inspection-date', { timeout: 8000 });
}

await openInspectionDate(imported.idA);
const shownA = await page.$eval('#fs-inspection-date', (el) => el.value);
check('Survey A opens on its own date', shownA === '2024-03-01', shownA);

await page.$eval('#fs-inspection-date', (el) => {
  const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  proto.set.call(el, '2025-01-02');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForFunction(async (id) => {
  const record = await ToolboxDB.getCustomerFile(id);
  return record && record.floorSurvey && record.floorSurvey.inspectionDate === '2025-01-02';
}, { timeout: 4000 }, imported.idA);

const afterEdit = await page.evaluate(async (ids) => {
  const a = await ToolboxDB.getCustomerFile(ids.idA);
  const b = await ToolboxDB.getCustomerFile(ids.idB);
  return {
    dateA: a.floorSurvey.inspectionDate,
    snapshotB: JSON.stringify(b),
  };
}, imported);
check('Date control writes survey A only', afterEdit.dateA === '2025-01-02', afterEdit.dateA);
check('Editing survey A leaves survey B persisted record unchanged', afterEdit.snapshotB === beforeB);

await openInspectionDate(imported.idB);
const shownB = await page.$eval('#fs-inspection-date', (el) => el.value);
const afterOpenB = await page.evaluate(async (ids) => {
  const b = await ToolboxDB.getCustomerFile(ids.idB);
  const layerB = Object.values(b.floorSurvey.byCanvasId)[0];
  return {
    dateB: b.floorSurvey.inspectionDate,
    notesB: b.floorSurvey.surveyNotes,
    valueB: layerB.points[0].value,
    floorIdB: b.floorSurvey.id,
    canvasB: b.planSetup.canvases[0].id,
    areaName: layerB.areas && layerB.areas[0] ? layerB.areas[0].name : '',
  };
}, imported);

check('Survey B still displays its own date after editing A', shownB === '2026-08-11', shownB);
check('Survey B readings, notes, date, and ids stay B\'s',
  afterOpenB.dateB === '2026-08-11' && afterOpenB.notesB === 'Notes B' && afterOpenB.valueB === 8.2 &&
  afterOpenB.floorIdB === imported.floorIdB && afterOpenB.canvasB === imported.canvasB,
  JSON.stringify(afterOpenB));

const failed = results.filter((item) => !item.ok);
console.log(failed.length ? 'FAILED ' + failed.length : 'ALL PASSED ' + results.length);
await browser.close();
process.exit(failed.length ? 1 : 0);
