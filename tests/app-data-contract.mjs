/**
 * Focused ownership-contract tests for Customer File / Distress / Floor Survey.
 * Run: NODE_PATH=/tmp/node_modules node tests/app-data-contract.mjs
 * Requires a static server at http://127.0.0.1:8765 (repo root).
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

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(mark + '  ' + name + (detail ? ' — ' + detail : ''));
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: 'networkidle0' });

const report = await page.evaluate(async () => {
  const out = [];
  function assert(name, cond, detail) {
    out.push({ name: name, ok: !!cond, detail: detail || '' });
  }

  try {
  const PS = window.ToolboxPlanSetup;
  const DB = window.ToolboxDB;
  const App = window.ToolboxApp;

  // Wipe stores for isolation
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open('toolbox', 2);
    req.onerror = () => rej(req.error);
    req.onsuccess = () => res(req.result);
  });
  await new Promise((res, rej) => {
    const tx = db.transaction(['customerFiles', 'media'], 'readwrite');
    tx.objectStore('customerFiles').clear();
    tx.objectStore('media').clear();
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });

  // 1. New Customer File create + persist
  const id1 = 'cf-contract-new';
  let rec = App.blankCustomerFile(id1);
  PS.ensurePlanSetup(rec);
  rec.firstName = 'Ada';
  rec.lastName = 'Lovelace';
  rec.propertyAddress = '1 Analytical Engine Way';
  await DB.saveCustomerFile(rec);
  let loaded = await DB.getCustomerFile(id1);
  assert(
    '1. New Customer File creates and persists',
    loaded && loaded.firstName === 'Ada' && loaded.id === id1,
    loaded ? 'id=' + loaded.id : 'missing'
  );

  // 2. Existing CF opens / ensure is tolerant
  PS.ensurePlanSetup(loaded);
  assert(
    '2. Existing Customer File still opens (ensurePlanSetup ok)',
    loaded.planSetup && loaded.distress && loaded.floorSurvey,
    'has planSetup/distress/floorSurvey'
  );

  // 3. Single-level stable canvas ID
  const singleCanvasId = loaded.planSetup.canvases[0].id;
  const beforeSingle = singleCanvasId;
  PS.ensurePlanSetup(loaded);
  assert(
    '3. Single-level CF retains stable canvas ID',
    loaded.planSetup.canvases.length === 1 &&
      loaded.planSetup.canvases[0].id === beforeSingle,
    beforeSingle
  );

  // 4. Multi-level independent stable IDs
  const c2 = PS.blankCanvas('Second Floor');
  const c2Id = c2.id;
  loaded.planSetup.canvases.push(c2);
  loaded.planSetup.activeCanvasId = c2Id;
  PS.ensurePlanSetup(loaded);
  await DB.saveCustomerFile(loaded);
  loaded = await DB.getCustomerFile(id1);
  PS.ensurePlanSetup(loaded);
  const ids = loaded.planSetup.canvases.map((c) => c.id);
  assert(
    '4. Multi-level CF retains independent stable canvas IDs',
    ids.length === 2 && ids[0] === beforeSingle && ids[1] === c2Id && ids[0] !== ids[1],
    ids.join(', ')
  );

  // 5. Distress pin references canvasId without duplicating plan
  const pinCanvas = beforeSingle;
  loaded.distress.pins.push({
    id: 'pin-1',
    canvasId: pinCanvas,
    // proven-ish reserved fields placeholders — not a plan copy
    startNum: 1,
    photoCount: 1,
    x: 0.4,
    y: 0.5,
  });
  PS.ensurePlanSetup(loaded);
  const pin = loaded.distress.pins[0];
  const pinHasPlan = !!(pin.plan || pin.planImage || pin.rooms || pin.dataUrl);
  assert(
    '5. Distress pin references CF canvasId without duplicating plan',
    pin.canvasId === pinCanvas && !pinHasPlan,
    'canvasId=' + pin.canvasId + ' planDup=' + pinHasPlan
  );
  await DB.saveCustomerFile(loaded);

  // 6. Numbering fields unchanged by this work
  assert(
    '6. Distress numbering fields preserved (startNum/nextNum)',
    loaded.distress.startNum === 1 && loaded.distress.nextNum === 1,
    'startNum=' + loaded.distress.startNum + ' nextNum=' + loaded.distress.nextNum
  );

  // 7. Legacy distress.surfaces migration
  const legacyId = 'cf-legacy-surfaces';
  let legacy = App.blankCustomerFile(legacyId);
  const surfA = 'canvas-legacy-a';
  const surfB = 'canvas-legacy-b';
  legacy.distress = {
    id: 'distress-legacy',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startNum: 1,
    nextNum: 3,
    activeSurfaceId: surfA,
    buildingType: 'residential',
    pins: [{ id: 'legacy-pin', startNum: 1, photoCount: 2 }],
    surfaces: [
      {
        id: surfA,
        name: 'Ground',
        plan: { id: 'media-legacy-a', width: 100, height: 80 },
        rooms: [{ id: 'r1', name: 'Kitchen' }],
        frontDoorFacing: 'N',
        frontDoor: { x: 0.5, y: 0.9 },
      },
      {
        id: surfB,
        name: 'Upstairs',
        plan: null,
        rooms: [],
        frontDoorFacing: 'S',
        frontDoor: null,
      },
    ],
  };
  // Put fake media so plan ref remains valid identity (bytes optional for this test)
  await DB.putMedia('media-legacy-a', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==');
  PS.ensurePlanSetup(legacy);
  assert(
    '7a. Legacy migration in-memory before save',
    !legacy.distress.surfaces &&
      legacy.planSetup.canvases.length === 2 &&
      legacy.planSetup.canvases[0].id === surfA &&
      legacy.distress.pins &&
      legacy.distress.pins[0] &&
      legacy.distress.pins[0].canvasId === surfA &&
      legacy.distress.nextNum === 3,
    'pins=' + JSON.stringify(legacy.distress.pins) +
      ' canvases=' + (legacy.planSetup.canvases || []).map(function (c) { return c.id; }).join(',')
  );
  await DB.saveCustomerFile(legacy);
  legacy = await DB.getCustomerFile(legacyId);
  PS.ensurePlanSetup(legacy);
  const migratedIds = legacy.planSetup.canvases.map((c) => c.id);
  const pin0 = legacy.distress && legacy.distress.pins && legacy.distress.pins[0];
  const pinBackfill = pin0 && pin0.canvasId;
  assert(
    '7. Legacy distress.surfaces migration still works',
    !legacy.distress.surfaces &&
      migratedIds[0] === surfA &&
      migratedIds[1] === surfB &&
      legacy.planSetup.canvases[0].plan &&
      legacy.planSetup.canvases[0].plan.id === 'media-legacy-a' &&
      legacy.distress.nextNum === 3 &&
      pinBackfill === surfA,
    'canvases=' + migratedIds.join(',') + ' pin.canvasId=' + pinBackfill
  );

  // 8. Floor Survey container associates by canvasId without owning plan
  const fsRec = await DB.getCustomerFile(id1);
  PS.ensurePlanSetup(fsRec);
  const targetCanvas = fsRec.planSetup.canvases[0].id;
  PS.ensureFloorSurveyCanvasRef(fsRec, targetCanvas);
  const layer = fsRec.floorSurvey.byCanvasId[targetCanvas];
  const layerHasPlan = !!(layer.plan || layer.planImage || layer.rooms || layer.mediaId);
  assert(
    '8. Floor Survey associates app data with CF canvasId without owning plan',
    layer && layer.canvasId === targetCanvas && !layerHasPlan &&
      !(fsRec.floorSurvey.canvases || fsRec.floorSurvey.surfaces),
    JSON.stringify(layer)
  );

  // 9. Reload/reopen preserves references
  await DB.saveCustomerFile(fsRec);
  const reopened = await DB.getCustomerFile(id1);
  PS.ensurePlanSetup(reopened);
  const reopenPin = reopened.distress && reopened.distress.pins && reopened.distress.pins[0];
  assert(
    '9. Reload/reopen preserves canvas + pin + floorSurvey refs',
    reopened.planSetup.canvases[0].id === beforeSingle &&
      reopenPin &&
      reopenPin.canvasId === beforeSingle &&
      reopened.floorSurvey.byCanvasId[beforeSingle] &&
      reopened.floorSurvey.byCanvasId[beforeSingle].canvasId === beforeSingle,
    'pin=' + JSON.stringify(reopenPin) +
      ' floor=' + JSON.stringify(reopened.floorSurvey && reopened.floorSurvey.byCanvasId)
  );

  // 10. Missing optional app containers on older records tolerated
  const oldId = 'cf-old-minimal';
  const oldRec = {
    id: oldId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    firstName: 'Old',
    lastName: 'Record',
    propertyAddress: '',
    cellPhone: '',
    homePhone: '',
    email: '',
    notes: '',
    companyName: '',
    spouseName: '',
    spouseCellPhone: '',
    spouseHomePhone: '',
    spouseEmail: '',
    mailingSameAsProperty: false,
    mailingAddress: '',
    propertyAddressLat: null,
    propertyAddressLon: null,
    // intentionally no planSetup / distress / floorSurvey
  };
  await DB.saveCustomerFile(oldRec);
  let revived = await DB.getCustomerFile(oldId);
  const changed = PS.ensurePlanSetup(revived);
  assert(
    '10. Missing optional app containers on older records are tolerated',
    changed === true &&
      revived.planSetup &&
      revived.planSetup.canvases.length >= 1 &&
      revived.distress &&
      Array.isArray(revived.distress.pins) &&
      revived.floorSurvey &&
      revived.floorSurvey.schemaVersion === 1 &&
      revived.floorSurvey.byCanvasId &&
      typeof revived.floorSurvey.byCanvasId === 'object',
    'ensure changed=' + changed
  );

  // 11. No CF plan/media duplication introduced by contract helpers
  const mediaBefore = await DB.getMedia('media-legacy-a');
  PS.ensureFloorSurveyCanvasRef(legacy, surfA);
  PS.ensurePlanSetup(legacy);
  const mediaAfter = await DB.getMedia('media-legacy-a');
  const floorLayer = legacy.floorSurvey.byCanvasId[surfA];
  assert(
    '11. No Customer File plan/media duplication introduced',
    mediaBefore === mediaAfter &&
      floorLayer &&
      !floorLayer.plan &&
      legacy.planSetup.canvases.filter((c) => c.plan && c.plan.id === 'media-legacy-a').length === 1,
    'single media ref retained'
  );

  // 12. Existing CF workflow still passes (ensure + home fields + numbering reserved)
  assert(
    '12. Existing Customer File workflow contract still intact',
    typeof PS.ensurePlanSetup === 'function' &&
      typeof PS.migrateLegacyDistressSurfaces === 'function' &&
      typeof PS.findOrphanedCanvasRefs === 'function' &&
      typeof App.blankCustomerFile === 'function' &&
      reopened.distress.startNum === 1 &&
      typeof reopened.distress.nextNum === 'number',
    'APIs present'
  );

  // Orphan detection capability (future deletion guard — not cascade)
  const orphanProbe = JSON.parse(JSON.stringify(reopened));
  orphanProbe.distress.pins.push({ id: 'orphan-pin', canvasId: 'missing-canvas-xyz' });
  orphanProbe.floorSurvey.byCanvasId['missing-canvas-xyz'] = { canvasId: 'missing-canvas-xyz' };
  const orphans = PS.findOrphanedCanvasRefs(orphanProbe);
  assert(
    'Orphan detection possible without destructive cascade',
    orphans.distressPins.length === 1 &&
      orphans.distressPins[0].canvasId === 'missing-canvas-xyz' &&
      orphans.floorSurveyCanvasIds.indexOf('missing-canvas-xyz') !== -1,
    JSON.stringify(orphans)
  );

  return out;
  } catch (err) {
    out.push({
      name: 'EVAL_ERROR',
      ok: false,
      detail: (err && err.stack) || String(err),
    });
    return out;
  }
});

for (const r of report) check(r.name, r.ok, r.detail);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) {
  process.exitCode = 1;
}
