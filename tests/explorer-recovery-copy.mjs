/**
 * The recovery copy, unpacked and read.
 *
 * Run: node tests/explorer-recovery-copy.mjs   (needs a static server on 8765)
 *
 * Tim, on what the File Cabinet is for: "ours is potentially going to be the
 * repository for all of our job files," with "a copy downloaded to their own
 * server as backup." A backup whose filenames are storage keys is a backup
 * nobody can read, so this takes the copy the Explorer hands over, opens it,
 * and checks what is actually inside it.
 *
 * What it proves, against a synthetic Cabinet with no production data:
 *   - the folders and filenames read as a job, not as a bucket
 *   - the readings CSV and the pin list are REAL FILES, built from the stored
 *     components, with the corrected elevation from Floor Survey's own code
 *   - the CONTOUR layer is in it, which an earlier collector silently dropped
 *   - the raw records are preserved under Technical/
 *   - the README says what is in the folder AND what is not
 *   - the bytes come out usable: the PNG decodes to the picture that went in
 *   - a photograph that the Cabinet does not hold is named as missing rather
 *     than quietly left out
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const ID = '77777777-7777-4777-8777-777777777777';

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1400, height: 900 });
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.ToolboxSync && window.ToolboxFileExplorer &&
  window.ToolboxExplorerArchive && window.JSZip);

const out = await page.evaluate(async (id) => {
  const base = 'http://mock-sync.local';
  window.ToolboxConfig.syncApiBase = base;

  // A 2x1 PNG: red pixel, blue pixel. Recognisable on the way out.
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFUlEQVR42mP8z8DwnwEI' +
    'GJgYgIAJAAzOAv9Pu0FDAAAAAElFTkSuQmCC';
  const pngBytes = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));
  const pdfBytes = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

  const plans = {
    updatedAt: '2026-09-29T18:00:00.000Z',
    canvases: [
      { id: 'cv-main', name: 'Main Level', plan: { id: 'plan-main' }, contourLayer: { id: 'contour-main' } },
      { id: 'cv-base', name: 'Basement', plan: { id: 'plan-base' } },
    ],
  };
  const floor = {
    updatedAt: '2026-09-30T18:30:00.000Z',
    inspectionDate: '2026-09-29',
    byCanvasId: {
      'cv-main': {
        canvasId: 'cv-main',
        inspectionDate: '2026-09-30',
        recoveryPdfMediaId: 'fsrec_main',
        transitions: [{ id: 't1', surfaceA: 'Tile', surfaceB: 'Carpet/subfloor', readingA: 7.2, readingB: 6.8 }],
        points: [
          { id: 'p1', index: 1, x: 10, y: 10, value: 9.0, isBasePoint: true, label: 'BP1' },
          { id: 'p2', index: 2, x: 60, y: 10, value: 8.1 },
          { id: 'p3', index: 3, x: 110, y: 10, value: 6.5, transitionId: 't1' },
        ],
      },
      'cv-base': {
        canvasId: 'cv-base',
        inspectionDate: '2026-09-29',
        points: [{ id: 'b1', index: 1, x: 5, y: 5, value: 9.0, isBasePoint: true, label: 'BP1' }],
      },
    },
  };
  const distress = {
    updatedAt: '2026-10-01T12:00:00.000Z',
    inspectionDate: '2026-10-01',
    pins: [
      { id: 'pin-1', num: 1, canvasId: 'cv-main', location: 'Front entry',
        description: 'Separation at the sill', photos: ['ph_one'] },
      { id: 'pin-2', num: 2, canvasId: 'cv-base', location: 'Utility',
        description: 'Step crack', photos: ['ph_gone'] },
    ],
    quickCapture: [{ id: 'ph_quick', ts: Date.parse('2026-10-01T17:45:12.000Z'), folder: 'Exterior' }],
  };
  const customer = {
    firstName: 'Rhonda',
    lastName: 'Sorenson',
    propertyAddress: '4925 Edwards Dr NE\nAlbuquerque, NM 87111',
    cellPhone: '505-555-0144',
    email: 'rhonda@example.com',
    customerUpdatedAt: '2026-10-01T12:00:00.000Z',
  };
  const report = { updatedAt: '2026-10-19T20:45:00.000Z', pages: [{ id: 'p1', type: 'cover' }] };
  const indexDoc = {
    id: id,
    displayName: 'Rhonda Sorenson',
    propertyAddress: '4925 Edwards Dr NE',
    fieldWorkDate: '2026-09-30',
    createdAt: '2026-09-01T00:00:00.000Z',
  };

  // What the Cabinet reports it holds. ph_gone is referenced by pin 2 and is
  // NOT stored -- the case an archive must not paper over.
  const objects = [
    { key: `cf/${id}/index.json`, contentType: 'application/json', purpose: 'technical', label: 'Cabinet index' },
    { key: `cf/${id}/customer.json`, contentType: 'application/json', purpose: 'customer', label: 'Customer information' },
    { key: `cf/${id}/plans.json`, contentType: 'application/json', purpose: 'plans', label: 'Plans and canvases' },
    { key: `cf/${id}/floor.json`, contentType: 'application/json', purpose: 'floor', label: 'Floor Survey' },
    { key: `cf/${id}/distress.json`, contentType: 'application/json', purpose: 'distress', label: 'Distress Survey' },
    { key: `cf/${id}/report.json`, contentType: 'application/json', purpose: 'report', label: 'Report Builder' },
    { key: 'media/plan-main', contentType: 'image/png', purpose: 'plan', label: 'Floor plan — Main Level' },
    { key: 'media/plan-base', contentType: 'image/png', purpose: 'plan', label: 'Floor plan — Basement' },
    { key: 'media/contour-main', contentType: 'image/png', purpose: 'contour', label: 'Contour layer — Main Level' },
    { key: 'media/ph_one', contentType: 'image/jpeg', purpose: 'distress-photo', label: 'Distress Survey photograph' },
    { key: 'media/ph_gone', purpose: 'distress-photo', label: 'Distress Survey photograph', missing: true },
    { key: 'media/ph_quick', contentType: 'image/jpeg', purpose: 'quick-capture', label: 'Quick Capture photo — Exterior' },
    { key: 'media/fsrec_main', contentType: 'application/pdf', purpose: 'floor-pdf', label: 'Floor Survey recovery PDF — Main Level' },
  ];

  const stored = {
    [`cf/${id}/index.json`]: { type: 'application/json', body: JSON.stringify(indexDoc) },
    [`cf/${id}/customer.json`]: { type: 'application/json', body: JSON.stringify(customer) },
    [`cf/${id}/plans.json`]: { type: 'application/json', body: JSON.stringify(plans) },
    [`cf/${id}/floor.json`]: { type: 'application/json', body: JSON.stringify(floor) },
    [`cf/${id}/distress.json`]: { type: 'application/json', body: JSON.stringify(distress) },
    [`cf/${id}/report.json`]: { type: 'application/json', body: JSON.stringify(report) },
    'media/plan-main': { type: 'image/png', body: pngBytes },
    'media/plan-base': { type: 'image/png', body: pngBytes },
    'media/contour-main': { type: 'image/png', body: pngBytes },
    'media/ph_one': { type: 'image/jpeg', body: pngBytes },
    'media/ph_quick': { type: 'image/jpeg', body: pngBytes },
    'media/fsrec_main': { type: 'application/pdf', body: pdfBytes },
  };

  const fetchLog = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (url, opts) {
    const href = String(url);
    if (!href.startsWith(base)) return realFetch(url, opts);
    const method = (opts && opts.method) || 'GET';
    const path = href.slice(base.length).replace(/^\//, '');
    fetchLog.push({ method, path });
    if (path === 'explore/files') {
      return new Response(JSON.stringify({ files: [Object.assign({ key: `cf/${id}/index.json` }, indexDoc)] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (path === `explore/files/${id}`) {
      return new Response(JSON.stringify({
        id: id,
        displayName: 'Rhonda Sorenson',
        propertyAddress: '4925 Edwards Dr NE',
        fieldWorkDate: '2026-09-30',
        prefix: `cf/${id}/`,
        objects: objects,
        referenceNotes: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const match = new RegExp(`^explore/files/${id}/object\\?key=(.+)$`).exec(path);
    if (match) {
      const key = decodeURIComponent(match[1]);
      const found = stored[key];
      if (!found) return new Response('Not stored', { status: 404 });
      const raw = typeof found.body === 'string' ? new TextEncoder().encode(found.body) : found.body;
      return new Response(raw, { status: 200, headers: { 'content-type': found.type } });
    }
    return new Response('Not found', { status: 404 });
  };

  // The Save As dialog, which headless Chrome has but never answers.
  const picked = [];
  window.showSaveFilePicker = async function (options) {
    const entry = { name: (options && options.suggestedName) || 'file', chunks: [] };
    picked.push(entry);
    return {
      name: entry.name,
      createWritable: async function () {
        return new WritableStream({ write(chunk) { entry.chunks.push(chunk); } });
      },
    };
  };

  window.location.hash = '#/explore/' + encodeURIComponent(id);
  await new Promise((r) => setTimeout(r, 600));
  await new Promise((resolve) => {
    const until = Date.now() + 8000;
    const tick = function () {
      if (document.querySelector('#explorer-facts') || Date.now() > until) return resolve();
      setTimeout(tick, 100);
    };
    tick();
  });

  const factsText = (document.querySelector('#explorer-facts') || {}).innerText || '';
  const folderSays = [...document.querySelectorAll('.explorer-folder')].map((node) => node.innerText);

  const zipBtn = document.getElementById('explorer-zip');
  // The label as it actually changes, caught at the source rather than
  // sampled: twelve small objects pack faster than any polling interval, so
  // watching the button is a race and would pass or fail by luck.
  const progress = [];
  const labelProp = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  Object.defineProperty(zipBtn, 'textContent', {
    configurable: true,
    get: function () { return labelProp.get.call(this); },
    set: function (value) {
      progress.push(String(value));
      labelProp.set.call(this, value);
    },
  });
  zipBtn.click();
  await new Promise((r) => setTimeout(r, 2500));

  const entry = picked[picked.length - 1];
  const blob = new Blob(entry.chunks);
  const zip = await window.JSZip.loadAsync(blob);
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();
  const readText = async function (suffix) {
    const hit = names.filter((name) => name.endsWith(suffix))[0];
    return hit ? zip.file(hit).async('string') : '';
  };

  // Do the bytes come out usable? Decode the plan picture back to an image.
  const planName = names.filter((name) => /Plans\/Floor plan — Main Level\.png$/.test(name))[0];
  let planPixels = null;
  if (planName) {
    const planBlob = await zip.file(planName).async('blob');
    const url = URL.createObjectURL(planBlob);
    planPixels = await new Promise(function (resolve) {
      const img = new Image();
      img.onload = function () { resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
    URL.revokeObjectURL(url);
  }

  return {
    zipName: entry.name,
    names: names,
    readings: await readText('Floor Survey readings.csv'),
    pins: await readText('Distress Survey pins.csv'),
    details: await readText('Customer details.txt'),
    readme: await readText('README.txt'),
    rawFloor: await readText('Technical/Floor Survey.json'),
    planPixels: planPixels,
    notice: (document.getElementById('explorer-notice') || {}).textContent || '',
    progress: progress,
    factsText: factsText,
    folderSays: folderSays,
    browsePhase: fetchLog.slice(0, fetchLog.findIndex((e) => /archive|fsrec/.test(e.path)) + 1)
      .filter((e) => !e.path.startsWith('explore/')),
    writes: fetchLog.filter((e) => e.method !== 'GET'),
  };
}, ID);

// ------------------------------------------------ the folder reads as a job
check('the copy is named for the customer, the address and the field work date',
  out.zipName === 'Rhonda Sorenson - 4925 Edwards Dr NE (2026-09-30).zip', out.zipName);
check('and everything sits inside that one named folder',
  out.names.length > 0 &&
  out.names.every((name) => name.indexOf('Rhonda Sorenson - 4925 Edwards Dr NE (2026-09-30)/') === 0),
  JSON.stringify(out.names.slice(0, 3)));
check('the folders are the ones a person would make',
  ['Plans/', 'Photographs/Distress Survey/', 'Photographs/Quick Capture/', 'Floor Survey/', 'Technical/']
    .every((folder) => out.names.some((name) => name.indexOf('/' + folder) > 0)),
  JSON.stringify(out.names));

// ------------------------------------------- the files the copy makes itself
check('the readings CSV is a real file with a row per reading',
  out.readings.trim().split('\r\n').length === 5 &&
  out.readings.indexOf('Level,Point,Label,X (plan),Y (plan),Reading (in)') === 0,
  JSON.stringify(out.readings.slice(0, 70)));
check('and the corrected elevation is in it, from Floor Survey’s own code',
  out.readings.indexOf('Main Level,3,,110,10,6.5,0.4,6.9,') >= 0,
  out.readings.trim().split('\r\n')[3]);
check('the pin list names each pin, its level, its room and its photographs',
  out.pins.indexOf('1,Main Level,Front entry,Separation at the sill,1,ph_one') >= 0 &&
  out.pins.indexOf('2,Basement,Utility,Step crack,1,ph_gone') >= 0,
  JSON.stringify(out.pins));
check('customer details are a page a person reads',
  out.details.indexOf('Rhonda Sorenson') === 0 &&
  out.details.indexOf('Cell    505-555-0144') > 0, JSON.stringify(out.details.slice(0, 40)));

// ------------------------------- every referenced picture, contour included
check('the contour layer is in the copy, not silently dropped',
  out.names.some((name) => /Plans\/Contour layer — Main Level\.png$/.test(name)),
  JSON.stringify(out.names.filter((name) => name.indexOf('/Plans/') > 0)));
check('a Distress photograph is named by its pin and its room, not its key',
  out.names.some((name) => /Photographs\/Distress Survey\/pin-01-front-entry/.test(name)),
  JSON.stringify(out.names.filter((name) => name.indexOf('Distress Survey/') > 0)));
check('a Quick Capture is named for the moment it was taken',
  out.names.some((name) => /Photographs\/Quick Capture\/2026-10-01_\d{6}\.jpg$/.test(name)),
  JSON.stringify(out.names.filter((name) => name.indexOf('Quick Capture/') > 0)));
check('the Floor Survey recovery PDF travels with it',
  out.names.some((name) => /Floor Survey\/Floor Survey recovery PDF — Main Level\.pdf$/.test(name)),
  JSON.stringify(out.names.filter((name) => name.indexOf('/Floor Survey/') > 0)));

// ------------------------------------------------- the raw records survive
check('the records Toolbox writes are preserved under Technical',
  ['Cabinet index.json', 'Floor Survey.json', 'Distress Survey.json', 'Plans and canvases.json',
    'Customer information.json', 'Report Builder.json']
    .every((name) => out.names.some((entry) => entry.endsWith('/Technical/' + name))),
  JSON.stringify(out.names.filter((name) => name.indexOf('/Technical/') > 0)));
check('and they are the stored bytes, not a rewrite of them',
  out.rawFloor.indexOf('"byCanvasId"') > 0 && JSON.parse(out.rawFloor).inspectionDate === '2026-09-29',
  JSON.stringify(out.rawFloor.slice(0, 40)));

// --------------------------------------------------------- honesty, in full
check('the README says what the survey records',
  out.readme.indexOf('Readings') > 0 && out.readme.indexOf('Biggest fall') > 0, 'figures');
check('and names the photograph the Cabinet does not hold',
  out.readme.indexOf('What is NOT in this folder') > 0 &&
  /Distress Survey photograph/.test(out.readme.split('What is NOT in this folder')[1] || ''),
  JSON.stringify((out.readme.split('What is NOT in this folder')[1] || '').slice(0, 200)));
check('and does not pretend a report PDF was ever printed',
  /A finished report PDF\. Toolbox prints the report from the/.test(out.readme),
  'no fabricated report');
check('and explains the readings file to someone who has never seen Toolbox',
  out.readme.indexOf('Reading (in) is what the instrument showed') > 0, 'explained');

// -------------------------------------------------------- usable bytes out
check('the plan picture comes out of the copy as a usable image',
  !!out.planPixels && out.planPixels.w === 2 && out.planPixels.h === 1,
  JSON.stringify(out.planPixels));

// --------------------------------------------- truthful progress and count
check('the button counts its way through, rather than sitting there',
  out.progress.indexOf('Packing 1 of 12…') > 0 &&
  out.progress.indexOf('Packing 12 of 12…') > out.progress.indexOf('Packing 1 of 12…') &&
  out.progress.indexOf('Saving…') > out.progress.indexOf('Packing 12 of 12…') &&
  out.progress[out.progress.length - 1] === 'Download job copy',
  JSON.stringify(out.progress));
check('and the notice says how many went in, truthfully',
  /12 of 12 stored files packed/.test(out.notice), out.notice);

// ------------------------------------------------- the screen says it first
check('the job view leads with what the job records',
  out.factsText.indexOf('What this job records') === 0 &&
  /READINGS\s*4/.test(out.factsText) && /PINS\s*2/.test(out.factsText) &&
  /BIGGEST FALL\s*2\.1 in on Main Level/.test(out.factsText),
  JSON.stringify(out.factsText.replace(/\n/g, ' | ')));
check('and each folder says what is inside it before you walk in',
  out.folderSays.some((text) => /2 levels/.test(text)) &&
  out.folderSays.some((text) => /on 2 pins/.test(text)),
  JSON.stringify(out.folderSays));

// --------------------------------------------- the back door stays a door
check('nothing in any of this was a write',
  out.writes.length === 0, JSON.stringify(out.writes));
check('and browsing never left the read-only explore route',
  out.browsePhase.length === 0, JSON.stringify(out.browsePhase));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
