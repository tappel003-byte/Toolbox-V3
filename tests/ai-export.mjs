/**
 * AI package export: one Customer File ZIP, distinct floor epochs/levels,
 * absent surveys, photo roles, and no secrets.
 * Run: node tests/ai-export.mjs
 * Requires a static server at http://127.0.0.1:8765 (repo root).
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
const OUT = '/opt/cursor/artifacts/screenshots';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.goto(BASE, { waitUntil: 'networkidle0' });

const report = await page.evaluate(async (png) => {
  const out = [];
  function assert(name, cond, detail) {
    out.push({ name: name, ok: !!cond, detail: detail || '' });
  }

  const plans = { 'plan-basement': png, 'plan-main': png };
  const photos = {
    'ph_import-11111111-1111-1111-1111-111111111111': png,
    ph_pin_b: png,
    ph_quick: png,
    ph_loose: png,
    ph_general: png,
  };
  const deps = {
    now: function () { return '2026-09-24T15:00:00.000Z'; },
    getPlanMedia: function (id) { return Promise.resolve(plans[id] || null); },
    getDistressMedia: function (id) { return Promise.resolve(photos[id] || null); },
  };

  function canvases() {
    return [
      {
        id: 'canvas-basement',
        name: 'Basement',
        plan: { id: 'plan-basement', width: 100, height: 100 },
        rooms: [{ id: 'room-1', name: 'North Bedroom', x: 0.5, y: 0.1 }],
        frontDoorFacing: 'S',
        frontDoor: { x: 0.5, y: 0.9 },
      },
      {
        id: 'canvas-main',
        name: 'Main Level',
        plan: { id: 'plan-main', width: 120, height: 80 },
        rooms: [],
        frontDoorFacing: 'S',
        frontDoor: null,
      },
      {
        id: 'canvas-porch',
        name: 'Porch',
        plan: { id: 'plan-missing', width: 40, height: 40 },
        rooms: [],
        frontDoorFacing: '',
        frontDoor: null,
      },
    ];
  }

  async function readZip(zip) {
    const text = {};
    const names = [];
    const jobs = [];
    zip.forEach(function (path, entry) {
      if (entry.dir) return;
      names.push(path);
      if (/\.(json|txt|csv)$/i.test(path)) {
        jobs.push(entry.async('string').then(function (value) { text[path] = value; }));
      }
    });
    await Promise.all(jobs);
    return { names: names, text: text };
  }

  function joined(text) {
    return Object.keys(text).map(function (key) { return text[key]; }).join('\n');
  }

  const full = {
    id: 'cf-ai-bridge',
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-02T00:00:00.000Z',
    customerUpdatedAt: '2026-03-02T00:00:00.000Z',
    firstName: 'Mara',
    lastName: 'Ellison',
    propertyAddress: '18 Cedar Court',
    cellPhone: '555-0100',
    email: 'mara@example.com',
    notes: 'Client wants the north bedroom discussed.',
    accessToken: 'LEAK-TOKEN-99',
    syncApiBase: 'https://sync.example.invalid/secret',
    geoapifyApiKey: 'LEAK-GEO-KEY',
    planSetup: {
      buildingType: 'residential',
      activeCanvasId: 'canvas-basement',
      canvases: canvases(),
    },
    floorSurvey: {
      id: 'floor-1',
      schemaVersion: 1,
      byCanvasId: {},
      epochs: [
        {
          id: 'epoch-2024',
          inspectionDate: '2024-06-15',
          byCanvasId: {
            'canvas-basement': {
              canvasId: 'canvas-basement',
              workerSecret: 'LEAK-R2-SECRET',
              boundary: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
              points: [{ id: 'read-2024-basement', index: 1, x: 10, y: 12, value: 9.25, isBasePoint: true, createdAt: 1 }],
              transitions: [{ id: 'corr-2024', x: 1, y: 2, surfaceA: 'Carpet', surfaceB: 'Tile', readingA: 9.1, readingB: 8.4 }],
            },
          },
        },
        {
          id: 'epoch-2026',
          inspectionDate: '2026-03-02',
          byCanvasId: {
            'canvas-basement': {
              canvasId: 'canvas-basement',
              points: [{ id: 'read-2026-basement', index: 1, x: 11, y: 13, value: 8.5, createdAt: 2 }],
            },
            'canvas-main': {
              canvasId: 'canvas-main',
              points: [{ id: 'read-2026-main', index: 1, x: 20, y: 21, value: 7.75, createdAt: 3 }],
            },
          },
        },
      ],
    },
    distress: {
      id: 'distress-1',
      startNum: 1,
      nextNum: 4,
      activeCanvasId: 'canvas-basement',
      pins: [
        {
          id: 'pin-base',
          canvasId: 'canvas-basement',
          x: 50,
          y: 10,
          photos: ['ph_import-11111111-1111-1111-1111-111111111111'],
          description: 'Hairline at the window',
          location: 'Laundry',
          category: 'Crack',
          isExterior: false,
          apiKey: 'LEAK-API-KEY',
        },
        {
          id: 'pin-main',
          canvasId: 'canvas-main',
          x: 10,
          y: 10,
          photos: ['ph_pin_b', 'ph_missing'],
          description: 'Door sticks',
          location: '',
          category: 'Door',
          isExterior: true,
        },
      ],
      drawings: [],
      quickCapture: [{ id: 'ph_quick', ts: 1710000000000, lat: 35.1, lng: -106.5 }],
      unassignedPhotos: ['ph_loose'],
      generalPhotos: [{ id: 'ph_general', subject: 'Exterior overview' }],
    },
    diagnostics: {
      updatedAt: '2026-04-01T00:00:00.000Z',
      summary: 'Stored tilt note',
      plot: png,
    },
    reportBuilder: {
      updatedAt: '2026-04-02T00:00:00.000Z',
      title: 'Draft discussion',
    },
    recoveryImports: [{
      kind: 'distress',
      sourceName: 'sample-distress.zip',
      importedAt: '2026-01-01T00:00:00.000Z',
      canvasIds: ['canvas-basement'],
      fingerprint: 'abc',
      pinIds: ['pin-base'],
      photoIds: ['ph_import-11111111-1111-1111-1111-111111111111'],
      planMediaIds: ['plan-basement'],
      floorMetadataBefore: {
        inspectionDate: '1999-01-01',
        surveyNotes: 'before-import-note',
        byCanvasId: {
          'canvas-ghost': {
            points: [{ id: 'removed-reading-should-not-export', value: 1.01 }],
          },
        },
      },
      excludedObservations: [{
        num: 9,
        description: 'Unplaced crack',
        sourceId: 'src-left-out',
        heading: 'Observation 9 — Unplaced crack',
        reason: 'This observation has an invalid coordinate.',
      }],
    }],
  };

  const before = JSON.stringify(full);
  let saves = 0;
  let listed = 0;
  let recoveryWrites = 0;
  const origSave = window.ToolboxDB.saveCustomerFile;
  const origList = window.ToolboxDB.getAllCustomerFiles;
  const origRecoveryWrite = window.ToolboxDB.commitCustomerFileRecoveryUpdate;
  window.ToolboxDB.saveCustomerFile = function () {
    saves += 1;
    return Promise.resolve();
  };
  window.ToolboxDB.getAllCustomerFiles = function () {
    listed += 1;
    return Promise.resolve([]);
  };
  window.ToolboxDB.commitCustomerFileRecoveryUpdate = function () {
    recoveryWrites += 1;
    return Promise.resolve();
  };

  let built;
  try {
    built = await window.ToolboxAiExport.buildPackage(full, deps);
  } catch (error) {
    assert('full package builds', false, error && error.message);
    return out;
  }
  assert('full package builds', true);
  assert('export does not save the Customer File', saves === 0, 'saves=' + saves);
  assert('export does not list other Customer Files', listed === 0, 'listed=' + listed);
  assert('export does not remove a recovered component', recoveryWrites === 0, 'recoveryWrites=' + recoveryWrites);
  assert('source record is unchanged', JSON.stringify(full) === before);
  window.ToolboxDB.saveCustomerFile = origSave;
  window.ToolboxDB.getAllCustomerFiles = origList;
  window.ToolboxDB.commitCustomerFileRecoveryUpdate = origRecoveryWrite;

  const zip = await readZip(built.zip);
  const blob = joined(zip.text);
  assert('filename identifies the customer and day', built.filename === 'Toolbox-AI-Mara-Ellison-2026-09-24.zip', built.filename);
  assert('manifest schema', built.manifest.schema === 'toolbox.ai-package' && built.manifest.schemaVersion === 1);
  assert('manifest is only this Customer File', built.manifest.customerFileId === 'cf-ai-bridge' && blob.indexOf('cf-other') === -1);
  assert('inventory file is in the ZIP', zip.names.indexOf('INVENTORY.txt') !== -1 && zip.names.indexOf('inventory.json') !== -1);
  assert('contact notes are included', blob.indexOf('Client wants the north bedroom discussed.') !== -1);
  assert('secrets are not copied', blob.indexOf('LEAK-TOKEN-99') === -1 && blob.indexOf('LEAK-R2-SECRET') === -1 && blob.indexOf('LEAK-API-KEY') === -1 && blob.indexOf('LEAK-GEO-KEY') === -1 && blob.indexOf('sync.example.invalid') === -1);

  const inventory = JSON.parse(zip.text['inventory.json']);
  assert('two floor epochs stay distinct', inventory.components.floorSurvey.epochCount === 2 && inventory.components.floorSurvey.levelCount === 3, JSON.stringify({
    epochs: inventory.components.floorSurvey.epochCount,
    levels: inventory.components.floorSurvey.levelCount,
  }));
  const epoch2024 = zip.text['floor-survey/epochs/epoch-2024/levels/canvas-basement/readings.csv'] || '';
  const epoch2026Base = zip.text['floor-survey/epochs/epoch-2026/levels/canvas-basement/readings.csv'] || '';
  const epoch2026Main = zip.text['floor-survey/epochs/epoch-2026/levels/canvas-main/readings.csv'] || '';
  assert('2024 readings stay on the 2024 level', epoch2024.indexOf('read-2024-basement') !== -1 && epoch2024.indexOf('read-2026') === -1 && epoch2024.indexOf('9.25') !== -1);
  assert('2026 basement readings stay on that level', epoch2026Base.indexOf('read-2026-basement') !== -1 && epoch2026Base.indexOf('read-2026-main') === -1 && epoch2026Base.indexOf('read-2024') === -1);
  assert('2026 main readings stay on that level', epoch2026Main.indexOf('read-2026-main') !== -1 && epoch2026Main.indexOf('7.75') !== -1 && epoch2026Main.indexOf('read-2024') === -1 && epoch2026Main.indexOf('read-2026-basement') === -1);
  const corrections = zip.text['floor-survey/epochs/epoch-2024/levels/canvas-basement/corrections.csv'] || '';
  assert('flooring corrections stay with their level', corrections.indexOf('Carpet') !== -1 && corrections.indexOf('Tile') !== -1 && corrections.indexOf('corr-2024') !== -1);

  const pins = zip.text['distress/pins.csv'] || '';
  assert('distress numbers continue across levels', pins.indexOf('pin-base') !== -1 && pins.indexOf('pin-main') !== -1 && pins.indexOf('Laundry') !== -1);
  const survey = JSON.parse(zip.text['distress/survey.json']);
  const basePin = survey.pins.filter(function (pin) { return pin.id === 'pin-base'; })[0];
  const mainPin = survey.pins.filter(function (pin) { return pin.id === 'pin-main'; })[0];
  assert('pin numbers are one sequence', basePin && basePin.number === 1 && mainPin && mainPin.number === 2, JSON.stringify({ base: basePin && basePin.number, main: mainPin && mainPin.number }));
  assert('direction uses the plan front door', basePin && basePin.direction === 'N' && basePin.directionSource === 'front-door', basePin && basePin.direction);
  assert('stored room is kept', basePin && basePin.room === 'Laundry' && basePin.roomSource === 'stored');
  assert('legend category is kept', basePin && basePin.category === 'Crack' && basePin.type === 'Interior' && mainPin && mainPin.type === 'Exterior');

  const photoIndex = JSON.parse(zip.text['photos/index.json']);
  const byRole = {};
  photoIndex.photos.forEach(function (photo) {
    byRole[photo.role] = byRole[photo.role] || [];
    byRole[photo.role].push(photo);
  });
  const linked = (byRole['pin-linked'] || []).filter(function (photo) { return photo.stored; });
  assert('pin photos keep their pin', linked.length === 2 && linked.some(function (photo) {
    return photo.pinId === 'pin-base' && photo.photoId === 'ph_import-11111111-1111-1111-1111-111111111111' && photo.path.indexOf('photo-01') !== -1;
  }) && linked.some(function (photo) { return photo.pinId === 'pin-main' && photo.path.indexOf('photo-02') !== -1; }));
  assert('missing photo is a gap, not a failed export', inventory.components.photos.missingBytes === 1 && blob.indexOf('ph_missing') !== -1);
  assert('quick capture is separate from pins', (byRole['quick-capture'] || []).length === 1 && (byRole['quick-capture'][0].path || '').indexOf('photos/quick-capture/') === 0 && (byRole['quick-capture'][0].pinId == null));
  assert('unassigned photos are separate', (byRole.unassigned || []).some(function (photo) { return photo.stored && photo.path.indexOf('photos/unassigned/') === 0; }));
  assert('general photos are separate', (byRole.general || []).some(function (photo) { return photo.stored && photo.subject === 'Exterior overview'; }));
  assert('plan images are stored and the missing plan is named', inventory.components.plans.imagesStored === 2 && inventory.components.plans.imagesMissing === 1 && zip.names.indexOf('plans/images/canvas-basement.png') !== -1);
  assert('diagnostics and report state are included', inventory.components.diagnostics.status === 'present' && inventory.components.reportBuilder.status === 'present' && blob.indexOf('Stored tilt note') !== -1 && blob.indexOf('Draft discussion') !== -1);
  assert('diagnostic plot bytes are a file, not base64 in JSON', (zip.text['diagnostics/diagnostics.json'] || '').indexOf('iVBORw0KGgo') === -1 && zip.names.some(function (name) { return name.indexOf('diagnostics/images/') === 0; }));
  assert('recovery provenance is included and quick capture limit is stated', blob.indexOf('sample-distress.zip') !== -1 && blob.indexOf('Legacy Distress recovery does not store Quick Capture') !== -1);
  assert('left-out recovery observations are listed and not invented as pins',
    inventory.components.provenance.excludedObservationCount === 1 &&
    blob.indexOf('Observation 9 — Unplaced crack') !== -1 &&
    blob.indexOf('does not invent pins or photos') !== -1 &&
    survey.pins.every(function (pin) { return pin.description !== 'Unplaced crack' && pin.id !== 'src-left-out'; }));
  const provenance = JSON.parse(zip.text['provenance/recovery-imports.json']);
  const recoveryEntry = provenance[0] || {};
  assert('import identity stays provenance and is not applied as survey data',
    recoveryEntry.pinIds && recoveryEntry.pinIds[0] === 'pin-base' &&
    recoveryEntry.photoIds && recoveryEntry.photoIds[0] === 'ph_import-11111111-1111-1111-1111-111111111111' &&
    recoveryEntry.planMediaIds && recoveryEntry.planMediaIds[0] === 'plan-basement' &&
    recoveryEntry.floorMetadataBefore && recoveryEntry.floorMetadataBefore.surveyNotes === 'before-import-note' &&
    inventory.components.floorSurvey.epochCount === 2 &&
    epoch2024.indexOf('removed-reading-should-not-export') === -1 &&
    epoch2026Base.indexOf('removed-reading-should-not-export') === -1 &&
    epoch2026Main.indexOf('removed-reading-should-not-export') === -1 &&
    survey.pins.every(function (pin) { return pin.id !== 'pin-import-ghost'; }));

  const floorOnly = {
    id: 'cf-floor-only',
    firstName: 'Mara',
    lastName: 'Ellison',
    propertyAddress: '18 Cedar Court',
    planSetup: { canvases: canvases().slice(0, 2) },
    floorSurvey: {
      id: 'floor-live',
      schemaVersion: 1,
      inspectionDate: '2026-05-01',
      surveyNotes: 'Spring visit',
      byCanvasId: {
        'canvas-basement': { canvasId: 'canvas-basement', points: [{ id: 'live-base', index: 1, x: 1, y: 1, value: 4.5 }] },
        'canvas-main': { canvasId: 'canvas-main', points: [{ id: 'live-main', index: 1, x: 2, y: 2, value: 5.5 }] },
      },
    },
  };
  const floorBuilt = await window.ToolboxAiExport.buildPackage(floorOnly, deps);
  const floorZip = await readZip(floorBuilt.zip);
  const floorInv = JSON.parse(floorZip.text['inventory.json']);
  const liveBase = floorZip.text['floor-survey/epochs/floor-live/levels/canvas-basement/readings.csv'] || '';
  const liveMain = floorZip.text['floor-survey/epochs/floor-live/levels/canvas-main/readings.csv'] || '';
  assert('distress can be absent while floor export succeeds', floorInv.components.distress.status === 'absent' && floorInv.components.floorSurvey.status === 'present');
  assert('live levels are not flattened', floorInv.components.floorSurvey.epochCount === 1 && floorInv.components.floorSurvey.levelCount === 2 && liveBase.indexOf('live-base') !== -1 && liveBase.indexOf('live-main') === -1 && liveMain.indexOf('live-main') !== -1 && liveMain.indexOf('2026-05-01') !== -1);

  const distressOnly = {
    id: 'cf-distress-only',
    firstName: 'Mara',
    lastName: 'Ellison',
    propertyAddress: '18 Cedar Court',
    planSetup: { canvases: canvases().slice(0, 1) },
    distress: {
      pins: [{ id: 'pin-only', canvasId: 'canvas-basement', x: 5, y: 5, photos: [], description: 'Only distress', location: 'Hall', isExterior: false }],
    },
  };
  const distressBuilt = await window.ToolboxAiExport.buildPackage(distressOnly, deps);
  const distressInv = distressBuilt.inventory;
  assert('floor can be absent while distress export succeeds', distressInv.components.floorSurvey.status === 'absent' && distressInv.components.distress.status === 'present' && distressInv.components.distress.pinCount === 1);

  const empty = {
    id: 'cf-empty',
    firstName: 'Nia',
    lastName: 'Cole',
    propertyAddress: '2 Blank Street',
    planSetup: { canvases: [{ id: 'c1', name: 'Floor Plan', rooms: [] }] },
  };
  const emptyBuilt = await window.ToolboxAiExport.buildPackage(empty, deps);
  assert('both surveys absent still exports', emptyBuilt.inventory.components.floorSurvey.status === 'absent' && emptyBuilt.inventory.components.distress.status === 'absent' && emptyBuilt.inventory.components.diagnostics.status === 'absent' && emptyBuilt.inventory.components.reportBuilder.status === 'absent');
  assert('empty inventory names the absence', emptyBuilt.inventoryText.indexOf('No Floor Survey is stored') !== -1 && emptyBuilt.inventoryText.indexOf('No Distress Survey is stored') !== -1);

  return out;
}, PNG);

report.forEach(function (item) { check(item.name, item.ok, item.detail); });

await page.setViewport({ width: 1280, height: 800 });
await page.evaluate(async () => {
  const db = window.ToolboxDB;
  const app = window.ToolboxApp;
  const ps = window.ToolboxPlanSetup;
  const ui = app.blankCustomerFile('cf-ai-ui');
  ps.ensurePlanSetup(ui);
  ui.firstName = 'Mara';
  ui.lastName = 'Ellison';
  ui.propertyAddress = '18 Cedar Court';
  const canvasId = ui.planSetup.activeCanvasId;
  ui.floorSurvey.inspectionDate = '2026-05-01';
  ui.floorSurvey.byCanvasId[canvasId] = {
    canvasId: canvasId,
    points: [{ id: 'ui-point', index: 1, x: 4, y: 5, value: 3.25 }],
  };
  await db.saveCustomerFile(ui);
  const other = app.blankCustomerFile('cf-other-ui');
  ps.ensurePlanSetup(other);
  other.firstName = 'Other';
  other.lastName = 'Household';
  other.propertyAddress = '500 Separate Road';
  await db.saveCustomerFile(other);
  window.__aiDownloads = [];
  const orig = URL.createObjectURL;
  URL.createObjectURL = function (blob) {
    window.__aiDownloads.push(blob);
    return orig.call(URL, blob);
  };
});

async function layout(width, height, shot) {
  await page.setViewport({ width: width, height: height });
  await page.evaluate(function () { window.location.hash = '#/file/cf-ai-ui/report'; });
  await page.waitForSelector('#rb-export-ai');
  await page.waitForFunction(function () {
    const label = document.querySelector('#rb-file-label');
    return label && label.textContent.indexOf('Ellison') !== -1;
  });
  await new Promise(function (resolve) { setTimeout(resolve, 250); });
  const box = await page.evaluate(function () {
    function rect(selector) {
      const node = document.querySelector(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { top: box.top, left: box.left, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    }
    function overlaps(a, b) {
      if (!a || !b || a.width < 1 || b.width < 1) return false;
      return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    }
    const button = rect('#rb-export-ai');
    const sheet = rect('.rb-sheet');
    const bar = rect('.app-bar');
    const identity = rect('.file-identity__name');
    return {
      button: button,
      overlapsSheet: overlaps(button, sheet),
      overlapsBar: overlaps(button, bar),
      overlapsIdentity: overlaps(button, identity),
      label: document.querySelector('#rb-export-ai').textContent,
    };
  });
  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: OUT + '/' + shot + '.png', fullPage: false });
  check(shot + ' shows Export for AI', box.label === 'Export for AI' && box.button && box.button.width > 40 && box.button.height > 20, JSON.stringify(box.button));
  check(shot + ' does not cover the sheet, bar, or name', !box.overlapsSheet && !box.overlapsBar && !box.overlapsIdentity, JSON.stringify({
    sheet: box.overlapsSheet,
    bar: box.overlapsBar,
    identity: box.overlapsIdentity,
  }));
}

await layout(1280, 800, 'ai-export-desktop');
await layout(834, 1112, 'ai-export-ipad');
await layout(390, 844, 'ai-export-phone');

let savedDuringClick = 0;
await page.exposeFunction('__aiSaveSpy', function () { savedDuringClick += 1; });
await page.evaluate(function () {
  const orig = window.ToolboxDB.saveCustomerFile;
  window.ToolboxDB.saveCustomerFile = function () {
    window.__aiSaveSpy();
    return orig.apply(window.ToolboxDB, arguments);
  };
});
await page.click('#rb-export-ai');
await page.waitForFunction(function () {
  const status = document.querySelector('#rb-ai-status');
  return status && status.textContent.indexOf('Downloaded') === 0;
});
const download = await page.evaluate(async function () {
  const blob = window.__aiDownloads[window.__aiDownloads.length - 1];
  if (!blob) return { ok: false, detail: 'no download' };
  const zip = await window.JSZip.loadAsync(await blob.arrayBuffer());
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  const inventory = await zip.file('INVENTORY.txt').async('string');
  let foreign = false;
  const jobs = [];
  zip.forEach(function (path, entry) {
    if (!/\.(json|txt|csv)$/i.test(path)) return;
    jobs.push(entry.async('string').then(function (text) {
      if (text.indexOf('500 Separate Road') !== -1 || text.indexOf('Other Household') !== -1) foreign = true;
    }));
  });
  await Promise.all(jobs);
  return {
    ok: true,
    id: manifest.customerFileId,
    name: manifest.customerName,
    floor: manifest.sourceInventory.floorSurvey.status,
    distress: manifest.sourceInventory.distress.status,
    foreign: foreign,
    inventory: inventory.indexOf('18 Cedar Court') !== -1,
  };
});
check('click downloads one ZIP for the open Customer File', download.ok && download.id === 'cf-ai-ui' && download.name === 'Mara Ellison' && download.floor === 'present' && download.distress === 'absent' && download.inventory && !download.foreign, JSON.stringify(download));
check('click does not save the Customer File', savedDuringClick === 0, 'saves=' + savedDuringClick);

const statusBox = await page.evaluate(function () {
  function rect(selector) {
    const node = document.querySelector(selector);
    const box = node.getBoundingClientRect();
    return { top: box.top, left: box.left, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
  }
  function overlaps(a, b) {
    return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  }
  return {
    overlaps: overlaps(rect('#rb-ai-status'), rect('.rb-sheet')),
    status: document.querySelector('#rb-ai-status').textContent,
  };
});
check('export status stays off the sheet', !statusBox.overlaps, statusBox.status);
await page.screenshot({ path: OUT + '/ai-export-phone-downloaded.png' });

await writeFile('/opt/cursor/artifacts/ai-export-results.json', JSON.stringify({ ok: results.every(function (item) { return item.ok; }), results: results }, null, 2));
await browser.close();

const failed = results.filter(function (item) { return !item.ok; });
if (failed.length) {
  console.log('FAILED ' + failed.length + ' of ' + results.length);
  process.exit(1);
}
console.log('All ' + results.length + ' checks passed.');
