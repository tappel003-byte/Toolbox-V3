/**
 * Every printed sheet carries its page frame, all four sides, in the PDF.
 *
 * Run: node tests/report-print-frame.mjs   (static server on 8765)
 *
 * Tim, Oct 29, on a report he sent to a customer: the single-line border
 * around the slides did not print on one sheet -- "it was intermittent". The
 * frame is a hairline drawn over the page content, so anything that ends up
 * over it on one sheet takes it off that sheet only.
 *
 * This prints a book holding every sheet type to a real PDF, rasterizes each
 * page, and looks for the frame's dark line along all four sides. Then it
 * does the same after the floor sheet's pieces have been brought to the front
 * again and again, which is the one thing that can lift a piece of a sheet
 * higher every time it is done.
 */
import { createRequire } from 'module';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { execFileSync } from 'child_process';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-print-frame';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const WHITE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

// A job with every sheet type: cover, discussion, a floor sheet, picture
// locations and pictures.
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
  record.firstName = 'Jason';
  record.lastName = 'Mitchell';
  record.propertyAddress = '59 Lodge Trail\nSanta Fe, New Mexico, 87506';
  await window.ToolboxDB.putMedia('plan-frame', png);
  const canvas = record.planSetup.canvases[0];
  canvas.name = 'Main Level';
  canvas.plan = { id: 'plan-frame', width: 1200, height: 800 };
  const canvasId = canvas.id;
  const boundary = [{ x: 120, y: 120 }, { x: 1080, y: 120 }, { x: 1080, y: 680 }, { x: 120, y: 680 }];
  const points = [];
  let n = 0;
  for (let gx = 0; gx < 5; gx += 1) {
    for (let gy = 0; gy < 3; gy += 1) {
      n += 1;
      points.push({
        id: 'p' + n, floorId: canvasId, index: n,
        x: 200 + gx * 190, y: 200 + gy * 180,
        value: 9.2 - gx * 0.4 - gy * 0.3,
        isBasePoint: n === 1, label: n === 1 ? 'BP1' : String(n),
        createdAt: Date.now(),
      });
    }
  }
  record.floorSurvey.inspectionDate = '2026-10-08';
  record.floorSurvey.byCanvasId[canvasId] = {
    canvasId, boundary, points,
    areas: [{ id: 'area-main', name: 'Main', polygon: boundary, createdAt: Date.now() }],
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  const pins = [];
  for (let i = 1; i <= 6; i += 1) {
    const photoId = 'ph-frame-' + i;
    await window.ToolboxDB.putMedia(photoId, png);
    pins.push({
      id: 'pin-' + i, num: i, canvasId,
      x: 0.15 + i * 0.11, y: 0.3 + (i % 3) * 0.15,
      location: 'Room ' + i, description: 'Observation ' + i,
      photos: [{ id: photoId }],
    });
  }
  record.distress = {
    mode: 'internal', startNum: 1, nextNum: pins.length + 1, activeCanvasId: canvasId, pins,
  };
  await window.ToolboxDB.saveCustomerFile(record);
}, { png: WHITE_PNG, id: FILE });

async function openFloor() {
  await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('.rb-thumb[data-page-id^="floor-"]'), { timeout: 25000 });
  await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id^="floor-"]').click());
  await page.waitForFunction(
    () => !!document.querySelector('[data-rb-floor-import]') ||
      !!document.querySelector('[data-rb-floor-box^="topo"]'), { timeout: 20000 });
  if (await page.$('[data-rb-floor-import]')) {
    await page.click('[data-rb-floor-import]');
    await page.waitForFunction(() => !!document.querySelector('[data-rb-floor-box^="topo"]'), { timeout: 30000 });
  }
  await new Promise((r) => setTimeout(r, 2500));
}

/** Print the book to a PDF and look for the frame on every page. */
async function printedFrames(tag) {
  await page.evaluate(() => {
    window.__printed = false;
    window.print = () => { window.__printed = true; };
  });
  await page.click('#rb-print');
  await page.waitForFunction(() => window.__printed === true, { timeout: 90000 });
  await new Promise((r) => setTimeout(r, 800));
  const deck = await page.evaluate(() => [...document.querySelectorAll('.rb-print .rb-print__page')]
    .map((paper) => {
      const sheet = paper.querySelector('.rb-sheet[data-page-id]');
      const frame = paper.querySelector('.rb-sheet__frame');
      const pr = paper.getBoundingClientRect();
      const fr = frame ? frame.getBoundingClientRect() : null;
      return {
        pageId: sheet ? sheet.getAttribute('data-page-id') : '',
        // The frame's edges as fractions of the paper: left, top, right, bottom.
        frame: fr ? [(fr.left - pr.left) / pr.width, (fr.top - pr.top) / pr.height,
          (fr.right - pr.left) / pr.width, (fr.bottom - pr.top) / pr.height] : null,
      };
    }));
  const pdf = await page.pdf({ width: '17in', height: '11in', printBackground: true, preferCSSPageSize: true });
  const pdfPath = `${OUT}/report-print-frame-${tag}.pdf`;
  await writeFile(pdfPath, pdf);
  const out = [];
  for (let i = 0; i < deck.length; i += 1) {
    const prefix = `${OUT}/report-print-frame-${tag}-p${i + 1}`;
    execFileSync('pdftoppm', ['-r', '100', '-f', String(i + 1), '-l', String(i + 1),
      '-png', '-singlefile', pdfPath, prefix]);
    const b64 = (await readFile(`${prefix}.png`)).toString('base64');
    const sides = await page.evaluate(async (png, f) => {
      if (!f) return null;
      const im = await new Promise((res, rej) => {
        const img = new Image(); img.onload = () => res(img); img.onerror = rej;
        img.src = 'data:image/png;base64,' + png;
      });
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const x = c.getContext('2d');
      x.drawImage(im, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      const W = c.width; const H = c.height;
      const lum = (px, py) => {
        const i = (Math.round(py) * W + Math.round(px)) * 4;
        return 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
      };
      const [l, t, r, b] = [f[0] * W, f[1] * H, f[2] * W, f[3] * H];
      const N = 60;
      const along = (horizontal, fixed) => {
        let hits = 0;
        for (let s = 1; s < N; s += 1) {
          let min = 255;
          for (let k = -4; k <= 4; k += 1) {
            const v = horizontal
              ? lum(l + (r - l) * s / N, Math.min(H - 1, Math.max(0, fixed + k)))
              : lum(Math.min(W - 1, Math.max(0, fixed + k)), t + (b - t) * s / N);
            if (v < min) min = v;
          }
          if (min < 110) hits += 1;
        }
        return +(hits / (N - 1)).toFixed(2);
      };
      return { top: along(true, t + 1), bottom: along(true, b - 1), left: along(false, l + 1), right: along(false, r - 1) };
    }, b64, deck[i].frame);
    out.push({ pageId: deck[i].pageId, sides });
  }
  // Close the deck so the editor is back.
  await page.evaluate(() => { const b = document.querySelector('[data-present="close"]'); if (b) b.click(); });
  await new Promise((r) => setTimeout(r, 600));
  return out;
}

const whole = (s) => !!s && s.top >= 0.95 && s.bottom >= 0.95 && s.left >= 0.95 && s.right >= 0.95;

await openFloor();
const rest = await printedFrames('rest');
check('the book prints every sheet type',
  rest.some((p) => p.pageId === 'cover') && rest.some((p) => /^floor-/.test(p.pageId)) &&
  rest.some((p) => /^pictures-/.test(p.pageId)) && rest.length >= 5,
  rest.map((p) => p.pageId).join(' | '));
rest.forEach((p) => {
  check(`printed as opened, ${p.pageId} carries its frame on all four sides`, whole(p.sides), JSON.stringify(p.sides));
});

// Bring each floor piece to the front, again and again.
await openFloor();
for (let round = 0; round < 4; round += 1) {
  for (const kind of ['topo', 'legend', 'pill']) {
    const box = await page.evaluate((k) => {
      const el = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="' + k + '"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + Math.min(14, r.height / 2) };
    }, kind);
    if (!box) continue;
    await page.mouse.click(box.x, box.y, { button: 'right' });
    await new Promise((r) => setTimeout(r, 300));
    if (await page.$('[data-rb-stackmenu] [data-rb-stack="front"]')) {
      await page.click('[data-rb-stackmenu] [data-rb-stack="front"]');
      await new Promise((r) => setTimeout(r, 500));
    } else {
      await page.keyboard.press('Escape');
    }
  }
}
const stack = await page.evaluate(() => {
  const read = (sel) => {
    const el = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) ' + sel);
    return el ? Number(el.style.zIndex) : null;
  };
  return { plan: read('[data-rb-floor-box^="topo"]'), scale: read('[data-rb-floor-box^="legend"]'), readings: read('[data-rb-floor-box^="pill"]') };
});
check('the floor pieces have been lifted well above the frame\'s own level', Math.max(stack.plan, stack.scale, stack.readings) > 6, JSON.stringify(stack));
const lifted = await printedFrames('lifted');
lifted.forEach((p) => {
  check(`after bringing pieces forward, ${p.pageId} still carries its frame`, whole(p.sides), JSON.stringify(p.sides));
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
