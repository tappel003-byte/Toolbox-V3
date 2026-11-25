/**
 * Distress Annotate → Report Builder: host must persist photoStrokes before
 * "Back to Report Builder" tears down the iframe, and Report Builder must
 * composite those strokes onto Pictures evidence.
 *
 * Run: node tests/distress-annotate-return.mjs
 * Requires static server at http://127.0.0.1:8765 (repo root).
 */
import { createRequire } from 'module';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

await mkdir(OUT, { recursive: true });

// Structural: return-to-report awaits hostPersistSurvey (the live bug).
const surveySrc = await readFile(path.join(ROOT, 'distress-survey/survey.html'), 'utf8');
const returnFn = surveySrc.match(/function hostNotifyReturnToReport\(\) \{[\s\S]*?\n\}/);
check('hostNotifyReturnToReport defined', !!returnFn);
if (returnFn) {
  check(
    'return-to-report awaits hostPersistSurvey before leave',
    /hostPersistSurvey\s*\(\s*\)\s*\.finally/.test(returnFn[0]) &&
      /__toolboxDistressReturnToReport/.test(returnFn[0]),
    returnFn[0].slice(0, 200).replace(/\s+/g, ' '),
  );
  check(
    'return-to-report does not leave synchronously when project open',
    !/function hostNotifyReturnToReport\(\) \{\s*const p = hostParent\(\);\s*if \(p && typeof p\.__toolboxDistressReturnToReport/.test(returnFn[0]),
  );
}
check(
  'saveAnnotate awaits host persist in HOST_MODE',
  /function saveAnnotate\(\) \{[\s\S]*?HOST_MODE[\s\S]*?hostPersistSurvey[\s\S]*?toast\('Annotations saved'\)/.test(surveySrc),
);

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

const logic = await page.evaluate(async () => {
  const out = [];
  function assert(name, cond, detail) {
    out.push({ name, ok: !!cond, detail: detail || '' });
  }

  // Pale plate + red rect stroke — same shape as report-distress-annotate.
  const c = document.createElement('canvas');
  c.width = 200;
  c.height = 150;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8e4dc';
  ctx.fillRect(0, 0, 200, 150);
  const plain = c.toDataURL('image/jpeg', 0.95);
  const photoId = 'ph_host_annotate_1';

  // Distress media store (pgg_photos_v1) — where capture writes bytes.
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('pgg_photos_v1', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').put(plain, photoId);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });

  const record = window.ToolboxApp.blankCustomerFile('ds-annotate-host');
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Field';
  record.lastName = 'Annotate';
  record.propertyAddress = '12 Stroke Lane\nAlbuquerque, NM';
  const canvasId = record.planSetup.canvases[0].id;
  await window.ToolboxDB.putMedia('plan-annotate-host', plain);
  record.planSetup.canvases[0].plan = { id: 'plan-annotate-host', width: 400, height: 300 };
  record.distress = {
    mode: 'internal',
    startNum: 1,
    nextNum: 2,
    activeCanvasId: canvasId,
    pins: [{
      id: 'pin-a',
      num: 1,
      x: 100,
      y: 100,
      canvasId,
      location: 'Hall',
      description: 'Crack',
      photos: [photoId],
      photoStrokes: {
        [photoId]: [{
          kind: 'rect',
          x0: 40,
          y0: 30,
          x1: 160,
          y1: 120,
          color: '#c14a2b',
          thick: 3,
        }],
      },
    }],
  };
  await window.ToolboxDB.saveCustomerFile(record);

  // Simulate hostPersistSurvey shape: reload and confirm strokes survived.
  const stored = await window.ToolboxDB.getCustomerFile('ds-annotate-host');
  const strokes = stored && stored.distress && stored.distress.pins[0] &&
    stored.distress.pins[0].photoStrokes &&
    stored.distress.pins[0].photoStrokes[photoId];
  assert('Customer File keeps photoStrokes after save',
    Array.isArray(strokes) && strokes.length === 1,
    strokes ? JSON.stringify(strokes[0].kind) : 'missing');

  const api = window.ToolboxReportEvidence;
  const assembled = await api.assemble(stored, {
    getMedia: (id) => window.ToolboxDB.getMedia(id).catch(() => null),
    getDistressMedia: api.readDistressMedia.bind(api),
  });
  const photo = assembled.distress.slides[0].pins[0].photos[0];
  assert('assembled photo present', !!(photo && photo.dataUrl));
  assert('assembled photo composites strokes (differs from plain)',
    !!(photo && photo.dataUrl && photo.dataUrl !== plain));

  let redHit = false;
  if (photo && photo.dataUrl) {
    const img = new Image();
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      img.src = photo.dataUrl;
    });
    const probe = document.createElement('canvas');
    probe.width = img.naturalWidth || 200;
    probe.height = img.naturalHeight || 150;
    const pctx = probe.getContext('2d');
    pctx.drawImage(img, 0, 0);
    const sample = pctx.getImageData(40, 75, 1, 1).data;
    redHit = sample[0] > 140 && sample[1] < 120 && sample[2] < 100;
    assert('composited pixels include annotation red', redHit,
      'rgba(' + [sample[0], sample[1], sample[2], sample[3]].join(',') + ')');
  }

  // Stage onto Pictures and open Report Builder sheet evidence.
  await window.ToolboxReportBuilder.stagePicturesFromDistress(stored);
  return { asserts: out, shot: photo && photo.dataUrl ? photo.dataUrl : null };
});

(logic.asserts || []).forEach((item) => check(item.name, item.ok, item.detail));

await page.goto(`${BASE}#/file/ds-annotate-host/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('.rb-shell'), { timeout: 15000 });
await page.waitForFunction(() => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), {
  timeout: 15000,
});

const picturesId = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.rb-thumb')].find((el) =>
    /^Pictures/i.test(el.querySelector('.rb-thumb__caption')?.textContent || ''));
  return btn ? btn.getAttribute('data-page-id') : '';
});
check('Pictures page in rail after Put on report', !!picturesId, picturesId);

if (picturesId) {
  await page.click(`.rb-thumb[data-page-id="${picturesId}"]`);
  await page.waitForFunction(
    (id) => document.querySelector('.rb-sheet')?.getAttribute('data-page-id') === id,
    { timeout: 10000 },
    picturesId,
  );
  await page.waitForFunction(() => {
    const img = document.querySelector('.rb-pictures-page__image');
    return img && img.getAttribute('src') && img.getAttribute('src').indexOf('data:image/') === 0;
  }, { timeout: 15000 });

  const sheetProbe = await page.evaluate(async () => {
    const imgEl = document.querySelector('.rb-pictures-page__image');
    if (!imgEl || !imgEl.src) return { ok: false, reason: 'no image' };
    const img = new Image();
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      img.src = imgEl.src;
    });
    const probe = document.createElement('canvas');
    probe.width = img.naturalWidth || 200;
    probe.height = img.naturalHeight || 150;
    const pctx = probe.getContext('2d');
    pctx.drawImage(img, 0, 0);
    const sample = pctx.getImageData(40, 75, 1, 1).data;
    const red = sample[0] > 140 && sample[1] < 120 && sample[2] < 100;
    return {
      ok: red,
      rgba: [sample[0], sample[1], sample[2], sample[3]].join(','),
      srcLen: String(imgEl.src).length,
    };
  });
  check('Report Builder Pictures sheet shows annotation ink',
    sheetProbe.ok, sheetProbe.rgba || sheetProbe.reason);
  await page.screenshot({ path: `${OUT}/distress-annotate-return-pictures.png`, fullPage: false });
}

if (logic.shot) {
  const b64 = String(logic.shot).replace(/^data:image\/\w+;base64,/, '');
  await writeFile(`${OUT}/distress-annotate-return-composited.jpg`, Buffer.from(b64, 'base64'));
}

await writeFile(`${OUT}/distress-annotate-return.json`, JSON.stringify({ results }, null, 2));
const failed = results.filter((r) => !r.ok);
await browser.close();
if (failed.length) {
  console.error('FAILED', failed.length);
  process.exit(1);
}
console.log('OK', results.length);
