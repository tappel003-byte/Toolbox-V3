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
    const projectName = Object.prototype.hasOwnProperty.call(overrides, 'projectName') ? overrides.projectName : 'Keulen';
    const address = Object.prototype.hasOwnProperty.call(overrides, 'address') ? overrides.address : '44 El Cielo Azul Circle, Edgewood, NM';
    const fileName = overrides.fileName || 'keulen.floorsurvey.json';
    const bundle = {
      kind: 'floor-survey-bundle',
      bundleVersion: version,
      exportedAt: Date.now(),
      project: {
        id: 'project-old',
        name: projectName,
        address,
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
    return new File([JSON.stringify(bundle)], fileName, { type: 'application/json' });
  }

  async function tinyJpeg() {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#c14a2b';
    ctx.fillRect(0, 0, 16, 16);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  }

  async function lodgeStyleFile({ appleDouble = false, bom = false } = {}) {
    const zip = new JSZip();
    const root = zip.folder('59 Lodge Trail');
    const plan = planDataUrl(200, 120);
    const jpeg = await tinyJpeg();
    root.file('plan.png', plan.split(',')[1], { base64: true });
    root.file('map.png', 'derivative');
    root.file('pinlog.pdf', 'derivative');
    root.file('pins.csv', 'derivative');
    const pinsJson = JSON.stringify([
      {
        id: 'lodge-1',
        num: 1,
        type: 'Interior',
        description: 'Crack at window',
        room: 'Living Room',
        direction: 'NE',
        x: '0.25000',
        y: '0.40000',
        photos: ['photos/photo-01.jpg'],
      },
      {
        id: 'lodge-2',
        num: 2,
        type: 'Exterior',
        description: 'Brick separation',
        room: '',
        direction: 'S',
        x: '0.50000',
        y: '0.60000',
        photos: ['photos/photo-02.jpg', 'photos/photo-03.jpg'],
      },
    ], null, 2);
    root.file('pins.json', (bom ? '\uFEFF' : '') + pinsJson);
    const photos = root.folder('photos');
    ['photo-01.jpg', 'photo-02.jpg', 'photo-03.jpg'].forEach((name) => photos.file(name, jpeg, { base64: true }));
    const quick = root.folder('quick-capture');
    ['quick-01.jpg', 'quick-02.jpg', 'quick-03.jpg'].forEach((name) => quick.file(name, jpeg, { base64: true }));
    quick.file(
      'quick-capture.csv',
      'File,Timestamp,Latitude,Longitude\r\nquick-01.jpg,2026-07-28T10:00:00Z,35.1,-106.2\r\nquick-02.jpg,2026-07-28T10:01:00Z,,\r\nquick-03.jpg,2026-07-28T10:02:00Z,,\r\n',
    );
    if (appleDouble) {
      zip.file('__MACOSX/59 Lodge Trail/._pins.json', 'appledouble');
      zip.file('__MACOSX/59 Lodge Trail/photos/._photo-01.jpg', 'appledouble');
    }
    return new File([await zip.generateAsync({ type: 'blob' })], '59-lodge-trail.zip', { type: 'application/zip' });
  }

  window.__importFixtures = { distressFile, floorFile, legacyOutOfRangeYFile, nonNumericYFile, partialDistressFile, lodgeStyleFile };
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
    quick: {
      count: parsed.quickCapture.count,
      metadataCount: parsed.quickCapture.metadataCount,
      files: (parsed.quickCapture.files || []).map((file) => file.sourceName),
    },
    derivatives: parsed.ignoredDerivativeCount,
    first: parsed.pins[0],
    second: parsed.pins[1],
    excluded: parsed.excludedObservations.length,
  };
});
check('Valid Distress ZIP recognized', distressInspection.kind === 'distress', JSON.stringify(distressInspection));
check('Distress plan and normalized coordinates recovered', distressInspection.plan[0] === 100 && distressInspection.plan[1] === 80 && distressInspection.first.xNormalized === 0.25 && distressInspection.first.yNormalized === 0.5, JSON.stringify(distressInspection));
check('Distress observations and relationships recovered', distressInspection.pins === 2 && distressInspection.photos === 2 && distressInspection.first.photos.length === 2 && distressInspection.second.photos.length === 0, JSON.stringify(distressInspection));
check('Quick Capture inventoried as its own folder', distressInspection.quick.count === 2 && distressInspection.quick.metadataCount === 2 && distressInspection.quick.files.join(',') === 'quick-01.jpg,quick-02.jpg', JSON.stringify(distressInspection.quick));
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
    /No Distress observations in this export can be imported/.test(nonNumericY.writeError) &&
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
  async function readPhoto(id) {
    return new Promise((resolve, reject) => {
      const tx = photoDb.transaction('photos', 'readonly');
      const request = tx.objectStore('photos').get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }
  const photoValues = await Promise.all(record.distress.pins[0].photos.map((id) => readPhoto(id)));
  const quickValues = await Promise.all((record.distress.quickCapture || []).map((item) => readPhoto(item.id)));
  photoDb.close();
  return {
    result,
    canvas: { name: canvas.name, width: canvas.plan.width, height: canvas.plan.height, facing: canvas.frontDoorFacing },
    planStored: /^data:image\/png/.test(plan || ''),
    pins: record.distress.pins,
    numbering: [record.distress.startNum, record.distress.nextNum],
    photoValues,
    quick: (record.distress.quickCapture || []).map((item, index) => ({
      name: item.sourceName,
      timestamp: item.timestamp,
      stored: typeof quickValues[index] === 'string' && quickValues[index].indexOf('data:image/') === 0,
    })),
    pinNames: record.distress.pins[0].photos.map((id) => record.distress.photoSources[id]),
    quickOnPins: record.distress.pins.some((pin) => (pin.photos || []).some((id) => String(record.distress.photoSources[id] || '').indexOf('quick-') === 0)),
    history: record.recoveryImports,
  };
});
check('Distress import creates native Customer File canvas and plan media', distressApplied.planStored && distressApplied.canvas.width === 100 && distressApplied.canvas.height === 80 && distressApplied.canvas.facing === '', JSON.stringify(distressApplied.canvas));
check('Distress import denormalizes native pixel positions', distressApplied.pins[0].x === 25 && distressApplied.pins[0].y === 40 && distressApplied.pins[1].x === 75 && distressApplied.pins[1].y === 50, JSON.stringify(distressApplied.pins));
check('Distress numbering preserves multi/zero-photo semantics', distressApplied.numbering[0] === 1 && distressApplied.numbering[1] === 4 && distressApplied.pins[0].num === 1 && distressApplied.pins[1].num === 3, JSON.stringify(distressApplied.numbering));
check('Distress photo bytes staged and attached', distressApplied.photoValues.length === 2 && distressApplied.photoValues.every(Boolean), JSON.stringify(distressApplied.photoValues));
check(
  'Quick Capture is saved as its own folder and not attached to pins',
  distressApplied.result.quickCaptureCount === 2 &&
    distressApplied.quick.length === 2 &&
    distressApplied.quick[0].name === 'quick-01.jpg' &&
    distressApplied.quick[0].timestamp === '2026-07-28T10:00:00Z' &&
    distressApplied.quick.every((item) => item.stored) &&
    distressApplied.pinNames.join(',') === 'photo-01.jpg,photo-02.jpg' &&
    distressApplied.quickOnPins === false,
  JSON.stringify({ quick: distressApplied.quick, pinNames: distressApplied.pinNames, quickOnPins: distressApplied.quickOnPins }),
);
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
check('Import preview inventories Distress and Quick Capture folders', /Observations\s+2/i.test(previewUi.text) && /Quick Capture\s+2 photos — separate folder, not placed on the plan/i.test(previewUi.text) && /New Customer File/i.test(previewUi.text), previewUi.text.replace(/\n/g, ' | '));
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

const mistakeRecovery = await page.evaluate(async () => {
  function tinyPlan() {
    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 60;
    const context = canvas.getContext('2d');
    context.fillStyle = '#efe6d2';
    context.fillRect(0, 0, 80, 60);
    context.strokeStyle = '#082036';
    context.strokeRect(4, 4, 72, 52);
    return canvas.toDataURL('image/png');
  }

  async function distressZip(folder, fileName, description) {
    const zip = new JSZip();
    const root = zip.folder(folder);
    const plan = tinyPlan();
    root.file('plan.png', plan.split(',')[1], { base64: true });
    root.file('pins.json', JSON.stringify([{
      id: 'legacy-' + fileName,
      num: 1,
      type: 'Interior',
      description,
      room: 'Kitchen',
      direction: 'N',
      x: '0.50000',
      y: '0.40000',
      photos: ['photo-01.jpg'],
    }]));
    root.folder('photos').file('photo-01.jpg', 'photo-' + fileName);
    return new File([await zip.generateAsync({ type: 'blob' })], fileName, { type: 'application/zip' });
  }

  function floorBundleFile(fileName, address, client, date) {
    const plan = tinyPlan();
    const bundle = {
      kind: 'floor-survey-bundle',
      bundleVersion: 1,
      project: {
        client,
        address,
        inspectionDate: date,
        notes: 'Synthetic survey notes',
        customSurfaces: ['Carpet'],
      },
      floors: [{
        id: 'floor-synthetic',
        name: 'Main Level',
        order: 0,
        planDataUrl: plan,
        planWidth: 80,
        planHeight: 60,
        boundary: [{ x: 4, y: 4 }, { x: 70, y: 4 }, { x: 70, y: 50 }],
      }],
      points: [
        { id: 'reading-1', floorId: 'floor-synthetic', x: 12, y: 14, value: 1.25, createdAt: 1 },
        { id: 'reading-2', floorId: 'floor-synthetic', x: 30, y: 28, value: 1.4, createdAt: 2 },
      ],
    };
    return new File([JSON.stringify(bundle)], fileName, { type: 'application/json' });
  }

  async function readPhoto(id) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pgg_photos_v1', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readonly');
      const request = tx.objectStore('photos').get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value;
  }

  async function seedCustomer(id, address) {
    const record = ToolboxApp.blankCustomerFile(id);
    ToolboxPlanSetup.ensurePlanSetup(record);
    record.firstName = 'Ada';
    record.lastName = 'Field';
    record.propertyAddress = address;
    record.customerUpdatedAt = '2026-04-01T00:00:00.000Z';
    await ToolboxDB.saveCustomerFile(record);
    return record;
  }

  async function importFloor(id, file) {
    const parsed = await ToolboxCustomerFileImport.inspectFile(file);
    const context = await ToolboxCustomerFileImport.getImportContext(parsed, id);
    const current = await ToolboxDB.getCustomerFile(id);
    await ToolboxCustomerFileImport.applyImport(parsed, id, {
      targetUpdatedAt: current.updatedAt,
      canvasChoice: context.isNew ? 'new' : 'add',
      fieldChoices: { firstName: 'keep', lastName: 'keep', propertyAddress: 'keep' },
      confirmAddFloorLevels: !!context.requiresFloorAddConfirm,
    });
    return parsed;
  }

  async function importDistress(id, file) {
    const parsed = await ToolboxCustomerFileImport.inspectFile(file);
    const current = await ToolboxDB.getCustomerFile(id);
    await ToolboxCustomerFileImport.applyImport(parsed, id, {
      targetUpdatedAt: current.updatedAt,
      canvasChoice: 'add',
      fieldChoices: {},
      useSuggestedAddress: false,
    });
    return parsed;
  }

  const wrongFile = await distressZip('59_Lodge_Trail', 'wrong-distress.zip', 'Wrong house crack');
  const wrongParsed = await ToolboxCustomerFileImport.inspectFile(wrongFile);
  await seedCustomer('cf-preview-warn', '8 Continuation Court');
  const warnContext = await ToolboxCustomerFileImport.getImportContext(wrongParsed, 'cf-preview-warn');
  const beforeWarn = await ToolboxDB.getCustomerFile('cf-preview-warn');

  const rightDistress = await distressZip('8_Continuation_Court', 'right-distress.zip', 'Right house crack');
  const rightFloor = floorBundleFile('right-floor.json', '8 Continuation Court', 'Ada Field', '2026-03-01');
  await seedCustomer('cf-undo-distress', '8 Continuation Court');
  await importFloor('cf-undo-distress', rightFloor);
  const distressParsed = await importDistress('cf-undo-distress', rightDistress);
  const withBoth = await ToolboxDB.getCustomerFile('cf-undo-distress');
  const floorCanvasId = withBoth.recoveryImports.find((entry) => entry.kind === 'floor').canvasIds[0];
  const distressCanvasId = withBoth.recoveryImports.find((entry) => entry.kind === 'distress').canvasIds[0];
  const floorPlanId = withBoth.planSetup.canvases.find((canvas) => canvas.id === floorCanvasId).plan.id;
  const distressPlanId = withBoth.planSetup.canvases.find((canvas) => canvas.id === distressCanvasId).plan.id;
  const distressPhotoId = withBoth.distress.pins[0].photos[0];
  const floorPointsBefore = withBoth.floorSurvey.byCanvasId[floorCanvasId].points.map((point) => [point.x, point.y]);
  const removedDistress = await ToolboxCustomerFileImport.removeImportedComponent('cf-undo-distress', distressParsed.fingerprint);
  const afterDistressRemoval = await ToolboxDB.getCustomerFile('cf-undo-distress');
  const distressPhotoAfter = await readPhoto(distressPhotoId);
  const floorPlanAfter = await ToolboxDB.getMedia(floorPlanId);
  const distressPlanAfter = await ToolboxDB.getMedia(distressPlanId);

  const floorOnly = floorBundleFile('other-floor.json', '8 Continuation Court', 'Ada Field', '2026-03-01');
  const distressForFloor = await distressZip('8_Continuation_Court', 'keep-distress.zip', 'Keep this crack');
  await seedCustomer('cf-undo-floor', '8 Continuation Court');
  const floorParsed = await importFloor('cf-undo-floor', floorOnly);
  await importDistress('cf-undo-floor', distressForFloor);
  const beforeFloorRemoval = await ToolboxDB.getCustomerFile('cf-undo-floor');
  const keptPhotoId = beforeFloorRemoval.distress.pins[0].photos[0];
  const keptDistressPlanId = beforeFloorRemoval.planSetup.canvases.find((canvas) =>
    canvas.id === beforeFloorRemoval.recoveryImports.find((entry) => entry.kind === 'distress').canvasIds[0]).plan.id;
  const removedFloor = await ToolboxCustomerFileImport.removeImportedComponent('cf-undo-floor', floorParsed.fingerprint);
  const afterFloorRemoval = await ToolboxDB.getCustomerFile('cf-undo-floor');
  const keptPhotoAfter = await readPhoto(keptPhotoId);
  const keptDistressPlanAfter = await ToolboxDB.getMedia(keptDistressPlanId);

  await seedCustomer('cf-undo-block', '8 Continuation Court');
  const blockedParsed = await importDistress('cf-undo-block', await distressZip('8_Continuation_Court', 'blocked-distress.zip', 'Blocked crack'));
  const blockedRecord = await ToolboxDB.getCustomerFile('cf-undo-block');
  blockedRecord.distress.pins[0].photos.push('ph_field_later');
  await ToolboxDB.saveCustomerFile(blockedRecord);
  const blockedUpdatedAt = (await ToolboxDB.getCustomerFile('cf-undo-block')).updatedAt;
  let blockedError = '';
  try {
    await ToolboxCustomerFileImport.removeImportedComponent('cf-undo-block', blockedParsed.fingerprint);
  } catch (error) {
    blockedError = error.message;
  }
  const blockedAfter = await ToolboxDB.getCustomerFile('cf-undo-block');

  await seedCustomer('cf-undo-share', '8 Continuation Court');
  const sharedParsed = await importDistress('cf-undo-share', await distressZip('8_Continuation_Court', 'shared-distress.zip', 'Shared photo crack'));
  const sharedRecord = await ToolboxDB.getCustomerFile('cf-undo-share');
  const sharedPhotoId = sharedRecord.distress.pins[0].photos[0];
  const sharedPlanId = sharedRecord.planSetup.canvases.find((canvas) => canvas.plan && canvas.plan.id).plan.id;
  const holder = ToolboxApp.blankCustomerFile('cf-photo-holder');
  ToolboxPlanSetup.ensurePlanSetup(holder);
  holder.deletedAt = '2026-09-01T00:00:00.000Z';
  holder.distress.pins = [{ id: 'pin-holder', canvasId: holder.planSetup.canvases[0].id, num: 1, photos: [sharedPhotoId] }];
  await ToolboxDB.saveCustomerFile(holder);
  await ToolboxDB.putMedia('plan-unrelated-neighbor', 'data:image/png;base64,bmVpZ2hib3I=');
  const sharedRemoval = await ToolboxCustomerFileImport.removeImportedComponent('cf-undo-share', sharedParsed.fingerprint);
  const sharedPhotoAfter = await readPhoto(sharedPhotoId);
  const sharedPlanAfter = await ToolboxDB.getMedia(sharedPlanId);
  const neighborPlan = await ToolboxDB.getMedia('plan-unrelated-neighbor');
  const holderAfter = await ToolboxDB.getCustomerFile('cf-photo-holder');

  await seedCustomer('cf-undo-legacy', '8 Continuation Court');
  const legacyParsed = await importDistress('cf-undo-legacy', await distressZip('8_Continuation_Court', 'legacy-distress.zip', 'Legacy crack'));
  const legacyRecord = await ToolboxDB.getCustomerFile('cf-undo-legacy');
  const legacyEntry = legacyRecord.recoveryImports[0];
  delete legacyEntry.pinIds;
  delete legacyEntry.photoIds;
  delete legacyEntry.planMediaIds;
  const importedCanvasId = legacyEntry.canvasIds[0];
  legacyRecord.distress.pins.push({
    id: 'native-pin',
    num: 9,
    x: 8,
    y: 8,
    photos: [],
    description: 'Added after import',
    canvasId: importedCanvasId,
  });
  await ToolboxDB.saveCustomerFile(legacyRecord);
  const legacyRemoval = await ToolboxCustomerFileImport.removeImportedComponent('cf-undo-legacy', legacyParsed.fingerprint);
  const legacyAfter = await ToolboxDB.getCustomerFile('cf-undo-legacy');

  await seedCustomer('cf-undo-date', '8 Continuation Court');
  const datedFloor = await importFloor('cf-undo-date', floorBundleFile('dated-floor.json', '8 Continuation Court', 'Ada Field', '2026-03-01'));
  const dated = await ToolboxDB.getCustomerFile('cf-undo-date');
  dated.floorSurvey.inspectionDate = '2026-09-01';
  await ToolboxDB.saveCustomerFile(dated);
  await ToolboxCustomerFileImport.removeImportedComponent('cf-undo-date', datedFloor.fingerprint);
  const datedAfter = await ToolboxDB.getCustomerFile('cf-undo-date');

  return {
    warning: warnContext.addressWarning,
    sourceFile: wrongParsed.fileName,
    suggested: wrongParsed.suggestedPropertyAddress,
    unchangedPins: beforeWarn.distress ? (beforeWarn.distress.pins || []).length : 0,
    unchangedAddress: beforeWarn.propertyAddress,
    distressRemoval: {
      observations: removedDistress.observationsRemoved,
      photos: removedDistress.photosRemoved,
      floorPoints: afterDistressRemoval.floorSurvey.byCanvasId[floorCanvasId]
        ? afterDistressRemoval.floorSurvey.byCanvasId[floorCanvasId].points.map((point) => [point.x, point.y])
        : null,
      floorPointsBefore,
      pins: (afterDistressRemoval.distress.pins || []).length,
      name: [afterDistressRemoval.firstName, afterDistressRemoval.lastName, afterDistressRemoval.propertyAddress],
      customerClock: afterDistressRemoval.customerUpdatedAt,
      photoGone: distressPhotoAfter == null,
      floorPlanKept: !!floorPlanAfter,
      distressPlanGone: distressPlanAfter == null,
      floorImportRemains: afterDistressRemoval.recoveryImports.some((entry) => entry.kind === 'floor'),
      distressImportGone: !afterDistressRemoval.recoveryImports.some((entry) => entry.kind === 'distress'),
    },
    floorRemoval: {
      readings: removedFloor.readingsRemoved,
      metadataRestored: removedFloor.floorMetadataRestored,
      pins: (afterFloorRemoval.distress.pins || []).length,
      photoKept: !!keptPhotoAfter,
      distressPlanKept: !!keptDistressPlanAfter,
      name: [afterFloorRemoval.firstName, afterFloorRemoval.lastName, afterFloorRemoval.propertyAddress],
      date: afterFloorRemoval.floorSurvey.inspectionDate || '',
      notes: afterFloorRemoval.floorSurvey.surveyNotes || '',
      surfaces: afterFloorRemoval.floorSurvey.customSurfaces || [],
      floorLayers: Object.keys(afterFloorRemoval.floorSurvey.byCanvasId || {}).length,
      distressImportRemains: afterFloorRemoval.recoveryImports.some((entry) => entry.kind === 'distress'),
    },
    blocked: {
      error: blockedError,
      pins: blockedAfter.distress.pins.length,
      photos: blockedAfter.distress.pins[0].photos.slice(),
      updatedAt: blockedAfter.updatedAt,
      sameClock: blockedAfter.updatedAt === blockedUpdatedAt,
    },
    shared: {
      photosKeptShared: sharedRemoval.photosKeptShared,
      photoRemains: !!sharedPhotoAfter,
      planGone: sharedPlanAfter == null,
      neighborRemains: neighborPlan === 'data:image/png;base64,bmVpZ2hib3I=',
      holderStillReferences: holderAfter.distress.pins[0].photos[0] === sharedPhotoId,
      pins: (await ToolboxDB.getCustomerFile('cf-undo-share')).distress.pins.length,
    },
    legacy: {
      kept: legacyAfter.distress.pins.map((pin) => pin.id),
      keptObservations: legacyRemoval.keptObservations,
      observationsRemoved: legacyRemoval.observationsRemoved,
    },
    editedDate: datedAfter.floorSurvey.inspectionDate,
    editedNotes: datedAfter.floorSurvey.surveyNotes || '',
  };
});

check('Wrong-address Distress export is recognizable before commit', mistakeRecovery.warning && mistakeRecovery.warning.source === '59 Lodge Trail' && mistakeRecovery.warning.destination === '8 Continuation Court' && mistakeRecovery.sourceFile === 'wrong-distress.zip' && mistakeRecovery.suggested === '59 Lodge Trail', JSON.stringify(mistakeRecovery.warning));
check('Inspecting a mismatched export writes nothing', mistakeRecovery.unchangedPins === 0 && mistakeRecovery.unchangedAddress === '8 Continuation Court', JSON.stringify(mistakeRecovery));
check('Imported Distress can be removed without deleting customer or Floor Survey', mistakeRecovery.distressRemoval.observations === 1 && mistakeRecovery.distressRemoval.pins === 0 && JSON.stringify(mistakeRecovery.distressRemoval.floorPoints) === JSON.stringify(mistakeRecovery.distressRemoval.floorPointsBefore) && mistakeRecovery.distressRemoval.name.join('|') === 'Ada|Field|8 Continuation Court' && mistakeRecovery.distressRemoval.customerClock === '2026-04-01T00:00:00.000Z' && mistakeRecovery.distressRemoval.floorImportRemains && mistakeRecovery.distressRemoval.distressImportGone, JSON.stringify(mistakeRecovery.distressRemoval));
check('Distress removal deletes only that component’s unreferenced media', mistakeRecovery.distressRemoval.photoGone && mistakeRecovery.distressRemoval.floorPlanKept && mistakeRecovery.distressRemoval.distressPlanGone && mistakeRecovery.distressRemoval.photos === 1, JSON.stringify(mistakeRecovery.distressRemoval));
check('Imported Floor Survey can be removed without deleting customer or Distress', mistakeRecovery.floorRemoval.readings === 2 && mistakeRecovery.floorRemoval.pins === 1 && mistakeRecovery.floorRemoval.photoKept && mistakeRecovery.floorRemoval.distressPlanKept && mistakeRecovery.floorRemoval.name.join('|') === 'Ada|Field|8 Continuation Court' && mistakeRecovery.floorRemoval.distressImportRemains && mistakeRecovery.floorRemoval.floorLayers === 0, JSON.stringify(mistakeRecovery.floorRemoval));
check('Floor metadata written by the import is restored when that was the only Floor Survey', mistakeRecovery.floorRemoval.metadataRestored && mistakeRecovery.floorRemoval.date === '' && mistakeRecovery.floorRemoval.notes === '' && mistakeRecovery.floorRemoval.surfaces.length === 0, JSON.stringify(mistakeRecovery.floorRemoval));
check('A survey date edited after import is not rolled back', mistakeRecovery.editedDate === '2026-09-01' && mistakeRecovery.editedNotes === '', JSON.stringify({ date: mistakeRecovery.editedDate, notes: mistakeRecovery.editedNotes }));
check('Later photographs block Distress removal before anything is deleted', /later field work/.test(mistakeRecovery.blocked.error) && mistakeRecovery.blocked.pins === 1 && mistakeRecovery.blocked.photos.indexOf('ph_field_later') !== -1 && mistakeRecovery.blocked.sameClock, JSON.stringify(mistakeRecovery.blocked));
check('Photo bytes still used by another Customer File are not deleted', mistakeRecovery.shared.photosKeptShared === 1 && mistakeRecovery.shared.photoRemains && mistakeRecovery.shared.holderStillReferences && mistakeRecovery.shared.pins === 0 && mistakeRecovery.shared.planGone && mistakeRecovery.shared.neighborRemains, JSON.stringify(mistakeRecovery.shared));
check('Legacy canvas provenance removes imported pins and keeps later observations', mistakeRecovery.legacy.observationsRemoved === 1 && mistakeRecovery.legacy.keptObservations === 1 && mistakeRecovery.legacy.kept.join(',') === 'native-pin', JSON.stringify(mistakeRecovery.legacy));

await page.goto(`${BASE}#/file/cf-preview-warn/import`, { waitUntil: 'networkidle0' });
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.waitForSelector('#cf-import-file');
const previewUiCase = await page.evaluate(async () => {
  const zip = new JSZip();
  const root = zip.folder('59_Lodge_Trail');
  const canvas = document.createElement('canvas');
  canvas.width = 80;
  canvas.height = 60;
  canvas.getContext('2d').fillRect(0, 0, 80, 60);
  const plan = canvas.toDataURL('image/png');
  root.file('plan.png', plan.split(',')[1], { base64: true });
  root.file('pins.json', JSON.stringify([{
    id: 'legacy-ui',
    num: 1,
    type: 'Interior',
    description: 'Wrong house crack',
    room: 'Kitchen',
    direction: 'N',
    x: '0.5',
    y: '0.4',
    photos: [],
  }]));
  const file = new File([await zip.generateAsync({ type: 'blob' })], 'wrong-distress.zip', { type: 'application/zip' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.querySelector('#cf-import-file');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForSelector('#cf-import-confirm');
const mismatchPreview = await page.evaluate(async () => {
  const before = await ToolboxDB.getCustomerFile('cf-preview-warn');
  return {
    text: document.querySelector('.cf-import__preview')?.innerText || '',
    pins: before.distress ? (before.distress.pins || []).length : 0,
    address: before.propertyAddress,
    updatedAt: before.updatedAt,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
});
check('Preview shows Distress identity and warns before write', /Distress Survey/.test(mismatchPreview.text) && /wrong-distress\.zip/.test(mismatchPreview.text) && /59 Lodge Trail/.test(mismatchPreview.text) && /8 Continuation Court/.test(mismatchPreview.text) && /Nothing has been written/.test(mismatchPreview.text) && /Observations\s+1/.test(mismatchPreview.text) && mismatchPreview.pins === 0, mismatchPreview.text.replace(/\n/g, ' | '));
check('Mismatch preview stays inside the phone width', !mismatchPreview.overflow, JSON.stringify({ overflow: mismatchPreview.overflow }));
await page.screenshot({ path: '/opt/cursor/artifacts/import-mismatch-preview-phone.png', fullPage: true });
await page.click('#cf-import-cancel');
const afterCancel = await page.evaluate(async () => {
  const record = await ToolboxDB.getCustomerFile('cf-preview-warn');
  return {
    status: document.querySelector('#cf-import-status')?.textContent || '',
    preview: document.querySelector('.cf-import__preview')?.innerText || '',
    pins: record.distress ? (record.distress.pins || []).length : 0,
    updatedAt: record.updatedAt,
    address: record.propertyAddress,
  };
});
check('Cancel at preview writes nothing', afterCancel.status === 'Nothing was imported.' && afterCancel.preview === '' && afterCancel.pins === 0 && afterCancel.updatedAt === mismatchPreview.updatedAt && afterCancel.address === '8 Continuation Court', JSON.stringify(afterCancel));

await page.evaluate(async () => {
  const zip = new JSZip();
  const root = zip.folder('8_Continuation_Court');
  const canvas = document.createElement('canvas');
  canvas.width = 80;
  canvas.height = 60;
  canvas.getContext('2d').fillRect(0, 0, 80, 60);
  root.file('plan.png', canvas.toDataURL('image/png').split(',')[1], { base64: true });
  root.file('pins.json', JSON.stringify([{
    id: 'legacy-right-ui',
    num: 1,
    type: 'Interior',
    description: 'Right house crack',
    room: 'Kitchen',
    direction: 'N',
    x: '0.25',
    y: '0.25',
    photos: [],
  }]));
  const file = new File([await zip.generateAsync({ type: 'blob' })], 'right-distress.zip', { type: 'application/zip' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.querySelector('#cf-import-file');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForSelector('#cf-import-confirm');
const matchedPreview = await page.evaluate(() => document.querySelector('.cf-import__preview')?.innerText || '');
check('Matching address does not show a mismatch warning', /8 Continuation Court/.test(matchedPreview) && !/Nothing has been written/.test(matchedPreview) && /right-distress\.zip/.test(matchedPreview), matchedPreview.replace(/\n/g, ' | '));
await page.click('#cf-import-confirm');
await page.waitForSelector('#cf-import-open');
const confirmed = await page.evaluate(async () => {
  const record = await ToolboxDB.getCustomerFile('cf-preview-warn');
  return {
    open: document.querySelector('#cf-import-open')?.textContent || '',
    replace: document.querySelector('#cf-import-replace')?.textContent || '',
    remove: document.querySelector('#cf-import-remove')?.textContent || '',
    fileStillThere: !!document.querySelector('#cf-import-file'),
    pins: record.distress.pins.length,
    address: record.propertyAddress,
    name: record.firstName + ' ' + record.lastName,
  };
});
check('Confirmed import still writes the matching Distress Survey', confirmed.pins === 1 && confirmed.address === '8 Continuation Court' && confirmed.name === 'Ada Field' && confirmed.open === 'Open Distress Survey' && confirmed.replace === 'Replace imported Distress Survey' && confirmed.remove === 'Remove imported Distress Survey' && confirmed.fileStillThere, JSON.stringify(confirmed));
await page.click('#cf-import-remove');
await page.waitForSelector('#cf-import-removal-confirm');
const removalConfirm = await page.evaluate(() => ({
  text: document.querySelector('.cf-import__preview')?.innerText || '',
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
}));
check('Removal confirmation states what stays and what goes', /Remove imported Distress Survey/.test(removalConfirm.text) && /1 recovered observation/.test(removalConfirm.text) && /Customer information will not be changed/.test(removalConfirm.text) && /Floor Survey will not be changed/.test(removalConfirm.text), removalConfirm.text.replace(/\n/g, ' | '));
check('Removal confirmation stays inside the phone width', !removalConfirm.overflow, JSON.stringify(removalConfirm));
await page.screenshot({ path: '/opt/cursor/artifacts/import-removal-confirm-phone.png', fullPage: true });
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
await page.screenshot({ path: '/opt/cursor/artifacts/import-removal-confirm-desktop.png', fullPage: true });
await page.click('#cf-import-removal-confirm');
await page.waitForFunction(() => /This Customer File was kept/.test(document.querySelector('#cf-import-status')?.textContent || ''));
const afterUiRemoval = await page.evaluate(async () => {
  const record = await ToolboxDB.getCustomerFile('cf-preview-warn');
  return {
    status: document.querySelector('#cf-import-status')?.textContent || '',
    pins: record.distress.pins.length,
    address: record.propertyAddress,
    name: record.firstName + ' ' + record.lastName,
    imports: (record.recoveryImports || []).length,
  };
});
check('Confirmed removal keeps the Customer File and clears the imported Distress Survey', afterUiRemoval.pins === 0 && afterUiRemoval.address === '8 Continuation Court' && afterUiRemoval.name === 'Ada Field' && afterUiRemoval.imports === 0 && /kept/.test(afterUiRemoval.status), JSON.stringify(afterUiRemoval));

const lodgeRecovery = await page.evaluate(async () => {
  async function readIds(ids) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pgg_photos_v1', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const values = await Promise.all(ids.map((id) => new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readonly');
      const request = tx.objectStore('photos').get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    })));
    db.close();
    return values;
  }
  const plain = await ToolboxCustomerFileImport.inspectFile(await window.__importFixtures.lodgeStyleFile());
  const mac = await ToolboxCustomerFileImport.inspectFile(await window.__importFixtures.lodgeStyleFile({ appleDouble: true }));
  const bom = await ToolboxCustomerFileImport.inspectFile(await window.__importFixtures.lodgeStyleFile({ bom: true }));
  const context = await ToolboxCustomerFileImport.getImportContext(plain, 'import-lodge');
  const result = await ToolboxCustomerFileImport.applyImport(plain, 'import-lodge', {
    targetUpdatedAt: context.targetUpdatedAt,
    canvasChoice: 'new',
    fieldChoices: {},
  });
  const record = await ToolboxDB.getCustomerFile('import-lodge');
  const pinIds = record.distress.pins.flatMap((pin) => pin.photos);
  const quickIds = record.distress.quickCapture.map((item) => item.id);
  const pinBytes = await readIds(pinIds);
  const quickBytes = await readIds(quickIds);
  return {
    plain: {
      pins: plain.pins.map((pin) => [pin.num, pin.xNormalized, pin.yNormalized, pin.photos.map((photo) => photo.sourceName).join('+'), pin.description]),
      excluded: plain.excludedObservations.length,
      quick: plain.quickCapture.files.map((file) => file.sourceName),
    },
    macPins: mac.pins.length,
    macPhotos: mac.attachedPhotoCount,
    macQuick: mac.quickCapture.count,
    macExcluded: mac.excludedObservations.length,
    bomPins: bom.pins.length,
    bomPhotos: bom.attachedPhotoCount,
    saved: record.distress.pins.map((pin) => [pin.num, pin.x, pin.y, pin.photos.length, pin.description, pin.canvasId === record.distress.activeCanvasId]),
    quick: record.distress.quickCapture.map((item) => [item.sourceName, item.timestamp, item.latitude]),
    pinBytesOk: pinBytes.every((value) => typeof value === 'string' && value.indexOf('data:image/jpeg') === 0),
    quickBytesOk: quickBytes.every((value) => typeof value === 'string' && value.indexOf('data:image/jpeg') === 0),
    quickNotOnPins: !pinIds.some((id) => quickIds.includes(id)),
    observations: result.observations,
    photos: result.photos,
    quickCount: result.quickCaptureCount,
  };
});
check(
  'Lodge-style pins.json keeps original coordinates and photo names',
  lodgeRecovery.plain.excluded === 0 &&
    lodgeRecovery.plain.pins[0].join('|') === '1|0.25|0.4|photo-01.jpg|Crack at window' &&
    lodgeRecovery.plain.pins[1].join('|') === '2|0.5|0.6|photo-02.jpg+photo-03.jpg|Brick separation' &&
    lodgeRecovery.plain.quick.join(',') === 'quick-01.jpg,quick-02.jpg,quick-03.jpg',
  JSON.stringify(lodgeRecovery.plain),
);
check(
  'Mac resource-fork pins.json and a BOM do not drop the survey',
  lodgeRecovery.macPins === 2 &&
    lodgeRecovery.macPhotos === 3 &&
    lodgeRecovery.macQuick === 3 &&
    lodgeRecovery.macExcluded === 0 &&
    lodgeRecovery.bomPins === 2 &&
    lodgeRecovery.bomPhotos === 3,
  JSON.stringify({ mac: [lodgeRecovery.macPins, lodgeRecovery.macPhotos, lodgeRecovery.macQuick], bom: lodgeRecovery.bomPins }),
);
check(
  'Lodge-style import writes pin pixels, both photo folders, and no invented links',
  lodgeRecovery.observations === 2 &&
    lodgeRecovery.photos === 3 &&
    lodgeRecovery.quickCount === 3 &&
    lodgeRecovery.saved[0][0] === 1 &&
    lodgeRecovery.saved[0][1] === 50 &&
    lodgeRecovery.saved[0][2] === 48 &&
    lodgeRecovery.saved[0][3] === 1 &&
    lodgeRecovery.saved[0][5] === true &&
    lodgeRecovery.saved[1][0] === 2 &&
    lodgeRecovery.saved[1][1] === 100 &&
    lodgeRecovery.saved[1][2] === 72 &&
    lodgeRecovery.saved[1][3] === 2 &&
    lodgeRecovery.pinBytesOk &&
    lodgeRecovery.quickBytesOk &&
    lodgeRecovery.quickNotOnPins &&
    lodgeRecovery.quick[0][0] === 'quick-01.jpg' &&
    lodgeRecovery.quick[0][1] === '2026-07-28T10:00:00Z' &&
    lodgeRecovery.quick[0][2] === '35.1',
  JSON.stringify(lodgeRecovery),
);

const folderDownload = await page.evaluate(async () => {
  function openPhotos() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('pgg_photos_v1', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }
  async function readPhoto(db, id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readonly');
      const request = tx.objectStore('photos').get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }
  async function putPhoto(db, id, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').put(value, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  const record = await ToolboxDB.getCustomerFile('import-lodge');
  const before = JSON.stringify({
    pins: record.distress.pins,
    quick: record.distress.quickCapture,
    sources: record.distress.photoSources,
  });
  const pack = await ToolboxRecoveredPhotos.buildDownload(record);
  const after = await ToolboxDB.getCustomerFile('import-lodge');
  const db = await openPhotos();
  const sample = await readPhoto(db, record.distress.pins[0].photos[0]);
  await putPhoto(db, 'ph_field_pin', sample);
  await putPhoto(db, 'ph_field_qc', sample);
  db.close();
  const fieldPack = await ToolboxRecoveredPhotos.buildDownload({
    distress: {
      pins: [{ id: 'pin-new', num: 4, photos: ['ph_field_pin'], description: 'New crack' }],
      quickCapture: [{ id: 'ph_field_qc', ts: Date.parse('2026-08-01T15:04:05Z'), lat: 35.2, lng: -106.4 }],
      photoSources: { ph_field_pin: 'new-crack.jpg' },
    },
  });
  return {
    unchanged: before === JSON.stringify({
      pins: after.distress.pins,
      quick: after.distress.quickCapture,
      sources: after.distress.photoSources,
    }),
    paths: pack.entries.map((entry) => entry.path),
    csv: pack.csv,
    matches: pack.entries.every((entry) => entry.matchesStored),
    zipRoundTrip: pack.zipRoundTrip && pack.csvStored,
    fieldPaths: fieldPack.entries.map((entry) => entry.path),
    fieldCsv: fieldPack.csv,
    fieldMatches: fieldPack.entries.every((entry) => entry.matchesStored) && fieldPack.zipRoundTrip,
  };
});
check(
  'Photo folder download copies original bytes and leaves the Customer File unchanged',
  folderDownload.unchanged &&
    folderDownload.matches &&
    folderDownload.zipRoundTrip &&
    folderDownload.paths.join(',') === 'distress-photos/photo-01.jpg,distress-photos/photo-02.jpg,distress-photos/photo-03.jpg,quick-capture/quick-01.jpg,quick-capture/quick-02.jpg,quick-capture/quick-03.jpg' &&
    /Distress photos,photo-01\.jpg,1,Crack at window/.test(folderDownload.csv) &&
    /Quick Capture,quick-01\.jpg,,,2026-07-28T10:00:00Z,35\.1,-106\.2/.test(folderDownload.csv),
  JSON.stringify({ paths: folderDownload.paths, csv: folderDownload.csv, matches: folderDownload.matches }),
);
check(
  'A newly captured Quick Capture photo downloads beside its Distress photo',
  folderDownload.fieldMatches &&
    folderDownload.fieldPaths.join(',') === 'distress-photos/new-crack.jpg,quick-capture/quick-1.jpg' &&
    /Distress photos,new-crack\.jpg,4,New crack/.test(folderDownload.fieldCsv) &&
    /Quick Capture,quick-1\.jpg,,,2026-08-01T15:04:05\.000Z,35\.2,-106\.4/.test(folderDownload.fieldCsv),
  JSON.stringify({ paths: folderDownload.fieldPaths, csv: folderDownload.fieldCsv }),
);

await page.goto(`${BASE}#/file/import-lodge/distress`, { waitUntil: 'networkidle0' });
await page.waitForSelector('iframe');
await page.waitForFunction(() => {
  const frame = document.querySelector('iframe');
  try {
    const sub = frame && frame.contentDocument && frame.contentDocument.getElementById('wSub');
    return sub && /2 pins/.test(sub.textContent || '');
  } catch (_) {
    return false;
  }
});
const lodgeDistress = await page.evaluate(() => {
  const doc = document.querySelector('iframe').contentDocument;
  const menuBtn = doc.getElementById('openPhotoFolders');
  return {
    sub: doc.getElementById('wSub').textContent,
    foldersVisible: !!(menuBtn && !menuBtn.hidden),
    apps: document.querySelectorAll('.cf-app-btn').length,
  };
});
check(
  'Imported Distress opens with the recovered pin and photo counts',
  lodgeDistress.sub === 'internal · 2 pins · 3 pics' && lodgeDistress.foldersVisible,
  JSON.stringify(lodgeDistress),
);
await page.evaluate(() => {
  document.querySelector('iframe').contentDocument.getElementById('openPhotoFolders').click();
});
await page.waitForSelector('.photo-folders__card');
const fromDistress = await page.evaluate(() => ({
  title: document.querySelector('#photo-folders-title')?.textContent || '',
  cards: document.querySelectorAll('.photo-folders__card').length,
}));
check(
  'Distress Photo folders opens the recovered pin photos without adding them to the plan',
  fromDistress.title === 'Photo folders' && fromDistress.cards === 3,
  JSON.stringify(fromDistress),
);
await page.click('#photo-folders-close');
await page.waitForFunction(() => !document.querySelector('.photo-folders'));

await page.evaluate(() => { window.location.hash = '#/file/import-lodge'; });
await page.waitForSelector('#home-photo-folders', { timeout: 10000 });
const homeGrid = await page.evaluate(() => ({
  apps: [...document.querySelectorAll('.cf-app-btn')].map((btn) => btn.getAttribute('data-app')),
  folders: document.querySelector('#home-photo-folders')?.innerText || '',
}));
check(
  'Customer File home keeps the 2×2 workspaces and offers photo folders',
  homeGrid.apps.join(',') === 'distress,floor,diagnostics,report' &&
    /Photo folders/.test(homeGrid.folders) &&
    /3 Distress photos/.test(homeGrid.folders) &&
    /3 Quick Capture/.test(homeGrid.folders),
  JSON.stringify(homeGrid),
);

async function shootFolders(width, height, name) {
  await page.setViewport({ width, height, deviceScaleFactor: width < 500 ? 2 : 1 });
  await page.click('#home-photo-folders');
  await page.waitForSelector('.photo-folders__card');
  const state = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.photo-folders__card')].map((card) => card.innerText.replace(/\s+/g, ' ').trim());
    const panel = document.querySelector('.photo-folders__panel').getBoundingClientRect();
    const close = document.querySelector('#photo-folders-close').getBoundingClientRect();
    const downloadAll = document.querySelector('#photo-folders-download-all').getBoundingClientRect();
    const one = document.querySelector('#photo-folders-download-one').getBoundingClientRect();
    return {
      cards,
      note: document.querySelector('.photo-folders__note')?.textContent || '',
      oneLabel: document.querySelector('#photo-folders-download-one')?.textContent || '',
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      closeInside: close.right <= panel.right + 1 && close.top >= panel.top - 1,
      downloadInside: downloadAll.right <= panel.right + 1 && downloadAll.top >= panel.top - 1 && downloadAll.height >= 40,
      oneInside: one.top >= panel.top - 1 && one.left >= panel.left - 1 && one.right <= panel.right + 1,
      gridApps: document.querySelectorAll('.cf-app-btn').length,
    };
  });
  check(
    'Photo folders stay usable at ' + name,
    state.cards[0].includes('photo-01.jpg') &&
      state.cards[0].includes('Pin 1') &&
      state.cards.length === 3 &&
      /not placed on the plan/.test(state.note) &&
      state.oneLabel === 'Download' &&
      !state.overflow &&
      state.closeInside &&
      state.downloadInside &&
      state.oneInside &&
      state.gridApps === 4,
    JSON.stringify(state),
  );
  await page.waitForFunction(() => {
    const img = document.querySelector('.photo-folders__viewer img');
    return !!(img && img.getAttribute('src') && img.getAttribute('src').indexOf('data:image/') === 0);
  });
  await page.screenshot({ path: '/opt/cursor/artifacts/photo-folders-pins-' + name + '.png', fullPage: true });
  await page.click('[data-photo-folder="quick"]');
  await page.waitForFunction(() => /quick-01\.jpg/.test(document.body.innerText));
  const quick = await page.evaluate(() => ({
    cards: [...document.querySelectorAll('.photo-folders__card')].map((card) => card.innerText.replace(/\s+/g, ' ').trim()),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  check(
    'Quick Capture folder is separate at ' + name,
    quick.cards.length === 3 &&
      quick.cards[0].includes('quick-01.jpg') &&
      quick.cards.every((card) => !/Pin /.test(card)) &&
      !quick.overflow,
    JSON.stringify(quick),
  );
  await page.waitForFunction(() => {
    const img = document.querySelector('.photo-folders__viewer img');
    return !!(img && img.getAttribute('src') && img.getAttribute('src').indexOf('data:image/') === 0);
  });
  await page.screenshot({ path: '/opt/cursor/artifacts/photo-folders-quick-' + name + '.png', fullPage: true });
  await page.click('#photo-folders-close');
  await page.waitForFunction(() => !document.querySelector('.photo-folders'));
}

await shootFolders(390, 844, 'phone');
await shootFolders(834, 1112, 'ipad');
await shootFolders(1280, 800, 'desktop');

await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await page.click('#home-photo-folders');
await page.waitForSelector('#photo-folders-download-all');
const downloadClick = await page.evaluate(async () => {
  const before = await ToolboxDB.getCustomerFile('import-lodge');
  document.querySelector('#photo-folders-download-all').click();
  document.querySelector('#photo-folders-download-one').click();
  const after = await ToolboxDB.getCustomerFile('import-lodge');
  return {
    pins: after.distress.pins.length,
    quick: after.distress.quickCapture.length,
    same: JSON.stringify(before.distress) === JSON.stringify(after.distress),
  };
});
check(
  'Download buttons do not change the stored Distress photos or Quick Capture',
  downloadClick.same && downloadClick.pins === 2 && downloadClick.quick === 3,
  JSON.stringify(downloadClick),
);
await page.click('#photo-folders-close');
await page.waitForFunction(() => !document.querySelector('.photo-folders'));


const lodgeRemoval = await page.evaluate(async () => {
  async function readIds(ids) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pgg_photos_v1', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const values = await Promise.all(ids.map((id) => new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readonly');
      const request = tx.objectStore('photos').get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    })));
    db.close();
    return values;
  }
  const before = await ToolboxDB.getCustomerFile('import-lodge');
  const entry = (before.recoveryImports || []).find((item) => item.kind === 'distress');
  const photoIds = before.distress.pins.flatMap((pin) => pin.photos)
    .concat(before.distress.quickCapture.map((item) => item.id));
  const removed = await ToolboxCustomerFileImport.removeImportedComponent('import-lodge', entry.fingerprint);
  const after = await ToolboxDB.getCustomerFile('import-lodge');
  const bytes = await readIds(photoIds);
  return {
    photosRemoved: removed.photosRemoved,
    pins: (after.distress.pins || []).length,
    quick: (after.distress.quickCapture || []).length,
    sources: Object.keys(after.distress.photoSources || {}).length,
    imports: (after.recoveryImports || []).length,
    bytesGone: bytes.every((value) => value == null),
  };
});
check(
  'Removing the imported Distress Survey also clears its Quick Capture photos',
  lodgeRemoval.photosRemoved === 6 &&
    lodgeRemoval.pins === 0 &&
    lodgeRemoval.quick === 0 &&
    lodgeRemoval.sources === 0 &&
    lodgeRemoval.imports === 0 &&
    lodgeRemoval.bytesGone,
  JSON.stringify(lodgeRemoval),
);

async function chooseLegacyFile(kind, overrides) {
  await page.evaluate(async (spec) => {
    const file = spec.kind === 'distress'
      ? await window.__importFixtures.distressFile()
      : await window.__importFixtures.floorFile(1, spec.overrides || {});
    const input = document.querySelector('#cf-import-file');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { kind, overrides });
}

async function readContinuationRecord(id) {
  return page.evaluate(async (fileId) => {
    const record = await ToolboxDB.getCustomerFile(fileId);
    if (!record) return null;
    const floorLayers = record.floorSurvey && record.floorSurvey.byCanvasId ? record.floorSurvey.byCanvasId : {};
    const floorPoints = Object.keys(floorLayers).reduce((sum, canvasId) => {
      const layer = floorLayers[canvasId];
      return sum + (layer && Array.isArray(layer.points) ? layer.points.length : 0);
    }, 0);
    return {
      id: record.id,
      name: [record.firstName, record.lastName].filter(Boolean).join(' '),
      address: record.propertyAddress || '',
      floorLayers: Object.keys(floorLayers).length,
      floorPoints,
      distressPins: record.distress && Array.isArray(record.distress.pins) ? record.distress.pins.length : 0,
      recoveryCount: Array.isArray(record.recoveryImports) ? record.recoveryImports.length : 0,
    };
  }, id);
}

await page.evaluate(async () => {
  const record = ToolboxApp.blankCustomerFile('continuation-ada');
  record.firstName = 'Ada';
  record.lastName = 'Field';
  record.propertyAddress = '10 Recovery Lane';
  await ToolboxDB.saveCustomerFile(record);
});
await page.goto(`${BASE}#/file/continuation-ada/import`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#cf-import-file');
await chooseLegacyFile('floor', {
  client: 'Ada Field',
  projectName: 'Field House',
  address: '10 Recovery Lane',
  fileName: 'field-house.floorsurvey.json',
});
await page.waitForSelector('#cf-import-confirm');
await page.click('#cf-import-confirm');
await page.waitForSelector('#cf-import-another');
const floorComplete = await page.evaluate(() => ({
  another: document.querySelector('#cf-import-another')?.textContent || '',
  open: document.querySelector('#cf-import-open')?.textContent || '',
  heading: document.querySelector('.cf-import__result h2')?.textContent || '',
  note: document.querySelector('.cf-import__result .cf-import__note')?.textContent || '',
}));
check('Floor recovery complete offers another legacy file and Open Floor Survey', floorComplete.another === 'Import another legacy file' && floorComplete.open === 'Open Floor Survey' && /Floor Survey imported/.test(floorComplete.heading), JSON.stringify(floorComplete));
const floorSaved = await readContinuationRecord('continuation-ada');
check('Floor recovery persisted before continuation', floorSaved && floorSaved.floorPoints === 2 && floorSaved.distressPins === 0 && floorSaved.recoveryCount === 1, JSON.stringify(floorSaved));

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.screenshot({ path: '/opt/cursor/artifacts/recovery-complete-phone.png', fullPage: true });
await page.setViewport({ width: 820, height: 1180, deviceScaleFactor: 2 });
await page.screenshot({ path: '/opt/cursor/artifacts/recovery-complete-ipad.png', fullPage: true });
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
await page.screenshot({ path: '/opt/cursor/artifacts/recovery-complete-desktop.png', fullPage: true });

const filesBeforeAnother = await page.evaluate(async () => (await ToolboxDB.getAllCustomerFiles()).map((record) => record.id));
await page.click('#cf-import-another');
await page.waitForFunction(() => !document.querySelector('.cf-import__result') && document.querySelector('#cf-import-file'));
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.screenshot({ path: '/opt/cursor/artifacts/recovery-chooser-reset-phone.png', fullPage: true });
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
const chooserReset = await page.evaluate(() => ({
  fileValue: document.querySelector('#cf-import-file')?.value || '',
  status: document.querySelector('#cf-import-status')?.textContent || '',
  createNew: !!document.querySelector('input[name="cf-import-dest-mode"][value="new"]'),
  result: !!document.querySelector('.cf-import__result'),
  preview: document.querySelector('#cf-import-preview')?.innerText || '',
}));
const floorAfterReset = await readContinuationRecord('continuation-ada');
check('Import another legacy file returns to a chooser for the same Customer File', chooserReset.fileValue === '' && /Ada Field/.test(chooserReset.status) && !chooserReset.result && !chooserReset.createNew && /Recovered imports/.test(chooserReset.preview) && /Floor Survey/.test(chooserReset.preview), JSON.stringify(chooserReset));
check('Already imported Floor Survey remains after returning to the chooser', floorAfterReset && floorAfterReset.floorPoints === 2 && floorAfterReset.recoveryCount === 1 && floorAfterReset.name === 'Ada Field', JSON.stringify(floorAfterReset));

await chooseLegacyFile('floor', {
  client: 'Blake Moss',
  projectName: 'Moss House',
  address: '22 Other Street',
  fileName: 'moss-house.floorsurvey.json',
});
await page.waitForSelector('#cf-import-confirm-floor-add');
const secondFloorGate = await page.evaluate(() => ({
  text: document.querySelector('.cf-import__preview')?.innerText || '',
  disabled: !!document.querySelector('#cf-import-confirm')?.disabled,
  destination: (document.querySelector('.cf-import__note')?.textContent || ''),
}));
const floorUntouched = await readContinuationRecord('continuation-ada');
check('Second Floor Survey preview still requires additional-level confirmation and does not write', secondFloorGate.disabled && /additional level/i.test(secondFloorGate.text) && /Ada Field/.test(secondFloorGate.destination) && floorUntouched.recoveryCount === 1 && floorUntouched.floorLayers === 1, JSON.stringify({ secondFloorGate, floorUntouched }));

await page.click('#import-back');
await page.waitForFunction(() => location.hash === '#/file/continuation-ada');
const afterBack = await readContinuationRecord('continuation-ada');
check('Back from a second-file preview leaves the completed import intact', afterBack && afterBack.floorPoints === 2 && afterBack.distressPins === 0 && afterBack.recoveryCount === 1, JSON.stringify(afterBack));

await page.goto(`${BASE}#/file/continuation-ada/import`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#cf-import-file');
await chooseLegacyFile('distress');
await page.waitForSelector('#cf-import-confirm');
const distressDestination = await page.evaluate(() => document.querySelector('.cf-import__preview')?.innerText || '');
check('Distress continuation preview stays on the same Customer File', /Ada Field/.test(distressDestination) && /10 Recovery Lane/.test(distressDestination) && !/Create new Customer File/.test(distressDestination), distressDestination.replace(/\n/g, ' | '));
await page.click('#cf-import-confirm');
await page.waitForSelector('#cf-import-another');
const distressComplete = await page.evaluate(() => ({
  another: document.querySelector('#cf-import-another')?.textContent || '',
  open: document.querySelector('#cf-import-open')?.textContent || '',
  heading: document.querySelector('.cf-import__result h2')?.textContent || '',
}));
const bothSaved = await readContinuationRecord('continuation-ada');
check('Distress recovery complete offers another legacy file and Open Distress Survey', distressComplete.another === 'Import another legacy file' && distressComplete.open === 'Open Distress Survey' && /Distress Survey imported/.test(distressComplete.heading), JSON.stringify(distressComplete));
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.screenshot({ path: '/opt/cursor/artifacts/recovery-complete-distress-phone.png', fullPage: true });
await page.setViewport({ width: 820, height: 1180, deviceScaleFactor: 2 });
await page.screenshot({ path: '/opt/cursor/artifacts/recovery-complete-distress-ipad.png', fullPage: true });
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
await page.screenshot({ path: '/opt/cursor/artifacts/recovery-complete-distress-desktop.png', fullPage: true });
check('Floor Survey remains intact after Distress is added to the same Customer File', bothSaved && bothSaved.floorPoints === 2 && bothSaved.distressPins === 2 && bothSaved.recoveryCount === 2 && bothSaved.id === 'continuation-ada', JSON.stringify(bothSaved));

await page.click('#cf-import-another');
await page.waitForFunction(() => !document.querySelector('.cf-import__result'));
await page.click('#import-back');
await page.waitForFunction(() => location.hash === '#/file/continuation-ada');
const afterDistressBack = await readContinuationRecord('continuation-ada');
check('Back after Import another leaves both recovered surveys in the Customer File', afterDistressBack && afterDistressBack.floorPoints === 2 && afterDistressBack.distressPins === 2 && afterDistressBack.name === 'Ada Field', JSON.stringify(afterDistressBack));

await page.goto(`${BASE}#/import`, { waitUntil: 'networkidle0' });
await page.waitForSelector('#cf-import-file');
const idsBeforeNew = await page.evaluate(async () => (await ToolboxDB.getAllCustomerFiles()).map((record) => record.id));
await chooseLegacyFile('floor', {
  client: 'Riley North',
  projectName: 'North House',
  address: '8 Continuation Court',
  fileName: 'north-house.floorsurvey.json',
});
await page.waitForSelector('input[name="cf-import-dest-mode"][value="new"]');
await page.click('input[name="cf-import-dest-mode"][value="new"]');
await page.waitForSelector('#cf-import-confirm');
await page.click('#cf-import-confirm');
await page.waitForSelector('#cf-import-another');
await page.click('#cf-import-another');
await page.waitForFunction(() => !document.querySelector('.cf-import__result'));
await chooseLegacyFile('distress');
await page.waitForSelector('#cf-import-confirm');
const lockedPreview = await page.evaluate(() => ({
  radios: document.querySelectorAll('input[name="cf-import-dest-mode"]').length,
  text: document.querySelector('.cf-import__preview')?.innerText || '',
}));
check('Import another after creating a Customer File does not offer a new file', lockedPreview.radios === 0 && /Riley North/.test(lockedPreview.text) && /8 Continuation Court/.test(lockedPreview.text), lockedPreview.text.replace(/\n/g, ' | '));
await page.click('#cf-import-confirm');
await page.waitForSelector('#cf-import-open');
const createdIds = await page.evaluate(async (before) => {
  const records = await ToolboxDB.getAllCustomerFiles();
  return records.filter((record) => !before.includes(record.id)).map((record) => record.id);
}, idsBeforeNew);
check('Continuation created one Customer File', createdIds.length === 1, JSON.stringify(createdIds));
const created = createdIds[0] ? await readContinuationRecord(createdIds[0]) : null;
const adaUntouched = await readContinuationRecord('continuation-ada');
check('New Customer File holds both the Floor Survey and the later Distress Survey', created && created.name === 'Riley North' && created.floorPoints === 2 && created.distressPins === 2 && created.recoveryCount === 2, JSON.stringify(created));
check('Continuing into the new Customer File left the earlier file unchanged', adaUntouched && adaUntouched.floorPoints === 2 && adaUntouched.distressPins === 2 && adaUntouched.recoveryCount === 2, JSON.stringify(adaUntouched));
check('No extra Customer File was created while continuing', filesBeforeAnother.includes('continuation-ada') && createdIds.length === 1, String(filesBeforeAnother.length));

await page.click('#cf-import-open');
await page.waitForFunction(() => /#\/file\/[^/]+\/distress$/.test(location.hash));
const openedDistress = await page.evaluate(async () => {
  const id = decodeURIComponent((location.hash.match(/^#\/file\/([^/]+)\/distress$/) || [])[1] || '');
  const record = await ToolboxDB.getCustomerFile(id);
  return {
    hash: location.hash,
    pins: record && record.distress && record.distress.pins ? record.distress.pins.length : 0,
    floorLayers: record && record.floorSurvey ? Object.keys(record.floorSurvey.byCanvasId || {}).length : 0,
  };
});
check('Open Distress Survey still leaves the recovered Customer File', /\/distress$/.test(openedDistress.hash) && openedDistress.pins === 2 && openedDistress.floorLayers >= 1, JSON.stringify(openedDistress));

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
