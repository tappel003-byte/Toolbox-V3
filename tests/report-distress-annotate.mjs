/**
 * Distress Annotate strokes must appear on Report Builder evidence.
 * Capture keeps ink on pin.photoStrokes; rehydrate composites onto the photo.
 * Run: node tests/report-distress-annotate.mjs
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
const OUT = '/opt/cursor/artifacts';
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
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

const logic = await page.evaluate(async () => {
  const api = window.ToolboxReportEvidence;
  const out = [];
  function assert(name, cond, detail) {
    out.push({ name, ok: !!cond, detail: detail || '' });
  }
  if (!api || typeof api.assemble !== 'function') {
    assert('ToolboxReportEvidence present', false);
    return { asserts: out, shot: null };
  }

  // Solid pale image so a red rectangle stroke is unmistakable.
  const c = document.createElement('canvas');
  c.width = 200;
  c.height = 150;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8e4dc';
  ctx.fillRect(0, 0, 200, 150);
  const plain = c.toDataURL('image/jpeg', 0.95);
  const photoId = 'ph_annotate_test_1';

  const media = {};
  media[photoId] = plain;

  const record = {
    id: 'rb-annotate',
    firstName: 'Ann',
    lastName: 'Otate',
    propertyAddress: '1 Mark Lane\nAlbuquerque, NM',
    planSetup: { canvases: [{ id: 'canvas-m', name: 'Main' }] },
    distress: {
      pins: [{
        id: 'pin-1',
        canvasId: 'canvas-m',
        photos: [photoId],
        description: 'Crack at sill',
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
    },
  };

  const assembled = await api.assemble(record, {
    getMedia: async () => null,
    getDistressMedia: async (id) => media[id] || null,
  });
  const slide = assembled && assembled.distress && assembled.distress.slides[0];
  const photo = slide && slide.pins && slide.pins[0] && slide.pins[0].photos[0];
  assert('distress slide assembled', !!slide);
  assert('photo present', !!(photo && photo.dataUrl));
  assert('composited dataUrl differs from plain capture',
    !!(photo && photo.dataUrl && photo.dataUrl !== plain),
    photo ? String(photo.dataUrl).slice(0, 48) : 'missing');

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
    // Sample the rectangle edge (thick red stroke).
    const sample = pctx.getImageData(40, 75, 1, 1).data;
    // Copper-ish red from #c14a2b — R high, G mid, B low.
    redHit = sample[0] > 140 && sample[1] < 120 && sample[2] < 100;
    assert('composited pixels include annotation red', redHit,
      'rgba(' + [sample[0], sample[1], sample[2], sample[3]].join(',') + ')');
  } else {
    assert('composited pixels include annotation red', false, 'no photo');
  }

  // No strokes → original bytes unchanged.
  const bare = {
    id: 'rb-annotate-bare',
    firstName: 'Ann',
    lastName: 'Otate',
    planSetup: { canvases: [{ id: 'canvas-m', name: 'Main' }] },
    distress: {
      pins: [{ id: 'pin-1', canvasId: 'canvas-m', photos: [photoId] }],
    },
  };
  const bareAsm = await api.assemble(bare, {
    getMedia: async () => null,
    getDistressMedia: async (id) => media[id] || null,
  });
  const barePhoto = bareAsm.distress.slides[0].pins[0].photos[0];
  assert('unannotated photo keeps original bytes',
    !!(barePhoto && barePhoto.dataUrl === plain));

  return {
    asserts: out,
    shot: photo && photo.dataUrl ? photo.dataUrl : null,
    plain: plain,
  };
});

(logic.asserts || []).forEach((item) => check(item.name, item.ok, item.detail));

if (logic.shot) {
  const b64 = String(logic.shot).replace(/^data:image\/\w+;base64,/, '');
  await writeFile(OUT + '/report-distress-annotate-composited.jpg', Buffer.from(b64, 'base64'));
}
if (logic.plain) {
  const b64 = String(logic.plain).replace(/^data:image\/\w+;base64,/, '');
  await writeFile(OUT + '/report-distress-annotate-plain.jpg', Buffer.from(b64, 'base64'));
}

const failed = results.filter((r) => !r.ok);
await browser.close();
if (failed.length) {
  console.error('FAILED', failed.length);
  process.exit(1);
}
console.log('OK', results.length);
