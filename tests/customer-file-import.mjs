/**
 * Customer File permanent standalone-recovery importer.
 * Run: node tests/customer-file-import.mjs
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
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('toolbox', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['customerFiles', 'media'], 'readwrite');
    tx.objectStore('customerFiles').clear();
    tx.objectStore('media').clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase('pgg_photos_v1');
    request.onsuccess = resolve;
    request.onerror = resolve;
    request.onblocked = resolve;
  });
});

const fixtures = await page.evaluate(async () => {
  function planDataUrl(width = 100, height = 80) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f8f1df';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = '#082036';
    context.lineWidth = 3;
    context.strokeRect(5, 5, width - 10, height - 10);
    return canvas.toDataURL('image/png');
  }

  async function distressFile({ missingPhoto = false } = {}) {
    const zip = new JSZip();
    const root = zip.folder('50 Steeplechase Court');
    const plan = planDataUrl(100, 80);
    root.file('plan.png', plan.split(',')[1], { base64: true });
    root.file('pins.json', JSON.stringify([
      {
        id: 'legacy-1',
        num: 1,
        type: 'Interior',
        description: 'Crack at window',
        room: 'Living Room',
        direction: 'NE',
        x: '0.25000',
        y: '0.50000',
        photos: ['photo-01.jpg', 'photo-02.jpg'],
      },
      {
        id: 'legacy-2',
        num: 3,
        type: 'Exterior',
        description: 'Brick separation',
        room: '',
        direction: 'S',
        x: '0.75000',
        y: '0.62500',
        photos: [],
      },
    ]));
    root.folder('photos').file('photo-01.jpg', 'photo-one');
    if (!missingPhoto) root.folder('photos').file('photo-02.jpg', 'photo-two');
    root.file('map.png', 'derivative');
    root.file('pinlog.pdf', 'derivative');
    root.file('pins.csv', 'derivative');
    root.folder('quick-capture').file('quick-01.jpg', 'quick-one');
    root.folder('quick-capture').file('quick-02.jpg', 'quick-two');
    root.folder('quick-capture').file(
      'quick-capture.csv',
      'File,Timestamp,Latitude,Longitude\nquick-01.jpg,2026-07-28T10:00:00Z,35.1,-106.2\nquick-02.jpg,2026-07-28T10:01:00Z,,',
    );
    return new File([await zip.generateAsync({ type: 'blob' })], missingPhoto ? 'missing.zip' : 'distress.zip', { type: 'application/zip' });
  }

  async function legacyOutOfRangeYFile() {
    const zip = new JSZip();
    const root = zip.folder('Legacy Distress');
    const plan = planDataUrl(100, 80);
    root.file('plan.png', plan.split(',')[1], { base64: true });
    // Same strings the standalone exporter writes: unclamped plan fractions.
    // x stays inside [0, 1], so the old checker failed on y only.
    root.file('pins.json', JSON.stringify([
      {
        id: 'legacy-below',
        num: 1,
        type: 'Exterior',
        description: 'Downspout at grade',
        room: '',
        direction: 'S',
        x: '0.25000',
        y: '1.12500',
        photos: [],
      },
      {
        id: 'legacy-above',
        num: 2,
        type: 'Exterior',
        description: 'Fascia stain',
        room: '',
        direction: 'N',
        x: '0.50000',
        y: '-0.12500',
        photos: [],
      },
    ]));
    return new File([await zip.generateAsync({ type: 'blob' })], 'legacy-out-of-range-y.zip', { type: 'application/zip' });
  }

  async function nonNumericYFile() {
    const zip = new JSZip();
    const root = zip.folder('Legacy Distress');
    const plan = planDataUrl(100, 80);
    root.file('plan.png', plan.split(',')[1], { base64: true });
    root.file('pins.json', JSON.stringify([
      {
        id: 'legacy-bad-y',
        num: 1,
        type: 'Interior',
        description: 'Unreadable',
        room: '',
        direction: '',
        x: '0.25000',
        y: 'not-a-coordinate',
        photos: [],
      },
    ]));
    return new File([await zip.generateAsync({ type: 'blob' })], 'legacy-bad-y.zip', { type: 'application/zip' });
  }

  async function partialDistressFile() {
    const zip = new JSZip();
    const root = zip.folder('Sample Court');
    const plan = planDataUrl(100, 80);
    root.file('plan.png', plan.split(',')[1], { base64: true });
    root.folder('photos').file('photo-01.jpg', 'photo-one');
    root.file('pins.json', JSON.stringify([
      {
        id: 'keep-1',
        num: 1,
        type: 'Interior',
        description: 'Crack at window',
        room: 'Living Room',
        direction: 'NE',
        x: '0.25000',
        y: '0.50000',
        photos: ['photo-01.jpg'],
      },
      {
        id: 'bad-y',
        num: 2,
        type: 'Exterior',
        description: 'Unreadable pin',
        room: '',
        direction: '',
        x: '0.40000',
        y: 'not-a-coordinate',
        photos: [],
      },
      {
        id: 'keep-3',
        num: 3,
        type: 'Exterior',
        description: 'Stucco crack',
        room: '',
        direction: 'S',
        x: '0.50000',
        y: '0.25000',
        photos: [],
      },
    ]));
    return new File([await zip.generateAsync({ type: 'blob' })], 'partial-distress.zip', { type: 'application/zip' });
  }

  function floorFile(version = 1, overrides = {}) {
    const planWidth = overrides.planWidth != null ? overrides.planWidth : 120;
    const planHeight = overrides.planHeight != null ? overrides.planHeight : 90;
    const imageWidth = overrides.imageWidth != null ? overrides.imageWidth : 120;
    const imageHeight = overrides.imageHeight != null ? overrides.imageHeight : 90;
    const plan = planDataUrl(imageWidth, imageHeight);
    const client = Object.prototype.hasOwnProperty.call(overrides, 'client') ? overrides.client : 'Fred Keulen';
    const bundle = {
      kind: 'floor-survey-bundle',
      bundleVersion: version,
      exportedAt: Date.now(),
      project: {
        id: 'project-old',
        name: 'Keulen',
        address: '44 El Cielo Azul Circle, Edgewood, NM',
        client,
        inspector: 'Tim',
        inspectionDate: '2026-07-28',
        notes: 'Field notes',
        customSurfaces: ['Saltillo'],
        createdAt: 1,
        updatedAt: 2,
      },
      floors: [{
        id: 'floor-old',
        projectId: 'project-old',
        name: '1st Floor',
        order: 0,
        planDataUrl: plan,
        planWidth,
        planHeight,
        boundary: [{ x: 5, y: 5 }, { x: 115, y: 5 }, { x: 115, y: 85 }, { x: 5, y: 85 }],
        areas: [{ id: 'area-old', name: 'Area 1', polygon: [{ x: 5, y: 5 }, { x: 115, y: 5 }, { x: 115, y: 85 }], createdAt: 1 }],
        scale: { a: { x: 10, y: 10 }, b: { x: 30, y: 10 }, lengthInches: 240 },
        notes: [{ id: 'note-old', x: 40, y: 30, text: 'Hallway' }],
        transitions: [{
          id: 'transition-old',
          x: 50,
          y: 40,
          surfaceA: 'Tile',
          surfaceB: 'Wood',
          readingA: 9.1,
          readingB: 9.3,
          createdAt: 1,
        }],
        transitionGroupAverages: { 'Tile→Wood': -0.2 },
        exclusions: [{ id: 'exclude-old', label: 'Garage', polygon: [{ x: 90, y: 60 }, { x: 110, y: 60 }, { x: 110, y: 80 }], createdAt: 1 }],
        bp1Gps: { latitude: 35.1, longitude: -106.2, accuracyMeters: 5, capturedAt: 10 },
        createdAt: 1,
        updatedAt: 2,
      }],
      points: [
        { id: 'point-bp1', floorId: 'floor-old', index: 1, x: 20, y: 20, value: 9.1, isBasePoint: true, label: 'BP1', createdAt: 1 },
        { id: 'point-2', floorId: 'floor-old', index: 2, x: 60, y: 45, value: 9.3, transitionId: 'transition-old', createdAt: 2 },
      ],
    };
    return new File([JSON.stringify(bundle)], 'keulen.floorsurvey.json', { type: 'application/json' });
  }

  window.__importFixtures = { distressFile, floorFile, legacyOutOfRangeYFile, nonNumericYFile, partialDistressFile };
  const previewFile = await distressFile();
  const previewBytes = new Uint8Array(await previewFile.arrayBuffer());
  let previewBinary = '';
  previewBytes.forEach((byte) => { previewBinary += String.fromCharCode(byte); });
  return {
    jszip: typeof JSZip,
    importer: typeof ToolboxCustomerFileImport,
    previewZipBase64: btoa(previewBinary),
  };
});
check('Importer and local ZIP parser load', fixtures.jszip === 'function' && fixtures.importer === 'object', JSON.stringify(fixtures));

const distressInspection = await page.evaluate(async () => {
  const file = await window.__importFixtures.distressFile();
  const parsed = await ToolboxCustomerFileImport.inspectFile(file);
  window.__distressParsed = parsed;
  return {
    kind: parsed.kind,
    plan: [parsed.planWidth, parsed.planHeight],
    pins: parsed.pins.length,
    photos: parsed.attachedPhotoCount,
    quick: parsed.quickCapture,
    derivatives: parsed.ignoredDerivativeCount,
    first: parsed.pins[0],
    second: parsed.pins[1],
    excluded: parsed.excludedObservations.length,
  };
});
check('Valid Distress ZIP recognized', distressInspection.kind === 'distress', JSON.stringify(distressInspection));
check('Distress plan and normalized coordinates recovered', distressInspection.plan[0] === 100 && distressInspection.plan[1] === 80 && distressInspection.first.xNormalized === 0.25 && distressInspection.first.yNormalized === 0.5, JSON.stringify(distressInspection));
check('Distress observations and relationships recovered', distressInspection.pins === 2 && distressInspection.photos === 2 && distressInspection.first.photos.length === 2 && distressInspection.second.photos.length === 0, JSON.stringify(distressInspection));
check('Quick Capture inventoried but isolated', distressInspection.quick.count === 2 && distressInspection.quick.metadataCount === 2, JSON.stringify(distressInspection.quick));
check('Derivative outputs ignored as survey data', distressInspection.derivatives === 3, JSON.stringify(distressInspection));
check('Legacy direction and observation fields retained', distressInspection.first.importedLegacyDirection === 'NE' && distressInspection.first.description === 'Crack at window' && distressInspection.first.location === 'Living Room', JSON.stringify(distressInspection.first));
check('Valid Distress import leaves nothing out', distressInspection.excluded === 0, JSON.stringify(distressInspection.excluded));

const invalidDistress = await page.evaluate(async () => {
  const empty = new JSZip();
  const file = new File([await empty.generateAsync({ type: 'blob' })], 'invalid.zip');
  try {
    await ToolboxCustomerFileImport.inspectFile(file);
    return '';
  } catch (error) {
    return error.message;
  }
});
check('Invalid Distress ZIP rejected safely', /pins\.json/.test(invalidDistress), invalidDistress);

const missingPhoto = await page.evaluate(async () => {
  const file = await window.__importFixtures.distressFile({ missingPhoto: true });
  const parsed = await ToolboxCustomerFileImport.inspectFile(file);
  return {
    pins: parsed.pins.map((pin) => [pin.num, pin.description, pin.xNormalized, pin.yNormalized]),
    excluded: parsed.excludedObservations.map((item) => [item.num, item.heading, item.reason]),
  };
});
check(
  'Missing Distress photo leaves that observation out and keeps the valid one',
  missingPhoto.pins.length === 1 &&
    missingPhoto.pins[0][0] === 3 &&
    missingPhoto.pins[0][1] === 'Brick separation' &&
    missingPhoto.pins[0][2] === 0.75 &&
    missingPhoto.pins[0][3] === 0.625 &&
    missingPhoto.excluded.length === 1 &&
    missingPhoto.excluded[0][0] === 1 &&
    missingPhoto.excluded[0][1] === 'Observation 1 — Crack at window' &&
    /photo-02\.jpg/.test(missingPhoto.excluded[0][2]),
  JSON.stringify(missingPhoto),
);

const legacyOutOfRange = await page.evaluate(async () => {
  const file = await window.__importFixtures.legacyOutOfRangeYFile();
  const parsed = await ToolboxCustomerFileImport.inspectFile(file);
  const context = await ToolboxCustomerFileImport.getImportContext(parsed, 'import-distress-y');
  await ToolboxCustomerFileImport.applyImport(parsed, 'import-distress-y', {
    targetUpdatedAt: context.targetUpdatedAt,
    canvasChoice: 'new',
    fieldChoices: {},
    useSuggestedAddress: false,
  });
  const record = await ToolboxDB.getCustomerFile('import-distress-y');
  return {
    kind: parsed.kind,
    normalized: parsed.pins.map((pin) => [pin.xNormalized, pin.yNormalized, pin.description]),
    pixels: record.distress.pins.map((pin) => [pin.x, pin.y, pin.num, pin.description]),
    numbering: [record.distress.startNum, record.distress.nextNum],
    excluded: parsed.excludedObservations.length,
  };
});
check(
  'Legacy pin below the plan keeps its y fraction',
  legacyOutOfRange.kind === 'distress' &&
    legacyOutOfRange.normalized[0][0] === 0.25 &&
    legacyOutOfRange.normalized[0][1] === 1.125 &&
    legacyOutOfRange.pixels[0][0] === 25 &&
    legacyOutOfRange.pixels[0][1] === 90 &&
    legacyOutOfRange.pixels[0][3] === 'Downspout at grade' &&
    legacyOutOfRange.excluded === 0,
  JSON.stringify(legacyOutOfRange),
);
check(
  'Legacy pin above the plan keeps its negative y',
  legacyOutOfRange.normalized[1][1] === -0.125 &&
    legacyOutOfRange.pixels[1][0] === 50 &&
    legacyOutOfRange.pixels[1][1] === -10 &&
    legacyOutOfRange.pixels[1][2] === 2 &&
    legacyOutOfRange.numbering[0] === 1 &&
    legacyOutOfRange.numbering[1] === 3,
  JSON.stringify(legacyOutOfRange),
);

const nonNumericY = await page.evaluate(async () => {
  const file = await window.__importFixtures.nonNumericYFile();
  const parsed = await ToolboxCustomerFileImport.inspectFile(file);
  let writeError = '';
  try {
    await ToolboxCustomerFileImport.applyImport(parsed, 'import-bad-y-only', {
      targetUpdatedAt: null,
      canvasChoice: 'new',
      fieldChoices: {},
      acknowledgeExcludedObservations: true,
    });
  } catch (error) {
    writeError = error.message;
  }
  return {
    pins: parsed.pins.length,
    heading: parsed.excludedObservations[0] && parsed.excludedObservations[0].heading,
    reason: parsed.excludedObservations[0] && parsed.excludedObservations[0].reason,
    writeError,
    record: !!(await ToolboxDB.getCustomerFile('import-bad-y-only')),
  };
});
check(
  'Non-numeric Distress y is left out and not written',
  nonNumericY.pins === 0 &&
    nonNumericY.heading === 'Observation 1 — Unreadable' &&
    nonNumericY.reason === 'A Distress observation has an invalid y coordinate.' &&
    /cannot be imported/.test(nonNumericY.writeError) &&
    nonNumericY.record === false,
  JSON.stringify(nonNumericY),
);

const partialDistress = await page.evaluate(async () => {
  const file = await window.__importFixtures.partialDistressFile();
  const parsed = await ToolboxCustomerFileImport.inspectFile(file);
  const context = await ToolboxCustomerFileImport.getImportContext(parsed, 'import-partial-distress');
  let silentError = '';
  try {
    await ToolboxCustomerFileImport.applyImport(parsed, 'import-partial-distress', {
      targetUpdatedAt: context.targetUpdatedAt,
      canvasChoice: 'new',
      fieldChoices: {},
      useSuggestedAddress: false,
    });
  } catch (error) {
    silentError = error.message;
  }
  const before = await ToolboxDB.getCustomerFile('import-partial-distress');
  await ToolboxCustomerFileImport.applyImport(parsed, 'import-partial-distress', {
    targetUpdatedAt: context.targetUpdatedAt,
    canvasChoice: 'new',
    fieldChoices: {},
    useSuggestedAddress: false,
    acknowledgeExcludedObservations: true,
  });
  const record = await ToolboxDB.getCustomerFile('import-partial-distress');
  return {
    silentError,
    writtenBeforeAck: !!before,
    kept: parsed.pins.map((pin) => [pin.num, pin.description, pin.xNormalized, pin.yNormalized, pin.photos.length]),
    excluded: parsed.excludedObservations.map((item) => [item.num, item.heading, item.reason, item.sourceId]),
    saved: record.distress.pins.map((pin) => [pin.num, pin.description, pin.x, pin.y]),
    numbering: [record.distress.startNum, record.distress.nextNum],
    history: record.recoveryImports[0].excludedObservations,
    photoCount: record.distress.pins.reduce((total, pin) => total + pin.photos.length, 0),
  };
});
check(
  'Malformed Distress pin does not block the valid observations',
  partialDistress.kept.length === 2 &&
    partialDistress.kept[0][0] === 1 &&
    partialDistress.kept[0][1] === 'Crack at window' &&
    partialDistress.kept[0][2] === 0.25 &&
    partialDistress.kept[0][3] === 0.5 &&
    partialDistress.kept[0][4] === 1 &&
    partialDistress.kept[1][0] === 3 &&
    partialDistress.kept[1][1] === 'Stucco crack' &&
    partialDistress.kept[1][2] === 0.5 &&
    partialDistress.kept[1][3] === 0.25 &&
    partialDistress.saved.length === 2 &&
    partialDistress.saved[0][2] === 25 &&
    partialDistress.saved[0][3] === 40 &&
    partialDistress.saved[1][2] === 50 &&
    partialDistress.saved[1][3] === 20 &&
    partialDistress.numbering[0] === 1 &&
    partialDistress.numbering[1] === 4 &&
    partialDistress.photoCount === 1,
  JSON.stringify(partialDistress),
);
check(
  'Malformed Distress pin is explicit and is not fabricated',
  /Review the observations/.test(partialDistress.silentError) &&
    partialDistress.writtenBeforeAck === false &&
    partialDistress.excluded.length === 1 &&
    partialDistress.excluded[0][0] === 2 &&
    partialDistress.excluded[0][1] === 'Observation 2 — Unreadable pin' &&
    partialDistress.excluded[0][2] === 'A Distress observation has an invalid y coordinate.' &&
    partialDistress.excluded[0][3] === 'bad-y' &&
    partialDistress.saved.every((pin) => pin[1] !== 'Unreadable pin') &&
    partialDistress.history.length === 1 &&
    partialDistress.history[0].heading === 'Observation 2 — Unreadable pin' &&
    partialDistress.history[0].reason === 'A Distress observation has an invalid y coordinate.',
  JSON.stringify(partialDistress),
);

const distressApplied = await page.evaluate(async () => {
  const context = await ToolboxCustomerFileImport.getImportContext(window.__distressParsed, 'import-distress');
  const result = await ToolboxCustomerFileImport.applyImport(window.__distressParsed, 'import-distress', {
    targetUpdatedAt: context.targetUpdatedAt,
    canvasChoice: 'new',
    fieldChoices: {},
    useSuggestedAddress: false,
  });
  const record = await ToolboxDB.getCustomerFile('import-distress');
  const canvas = record.planSetup.canvases[0];
  const plan = await ToolboxDB.getMedia(canvas.plan.id);
  const photoDb = await new Promise((resolve, reject) => {
    const request = indexedDB.open('pgg_photos_v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  const photoValues = await Promise.all(record.distress.pins[0].photos.map((id) => new Promise((resolve, reject) => {
    const tx = photoDb.transaction('photos', 'readonly');
    const request = tx.objectStore('photos').get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  })));
  photoDb.close();
  return {
    result,
    canvas: { name: canvas.name, width: canvas.plan.width, height: canvas.plan.height, facing: canvas.frontDoorFacing },
    planStored: /^data:image\/png/.test(plan || ''),
    pins: record.distress.pins,
    numbering: [record.distress.startNum, record.distress.nextNum],
    photoValues,
    quickPersisted: Object.prototype.hasOwnProperty.call(record.distress, 'quickCapture'),
    history: record.recoveryImports,
  };
});
check('Distress import creates native Customer File canvas and plan media', distressApplied.planStored && distressApplied.canvas.width === 100 && distressApplied.canvas.height === 80 && distressApplied.canvas.facing === '', JSON.stringify(distressApplied.canvas));
check('Distress import denormalizes native pixel positions', distressApplied.pins[0].x === 25 && distressApplied.pins[0].y === 40 && distressApplied.pins[1].x === 75 && distressApplied.pins[1].y === 50, JSON.stringify(distressApplied.pins));
check('Distress numbering preserves multi/zero-photo semantics', distressApplied.numbering[0] === 1 && distressApplied.numbering[1] === 4 && distressApplied.pins[0].num === 1 && distressApplied.pins[1].num === 3, JSON.stringify(distressApplied.numbering));
check('Distress photo bytes staged and attached', distressApplied.photoValues.length === 2 && distressApplied.photoValues.every(Boolean), JSON.stringify(distressApplied.photoValues));
check('Quick Capture is not falsely persisted', distressApplied.result.quickCaptureCount === 2 && !distressApplied.quickPersisted, JSON.stringify(distressApplied.result));
check('Import fingerprint recorded without legacy payload', distressApplied.history.length === 1 && distressApplied.history[0].fingerprint, JSON.stringify(distressApplied.history));

const duplicateResult = await page.evaluate(async () => {
  const context = await ToolboxCustomerFileImport.getImportContext(window.__distressParsed, 'import-distress');
  try {
    await ToolboxCustomerFileImport.applyImport(window.__distressParsed, 'import-distress', {
      targetUpdatedAt: context.targetUpdatedAt,
      canvasChoice: 'add',
      fieldChoices: {},
    });
    return { error: '', pins: -1 };
  } catch (error) {
    return { error: error.message, pins: (await ToolboxDB.getCustomerFile('import-distress')).distress.pins.length };
  }
});
check('Repeated package cannot duplicate recovered survey', /already been imported/.test(duplicateResult.error) && duplicateResult.pins === 2, JSON.stringify(duplicateResult));

const existingDistressBlock = await page.evaluate(async () => {
  const existing = ToolboxApp.blankCustomerFile('import-distress-existing');
  ToolboxPlanSetup.ensurePlanSetup(existing);
  existing.distress.pins.push({
    id: 'existing-pin',
    num: 1,
    x: 10,
    y: 10,
    photos: [],
    canvasId: existing.planSetup.activeCanvasId,
  });
  await ToolboxDB.saveCustomerFile(existing);
  const context = await ToolboxCustomerFileImport.getImportContext(window.__distressParsed, existing.id);
  let error = '';
  try {
    await ToolboxCustomerFileImport.applyImport(window.__distressParsed, existing.id, {
      targetUpdatedAt: context.targetUpdatedAt,
      canvasChoice: 'add',
      fieldChoices: {},
    });
  } catch (caught) {
    error = caught.message;
  }
  const saved = await ToolboxDB.getCustomerFile(existing.id);
  return { blocked: context.blocksDistressMerge, error, pinIds: saved.distress.pins.map((pin) => pin.id) };
});
check('Existing Distress work is preserved instead of silently merged', existingDistressBlock.blocked && /already has Distress work/.test(existingDistressBlock.error) && existingDistressBlock.pinIds.join(',') === 'existing-pin', JSON.stringify(existingDistressBlock));

const rollbackResult = await page.evaluate(async () => {
  async function photoCount() {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pgg_photos_v1', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const count = await new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readonly');
      const request = tx.objectStore('photos').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return count;
  }
  const before = await photoCount();
  const original = ToolboxDB.importCustomerFileRecovery;
  ToolboxDB.importCustomerFileRecovery = () => Promise.reject(new Error('forced transaction failure'));
  let error = '';
  try {
    await ToolboxCustomerFileImport.applyImport(window.__distressParsed, 'import-rollback', {
      targetUpdatedAt: null,
      canvasChoice: 'new',
      fieldChoices: {},
    });
  } catch (caught) {
    error = caught.message;
  } finally {
    ToolboxDB.importCustomerFileRecovery = original;
  }
  return {
    error,
    record: await ToolboxDB.getCustomerFile('import-rollback'),
    before,
    after: await photoCount(),
  };
});
check('Failed transaction leaves no believable partial survey', /forced/.test(rollbackResult.error) && !rollbackResult.record && rollbackResult.before === rollbackResult.after, JSON.stringify(rollbackResult));

const existingRollback = await page.evaluate(async () => {
  const existing = ToolboxApp.blankCustomerFile('import-existing-rollback');
  ToolboxPlanSetup.ensurePlanSetup(existing);
  existing.firstName = 'Keep';
  existing.lastName = 'Me';
  existing.propertyAddress = 'Safe Address';
  const originalCanvasId = existing.planSetup.canvases[0].id;
  await ToolboxDB.saveCustomerFile(existing);
  const context = await ToolboxCustomerFileImport.getImportContext(window.__distressParsed, existing.id);
  const original = ToolboxDB.importCustomerFileRecovery;
  ToolboxDB.importCustomerFileRecovery = () => Promise.reject(new Error('forced existing failure'));
  let error = '';
  try {
    await ToolboxCustomerFileImport.applyImport(window.__distressParsed, existing.id, {
      targetUpdatedAt: context.targetUpdatedAt,
      canvasChoice: 'add',
      fieldChoices: {},
    });
  } catch (caught) {
    error = caught.message;
  } finally {
    ToolboxDB.importCustomerFileRecovery = original;
  }
  const saved = await ToolboxDB.getCustomerFile(existing.id);
  return {
    error,
    identity: [saved.firstName, saved.lastName, saved.propertyAddress],
    canvases: saved.planSetup.canvases.map((canvas) => canvas.id),
    originalCanvasId,
    pins: saved.distress.pins.length,
    imports: saved.recoveryImports?.length || 0,
  };
});
check('Failed import leaves previous Customer File state intact', /forced existing failure/.test(existingRollback.error) && existingRollback.identity.join('|') === 'Keep|Me|Safe Address' && existingRollback.canvases.join(',') === existingRollback.originalCanvasId && existingRollback.pins === 0 && existingRollback.imports === 0, JSON.stringify(existingRollback));

const atomicGuard = await page.evaluate(async () => {
  const record = ToolboxApp.blankCustomerFile('import-atomic-guard');
  ToolboxPlanSetup.ensurePlanSetup(record);
  record.updatedAt = '2026-01-01T00:00:00.000Z';
  await ToolboxDB.saveCustomerFile(record);
  const stale = structuredClone(record);
  const newer = structuredClone(record);
  newer.updatedAt = '2026-01-02T00:00:00.000Z';
  newer.notes = 'Newer edit';
  await ToolboxDB.saveCustomerFile(newer);
  let error = '';
  try {
    await ToolboxDB.importCustomerFileRecovery(stale, [], '2026-01-01T00:00:00.000Z', false);
  } catch (caught) {
    error = caught.message;
  }
  const saved = await ToolboxDB.getCustomerFile(record.id);
  return { error, updatedAt: saved.updatedAt, notes: saved.notes };
});
check('Atomic import guard prevents stale Customer File overwrite', /changed during import/.test(atomicGuard.error) && atomicGuard.updatedAt === '2026-01-02T00:00:00.000Z' && atomicGuard.notes === 'Newer edit', JSON.stringify(atomicGuard));

const floorInspection = await page.evaluate(async () => {
  const parsed = await ToolboxCustomerFileImport.inspectFile(window.__importFixtures.floorFile());
  window.__floorParsed = parsed;
  return {
    kind: parsed.kind,
    floors: parsed.floors.length,
    points: parsed.pointCount,
    transitions: parsed.transitionCount,
    customer: parsed.customerCandidates,
    date: parsed.bundle.project.inspectionDate,
    boundary: parsed.floors[0].source.boundary.length,
    exclusions: parsed.floors[0].source.exclusions.length,
    bp1: parsed.bundle.points.find((point) => point.isBasePoint),
  };
});
check('Floor Survey bundle v1 recognized', floorInspection.kind === 'floor' && floorInspection.floors === 1, JSON.stringify(floorInspection));
check('Floor project customer/address/date mapped from structured fields', floorInspection.customer.firstName === 'Fred' && floorInspection.customer.lastName === 'Keulen' && /44 El Cielo/.test(floorInspection.customer.propertyAddress) && floorInspection.date === '2026-07-28', JSON.stringify(floorInspection));
check('Floor geometry, readings, BP1, corrections, and exclusions parsed', floorInspection.points === 2 && floorInspection.transitions === 1 && floorInspection.boundary === 4 && floorInspection.exclusions === 1 && floorInspection.bp1.label === 'BP1', JSON.stringify(floorInspection));

const unsupportedFloor = await page.evaluate(async () => {
  try {
    await ToolboxCustomerFileImport.inspectFile(window.__importFixtures.floorFile(2));
    return '';
  } catch (error) {
    return error.message;
  }
});
check('Unsupported Floor Survey bundle rejected safely', /supported/.test(unsupportedFloor), unsupportedFloor);

const floorNewApplied = await page.evaluate(async () => {
  const context = await ToolboxCustomerFileImport.getImportContext(window.__floorParsed, 'import-floor-new');
  await ToolboxCustomerFileImport.applyImport(window.__floorParsed, 'import-floor-new', {
    targetUpdatedAt: context.targetUpdatedAt,
    canvasChoice: 'new',
    fieldChoices: {},
  });
  const record = await ToolboxDB.getCustomerFile('import-floor-new');
  const canvas = record.planSetup.canvases[0];
  const layer = record.floorSurvey.byCanvasId[canvas.id];
  return {
    customer: [record.firstName, record.lastName, record.propertyAddress],
    date: record.floorSurvey.inspectionDate,
    notes: record.floorSurvey.surveyNotes,
    customSurfaces: record.floorSurvey.customSurfaces,
    canvas: { name: canvas.name, width: canvas.plan.width, height: canvas.plan.height },
    plan: await ToolboxDB.getMedia(canvas.plan.id),
    layer,
  };
});
check('New Floor import creates original Customer File plan and reliable identity', floorNewApplied.customer[0] === 'Fred' && floorNewApplied.customer[1] === 'Keulen' && /44 El Cielo/.test(floorNewApplied.customer[2]) && floorNewApplied.canvas.width === 120 && floorNewApplied.canvas.height === 90 && !!floorNewApplied.plan, JSON.stringify(floorNewApplied.customer));
check('Floor import reconstructs native editable layer', floorNewApplied.layer.points.length === 2 && floorNewApplied.layer.boundary.length === 4 && floorNewApplied.layer.transitions.length === 1 && floorNewApplied.layer.exclusions.length === 1 && floorNewApplied.layer.bp1Gps.latitude === 35.1, JSON.stringify(floorNewApplied.layer));
check('Floor metadata remains Floor-owned', floorNewApplied.date === '2026-07-28' && floorNewApplied.notes === 'Field notes' && floorNewApplied.customSurfaces[0] === 'Saltillo', JSON.stringify(floorNewApplied));

const multiFloor = await page.evaluate(async () => {
  const bundle = structuredClone(window.__floorParsed.bundle);
  const secondSource = structuredClone(bundle.floors[0]);
  secondSource.id = 'floor-second';
  secondSource.name = '2nd Floor';
  secondSource.order = -1;
  secondSource.transitions = [];
  secondSource.transitionGroupAverages = undefined;
  bundle.floors.push(secondSource);
  bundle.points.push({
    id: 'point-second',
    floorId: 'floor-second',
    index: 1,
    x: 30,
    y: 25,
    value: 8.8,
    isBasePoint: true,
    label: 'BP1',
    createdAt: 3,
  });
  const file = new File([JSON.stringify(bundle)], 'multi.floorsurvey.json', { type: 'application/json' });
  const parsed = await ToolboxCustomerFileImport.inspectFile(file);
  const context = await ToolboxCustomerFileImport.getImportContext(parsed, 'import-floor-multi');
  await ToolboxCustomerFileImport.applyImport(parsed, 'import-floor-multi', {
    targetUpdatedAt: context.targetUpdatedAt,
    canvasChoice: 'new',
    fieldChoices: {},
  });
  const record = await ToolboxDB.getCustomerFile('import-floor-multi');
  return {
    names: record.planSetup.canvases.map((canvas) => canvas.name),
    layerCounts: record.planSetup.canvases.map((canvas) => record.floorSurvey.byCanvasId[canvas.id]?.points?.length || 0),
    planIds: record.planSetup.canvases.map((canvas) => canvas.plan?.id),
  };
});
check('Multiple Floor Survey floors preserve explicit floor order as native canvases', multiFloor.names.join('|') === '2nd Floor|1st Floor' && multiFloor.layerCounts.join('|') === '1|2' && new Set(multiFloor.planIds).size === 2, JSON.stringify(multiFloor));

const existingSafety = await page.evaluate(async () => {
  const existing = ToolboxApp.blankCustomerFile('import-existing');
  ToolboxPlanSetup.ensurePlanSetup(existing);
  existing.firstName = 'Existing';
  existing.lastName = 'Customer';
  existing.propertyAddress = 'Keep This Address';
  existing.cellPhone = '555-0101';
  existing.floorSurvey.inspectionDate = '2025-01-01';
  existing.floorSurvey.surveyNotes = 'Keep existing survey notes';
  existing.floorSurvey.customSurfaces = ['Carpet'];
  const originalCanvasId = existing.planSetup.canvases[0].id;
  await ToolboxDB.saveCustomerFile(existing);
  const context = await ToolboxCustomerFileImport.getImportContext(window.__floorParsed, existing.id);
  const conflicts = context.conflicts.map((conflict) => conflict.field).sort();
  await ToolboxCustomerFileImport.applyImport(window.__floorParsed, existing.id, {
    targetUpdatedAt: context.targetUpdatedAt,
    canvasChoice: 'add',
    fieldChoices: {
      firstName: 'keep',
      lastName: 'keep',
      propertyAddress: 'keep',
      'floorSurvey.inspectionDate': 'keep',
      'floorSurvey.surveyNotes': 'keep',
      'floorSurvey.customSurfaces': 'keep',
    },
  });
  const saved = await ToolboxDB.getCustomerFile(existing.id);
  return {
    conflicts,
    identity: [saved.firstName, saved.lastName, saved.propertyAddress, saved.cellPhone],
    floorMetadata: [saved.floorSurvey.inspectionDate, saved.floorSurvey.surveyNotes, saved.floorSurvey.customSurfaces.join(',')],
    canvases: saved.planSetup.canvases.map((canvas) => canvas.id),
    originalCanvasId,
    importedLayer: !!saved.floorSurvey.byCanvasId[saved.planSetup.canvases[0].id],
  };
});
check('Existing Customer File and Floor metadata conflicts are exposed', existingSafety.conflicts.join(',') === 'firstName,floorSurvey.customSurfaces,floorSurvey.inspectionDate,floorSurvey.surveyNotes,lastName,propertyAddress', JSON.stringify(existingSafety.conflicts));
check('Existing populated fields and Floor metadata remain intact; blank default canvas may be removed', existingSafety.identity.join('|') === 'Existing|Customer|Keep This Address|555-0101' && existingSafety.floorMetadata.join('|') === '2025-01-01|Keep existing survey notes|Carpet' && !existingSafety.canvases.includes(existingSafety.originalCanvasId) && existingSafety.importedLayer, JSON.stringify(existingSafety));

const dimensionMismatch = await page.evaluate(async () => {
  try {
    await ToolboxCustomerFileImport.inspectFile(window.__importFixtures.floorFile(1, {
      planWidth: 200,
      planHeight: 150,
      imageWidth: 120,
      imageHeight: 90,
    }));
    return { error: '' };
  } catch (error) {
    return { error: error.message };
  }
});
check('Declared/intrinsic plan dimension mismatch blocks import', /cannot safely guarantee point placement/.test(dimensionMismatch.error) && /200×150/.test(dimensionMismatch.error) && /120×90/.test(dimensionMismatch.error), dimensionMismatch.error);

const pointExact = await page.evaluate(async () => {
  const record = await ToolboxDB.getCustomerFile('import-floor-new');
  const canvas = record.planSetup.canvases[0];
  const layer = record.floorSurvey.byCanvasId[canvas.id];
  return layer.points.map((point) => [point.x, point.y, point.isBasePoint || false]);
});
check('Matching dimensions preserve point x/y exactly', JSON.stringify(pointExact) === JSON.stringify([[20, 20, true], [60, 45, false]]), JSON.stringify(pointExact));

const clientNameFallback = await page.evaluate(async () => {
  const parsed = await ToolboxCustomerFileImport.inspectFile(window.__importFixtures.floorFile(1, {
    client: 'Sandia Geo Consulting LLC',
  }));
  return {
    needs: parsed.needsClientNameEntry,
    unparsed: parsed.unparsedClient,
    first: parsed.customerCandidates.firstName,
    last: parsed.customerCandidates.lastName,
  };
});
check('Non-two-token client name requires editable fallback', clientNameFallback.needs && clientNameFallback.unparsed === 'Sandia Geo Consulting LLC' && !clientNameFallback.first && !clientNameFallback.last, JSON.stringify(clientNameFallback));

const clientNameApplied = await page.evaluate(async () => {
  const parsed = await ToolboxCustomerFileImport.inspectFile(window.__importFixtures.floorFile(1, {
    client: 'Sandia Geo Consulting LLC',
  }));
  const context = await ToolboxCustomerFileImport.getImportContext(parsed, 'import-floor-name');
  await ToolboxCustomerFileImport.applyImport(parsed, 'import-floor-name', {
    targetUpdatedAt: context.targetUpdatedAt,
    canvasChoice: 'new',
    fieldChoices: {},
    clientFirstName: 'Sandia',
    clientLastName: 'Consulting',
  });
  const record = await ToolboxDB.getCustomerFile('import-floor-name');
  return [record.firstName, record.lastName];
});
check('Editable client name fallback is applied on import', clientNameApplied.join('|') === 'Sandia|Consulting', JSON.stringify(clientNameApplied));

const floorWorkGuard = await page.evaluate(async () => {
  const existing = ToolboxApp.blankCustomerFile('import-floor-work');
  ToolboxPlanSetup.ensurePlanSetup(existing);
  existing.firstName = 'Pat';
  existing.lastName = 'Owner';
  existing.propertyAddress = '12 Existing Lane';
  const canvasId = existing.planSetup.canvases[0].id;
  existing.planSetup.canvases[0].plan = { id: 'plan-keep', width: 50, height: 40 };
  existing.floorSurvey.byCanvasId[canvasId] = {
    canvasId,
    boundary: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }],
    points: [{ id: 'keep-point', floorId: canvasId, x: 11, y: 12, value: 1, createdAt: 1 }],
    transitions: [],
    areas: [],
    exclusions: [],
  };
  await ToolboxDB.saveCustomerFile(existing);
  await ToolboxDB.putMedia('plan-keep', 'data:image/png;base64,aaa');
  const context = await ToolboxCustomerFileImport.getImportContext(window.__floorParsed, existing.id);
  let blockedError = '';
  try {
    await ToolboxCustomerFileImport.applyImport(window.__floorParsed, existing.id, {
      targetUpdatedAt: context.targetUpdatedAt,
      canvasChoice: 'add',
      fieldChoices: {
        firstName: 'keep',
        lastName: 'keep',
        propertyAddress: 'keep',
      },
    });
  } catch (error) {
    blockedError = error.message;
  }
  const before = await ToolboxDB.getCustomerFile(existing.id);
  await ToolboxCustomerFileImport.applyImport(window.__floorParsed, existing.id, {
    targetUpdatedAt: before.updatedAt,
    canvasChoice: 'add',
    fieldChoices: {
      firstName: 'keep',
      lastName: 'keep',
      propertyAddress: 'keep',
    },
    confirmAddFloorLevels: true,
  });
  const after = await ToolboxDB.getCustomerFile(existing.id);
  const keptLayer = after.floorSurvey.byCanvasId[canvasId];
  return {
    requiresConfirm: context.requiresFloorAddConfirm,
    blockedError,
    canvasCount: after.planSetup.canvases.length,
    keptCanvas: after.planSetup.canvases.some((canvas) => canvas.id === canvasId),
    keptPoints: keptLayer && keptLayer.points.map((point) => [point.x, point.y]),
    destinationLabel: context.destinationLabel,
  };
});
check('Existing Floor Survey work requires explicit add-levels confirmation', floorWorkGuard.requiresConfirm && /additional level/.test(floorWorkGuard.blockedError), JSON.stringify(floorWorkGuard));
check('Existing Floor geometry is preserved when recovered levels are added', floorWorkGuard.keptCanvas && floorWorkGuard.canvasCount >= 2 && JSON.stringify(floorWorkGuard.keptPoints) === JSON.stringify([[11, 12]]), JSON.stringify(floorWorkGuard));

const destinations = await page.evaluate(async () => {
  const list = await ToolboxCustomerFileImport.listImportDestinations();
  return {
    ids: list.map((item) => item.id),
    labels: list.map((item) => item.label),
    hasFloorWork: list.find((item) => item.id === 'import-floor-work')?.hasFloorWork,
  };
});
check('Destination picker lists existing non-trashed Customer Files with identity', destinations.ids.includes('import-floor-work') && /Pat Owner/.test(destinations.labels.join(' | ')) && /12 Existing Lane/.test(destinations.labels.join(' | ')) && destinations.hasFloorWork === true, JSON.stringify(destinations));

const newCanvasCleanup = await page.evaluate(async () => {
  const record = await ToolboxDB.getCustomerFile('import-floor-new');
  return {
    count: record.planSetup.canvases.length,
    names: record.planSetup.canvases.map((canvas) => canvas.name),
    plans: record.planSetup.canvases.every((canvas) => !!(canvas.plan && canvas.plan.id)),
  };
});
check('New Floor import does not retain a meaningless default blank canvas', newCanvasCleanup.count === 1 && newCanvasCleanup.names[0] === '1st Floor' && newCanvasCleanup.plans, JSON.stringify(newCanvasCleanup));

const syncRecognition = await page.evaluate(async () => {
  const record = await ToolboxDB.getCustomerFile('import-floor-new');
  return {
    customer: ToolboxSync.componentRevision(record, 'customer'),
    plans: ToolboxSync.componentRevision(record, 'plans'),
    floor: ToolboxSync.componentRevision(record, 'floor'),
    components: ToolboxSync.COMPONENTS.slice(),
  };
});
check('Imported Customer File remains recognized by sync as customer/plans/floor', !!(syncRecognition.customer && syncRecognition.plans && syncRecognition.floor) && syncRecognition.components.includes('customer') && syncRecognition.components.includes('plans') && syncRecognition.components.includes('floor'), JSON.stringify(syncRecognition));

const floorDuplicate = await page.evaluate(async () => {
  const context = await ToolboxCustomerFileImport.getImportContext(window.__floorParsed, 'import-floor-new');
  try {
    await ToolboxCustomerFileImport.applyImport(window.__floorParsed, 'import-floor-new', {
      targetUpdatedAt: context.targetUpdatedAt,
      canvasChoice: 'add',
      fieldChoices: {},
      confirmAddFloorLevels: true,
    });
    return { error: '' };
  } catch (error) {
    return { error: error.message };
  }
});
check('Floor duplicate fingerprint protection still works locally', /already been imported/.test(floorDuplicate.error), floorDuplicate.error);

await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#cabinet-import');
const uiEntry = await page.evaluate(() => document.querySelector('#cabinet-import')?.textContent);
check('Cabinet exposes normal Import control', /Import standalone export/.test(uiEntry || ''), uiEntry);
await page.click('#cabinet-import');
await page.waitForSelector('#cf-import-file');
check('Cabinet Import route allows destination choice', (await page.evaluate(() => location.hash)) === '#/import');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.evaluate((base64) => {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const file = new File([bytes], 'completed-distress.zip', { type: 'application/zip' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.querySelector('#cf-import-file');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, fixtures.previewZipBase64);
await page.waitForFunction(() => document.querySelector('input[name="cf-import-dest-mode"]'));
const destChoiceUi = await page.evaluate(() => ({
  text: document.querySelector('.cf-import__preview')?.innerText || '',
  create: !!document.querySelector('input[name="cf-import-dest-mode"][value="new"]'),
  existing: !!document.querySelector('input[name="cf-import-dest-mode"][value="existing"]'),
}));
check('Cabinet import can choose Create New or existing Customer File', destChoiceUi.create && destChoiceUi.existing && /Where should this recovered work go/.test(destChoiceUi.text), destChoiceUi.text.replace(/\n/g, ' | '));
await page.click('input[name="cf-import-dest-mode"][value="new"]');
await page.waitForSelector('#cf-import-confirm');
const previewUi = await page.evaluate(() => ({
  text: document.querySelector('.cf-import__preview')?.innerText || '',
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}));
check('Import preview inventories Distress and deferred Quick Capture data', /Observations\s+2/i.test(previewUi.text) && /Quick Capture\s+2 photos found — not imported yet/i.test(previewUi.text) && /New Customer File/i.test(previewUi.text), previewUi.text.replace(/\n/g, ' | '));
check('Import preview remains contained on phone', !previewUi.overflow, JSON.stringify(previewUi));

const floorPreview = await page.evaluate(async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  ToolboxCustomerFileImport.mount(host, {
    allowDestinationChoice: true,
    onDone: function () {},
  });
  const file = await window.__importFixtures.floorFile();
  const input = host.querySelector('#cf-import-file');
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  host.querySelector('input[name="cf-import-dest-mode"][value="existing"]').click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const select = host.querySelector('#cf-import-dest-file');
  select.value = 'import-floor-work';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (host.querySelector('#cf-import-confirm-floor-add') || Date.now() - started > 3000) {
        clearInterval(timer);
        resolve();
      }
    }, 40);
  });
  const text = host.querySelector('.cf-import__preview')?.innerText || '';
  host.remove();
  return text;
});
check('Floor preview reports boundary/BP1/readings/transitions and destination identity', /Boundary recovered\s+Yes/i.test(floorPreview) && /BP1 recovered\s+Yes/i.test(floorPreview) && /Survey readings\s+2/i.test(floorPreview) && /Transitions \/ corrections\s+1/i.test(floorPreview) && /Pat Owner/.test(floorPreview) && /additional level/i.test(floorPreview), floorPreview.replace(/\n/g, ' | '));

await page.screenshot({ path: '/opt/cursor/artifacts/customer-file-import-preview-phone.png', fullPage: true });
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
await page.screenshot({ path: '/opt/cursor/artifacts/customer-file-import-preview-desktop.png', fullPage: true });

await page.goto(`${BASE}#/file/import-distress/distress`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => {
  const frame = document.querySelector('iframe');
  return frame && frame.contentDocument && frame.contentDocument.querySelectorAll('#gPins .pin').length === 2;
});
const nativeDistress = await page.evaluate(() => {
  const win = document.querySelector('iframe').contentWindow;
  const firstPin = win.document.querySelector('#gPins .pin');
  const circle = firstPin.querySelector('.pin-bg');
  const rect = circle.getBoundingClientRect();
  const eventInit = {
    bubbles: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };
  circle.dispatchEvent(new PointerEvent('pointerdown', eventInit));
  circle.dispatchEvent(new PointerEvent('pointerup', eventInit));
  return {
    pins: win.document.querySelectorAll('#gPins .pin').length,
    legacyDirection: win.document.querySelector('#pinLegacyDirection')?.textContent,
  };
});
check('Imported Distress opens through normal native workspace', nativeDistress.pins === 2, JSON.stringify(nativeDistress));
check('Legacy direction displays only as missing-orientation compatibility data', nativeDistress.legacyDirection === 'Recovered direction: NE', JSON.stringify(nativeDistress));
await page.evaluate(() => {
  const win = document.querySelector('iframe').contentWindow;
  const description = win.document.querySelector('#pinDesc');
  description.value = 'Recovered observation edited';
  description.dispatchEvent(new Event('input', { bubbles: true }));
});
await new Promise((resolve) => setTimeout(resolve, 400));
const editedDistress = await page.evaluate(async () => {
  const record = await ToolboxDB.getCustomerFile('import-distress');
  return record.distress.pins[0].description;
});
check('Imported Distress observation remains editable through native UI', editedDistress === 'Recovered observation edited', editedDistress);

await page.goto(`${BASE}#/file/import-floor-new/floor`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.body.classList.contains('floor-survey-open') && document.querySelector('canvas'), { timeout: 10000 });
const nativeFloor = await page.evaluate(async () => {
  const record = await ToolboxDB.getCustomerFile('import-floor-new');
  const canvas = record.planSetup.canvases[0];
  const layer = record.floorSurvey.byCanvasId[canvas.id];
  return {
    mounted: document.body.classList.contains('floor-survey-open'),
    points: layer.points.length,
    boundary: layer.boundary.length,
    transitions: layer.transitions.length,
  };
});
check('Imported Floor Survey opens through normal native workspace', nativeFloor.mounted && nativeFloor.points === 2 && nativeFloor.boundary === 4 && nativeFloor.transitions === 1, JSON.stringify(nativeFloor));

await page.goto(`${BASE}#/file/partial-recovery-ui/import`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#cf-import-file');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.evaluate(async () => {
  const file = await window.__importFixtures.partialDistressFile();
  const input = document.querySelector('#cf-import-file');
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForSelector('#cf-import-ack-excluded');
const partialPreview = await page.evaluate(() => {
  const confirm = document.querySelector('#cf-import-confirm');
  return {
    status: document.querySelector('#cf-import-status')?.textContent || '',
    text: document.querySelector('.cf-import__preview')?.innerText || '',
    back: document.querySelector('#import-back')?.textContent || '',
    fileKept: (document.querySelector('#cf-import-file')?.files || []).length === 1,
    confirmDisabled: !!(confirm && confirm.disabled),
    confirmLabel: confirm ? confirm.textContent.trim() : '',
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
});
check(
  'Partial Distress preview names the bad observation and stays recoverable',
  /1 observation cannot be imported/.test(partialPreview.status) &&
    /Observation 2 — Unreadable pin/.test(partialPreview.text) &&
    /invalid y coordinate/.test(partialPreview.text) &&
    /2 ready, 1 left out/.test(partialPreview.text) &&
    partialPreview.back.includes('Back') &&
    partialPreview.fileKept &&
    partialPreview.confirmDisabled &&
    partialPreview.confirmLabel === 'Import valid observations' &&
    !partialPreview.overflow,
  JSON.stringify(partialPreview),
);
await page.screenshot({ path: '/opt/cursor/artifacts/distress-import-excluded-phone.png', fullPage: true });
await page.setViewport({ width: 834, height: 1194, deviceScaleFactor: 1 });
await page.screenshot({ path: '/opt/cursor/artifacts/distress-import-excluded-ipad.png', fullPage: true });
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
const partialDesktop = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
}));
check('Partial Distress preview stays contained on desktop', !partialDesktop.overflow, JSON.stringify(partialDesktop));
await page.screenshot({ path: '/opt/cursor/artifacts/distress-import-excluded-desktop.png', fullPage: true });

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.click('#cf-import-ack-excluded');
await page.waitForFunction(() => {
  const button = document.querySelector('#cf-import-confirm');
  return button && !button.disabled;
});
await page.click('#cf-import-confirm');
await page.waitForSelector('.cf-import__result');
const partialResult = await page.evaluate(async () => {
  const record = await ToolboxDB.getCustomerFile('partial-recovery-ui');
  return {
    text: document.querySelector('.cf-import__result')?.innerText || '',
    descriptions: record.distress.pins.map((pin) => pin.description),
    coords: record.distress.pins.map((pin) => [pin.x, pin.y]),
    excluded: record.recoveryImports[0].excludedObservations.map((item) => item.heading),
  };
});
check(
  'Partial Distress confirmation keeps valid work and repeats what was left out',
  /2 observations recovered/.test(partialResult.text) &&
    /1 observation left out/.test(partialResult.text) &&
    /Observation 2 — Unreadable pin/.test(partialResult.text) &&
    /original ZIP was not changed/.test(partialResult.text) &&
    partialResult.descriptions.join('|') === 'Crack at window|Stucco crack' &&
    partialResult.coords[0][0] === 25 &&
    partialResult.coords[0][1] === 40 &&
    partialResult.coords[1][0] === 50 &&
    partialResult.coords[1][1] === 20 &&
    partialResult.excluded[0] === 'Observation 2 — Unreadable pin',
  JSON.stringify(partialResult),
);
await page.screenshot({ path: '/opt/cursor/artifacts/distress-import-excluded-result-phone.png', fullPage: true });

await page.evaluate(async () => {
  const file = await window.__importFixtures.nonNumericYFile();
  const input = document.querySelector('#cf-import-file');
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForFunction(() => /No observations in this export can be imported/.test(document.body.innerText));
const nothingRecoverable = await page.evaluate(() => ({
  text: document.querySelector('.cf-import__preview')?.innerText || '',
  back: !!document.querySelector('#import-back'),
  confirm: !!document.querySelector('#cf-import-confirm'),
  fileKept: (document.querySelector('#cf-import-file')?.files || []).length === 1,
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
}));
check(
  'A wholly unreadable Distress observation explains itself and does not trap the screen',
  /Observation 1 — Unreadable/.test(nothingRecoverable.text) &&
    /invalid y coordinate/.test(nothingRecoverable.text) &&
    /Use Back/.test(nothingRecoverable.text) &&
    nothingRecoverable.back &&
    !nothingRecoverable.confirm &&
    nothingRecoverable.fileKept &&
    !nothingRecoverable.overflow,
  JSON.stringify(nothingRecoverable),
);
await page.screenshot({ path: '/opt/cursor/artifacts/distress-import-none-recoverable-phone.png', fullPage: true });

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
