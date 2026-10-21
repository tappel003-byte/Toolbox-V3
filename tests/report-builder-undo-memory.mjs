/**
 * An undo step must not cost a copy of the job.
 * Run: node tests/report-builder-undo-memory.mjs   (needs a static server on 8765)
 *
 * Report Builder keeps its own history so Ctrl+Z reaches anything that
 * changed the report, not just typing. A step used to be JSON.stringify of
 * the pages -- and the pages carry their evidence, which carries every
 * photograph on the slide as text. So one step was the whole job written out
 * again. Measured on a job with sixty photographs: the step was 54 MB, and
 * six ordinary edits took the tab from 74 MB to 874 MB.
 *
 * Tim and Lee, moving between pictures, File Explorer, Distress, Floor
 * Survey, Report Builder and Diagnostics on one file: "Aw, Snap! Out of
 * Memory... whatever it takes, we need to do."
 *
 * A photograph does not change while the report is open, so a step shares
 * the photographs rather than copying them. This measures that, and that
 * undo still puts back what was there.
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-undo-memory';
const PHOTOS = 24;
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
await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

// Photographs the size the survey actually stores them at, so the numbers
// below mean something. A tiny test pixel would hide exactly this bug.
await page.evaluate(async (id, count) => {
  function shot(seed) {
    const c = document.createElement('canvas');
    c.width = 1600;
    c.height = 1200;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 1600, 1200);
    g.addColorStop(0, 'hsl(' + ((seed * 37) % 360) + ',70%,45%)');
    g.addColorStop(1, 'hsl(' + ((seed * 91) % 360) + ',70%,25%)');
    x.fillStyle = g;
    x.fillRect(0, 0, 1600, 1200);
    for (let i = 0; i < 600; i += 1) {
      x.fillStyle = 'rgba(' + ((i * seed) % 255) + ',' + ((i * 7) % 255) + ',' + ((i * 13) % 255) + ',0.7)';
      x.fillRect((i * 97 + seed * 11) % 1600, (i * 53 + seed * 7) % 1200, 60, 45);
    }
    return c.toDataURL('image/jpeg', 0.85);
  }
  const plan = document.createElement('canvas');
  plan.width = 900;
  plan.height = 700;
  const pctx = plan.getContext('2d');
  pctx.fillStyle = '#ffffff';
  pctx.fillRect(0, 0, 900, 700);
  await window.ToolboxDB.putMedia('plan-' + id, plan.toDataURL('image/png'));

  const record = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Una';
  record.lastName = 'Doe';
  record.propertyAddress = '6 History Lane\nSanta Fe, NM 87505';
  const first = record.planSetup.canvases[0];
  first.name = 'Main Level';
  first.plan = { id: 'plan-' + id, width: 900, height: 700 };
  first.frontDoorFacing = 'N';
  const pins = [];
  for (let i = 1; i <= count; i += 1) {
    const photoId = 'ph-undo-' + i;
    await window.ToolboxDB.putMedia(photoId, shot(i));
    pins.push({
      id: 'pin-' + i, num: i, canvasId: first.id,
      x: 0.1 + (i % 7) * 0.1, y: 0.1 + (i % 5) * 0.15,
      location: 'Room ' + i, description: 'Observation ' + i,
      photos: [{ id: photoId }],
    });
  }
  record.distress = {
    updatedAt: new Date().toISOString(), mode: 'internal',
    startNum: 1, nextNum: count + 1, activeCanvasId: first.id, pins: pins,
  };
  await window.ToolboxDB.saveCustomerFile(record);
}, FILE, PHOTOS);

const cdp = await page.createCDPSession();
async function heapMb() {
  await cdp.send('HeapProfiler.collectGarbage');
  await new Promise((r) => setTimeout(r, 400));
  return page.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(1));
}

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 5000));
const opened = await heapMb();

// Six ordinary edits: step to a slide, type on it, let the step settle.
const EDITS = 6;
let typedSomewhere = 0;
for (let step = 1; step <= EDITS; step += 1) {
  await page.evaluate((n) => {
    const list = [...document.querySelectorAll('.rb-thumb')];
    (list[n % list.length] || list[0]).click();
  }, step);
  await new Promise((r) => setTimeout(r, 1100));
  const focused = await page.evaluate(() => {
    const box = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [contenteditable="true"]');
    if (!box) return false;
    box.focus();
    return true;
  });
  if (focused) {
    typedSomewhere += 1;
    await page.keyboard.type('note ' + step);
  }
  await new Promise((r) => setTimeout(r, 1300));
}
const afterEdits = await heapMb();
const perEdit = +((afterEdits - opened) / EDITS).toFixed(2);

check('editing the report does not stack up copies of the job',
  typedSomewhere >= 3 && perEdit < 2,
  JSON.stringify({ photographs: PHOTOS, openedMb: opened, afterMb: afterEdits,
    perEditMb: perEdit, edits: EDITS, typed: typedSomewhere }));

// And the history still works: type, settle, type again, then step back.
const typing = await page.evaluate(() => {
  const list = [...document.querySelectorAll('.rb-thumb')];
  for (let i = 0; i < list.length; i += 1) {
    list[i].click();
    const box = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [contenteditable="true"]');
    if (box) return true;
  }
  return false;
});
let undoWorks = null;
if (typing) {
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => {
    const box = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [contenteditable="true"]');
    box.focus();
  });
  await page.keyboard.type(' FIRST');
  await new Promise((r) => setTimeout(r, 1400));
  const before = await page.evaluate(() =>
    document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [contenteditable="true"]').textContent);
  await page.keyboard.type(' SECOND');
  await new Promise((r) => setTimeout(r, 1400));
  const after = await page.evaluate(() =>
    document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [contenteditable="true"]').textContent);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyZ');
  await page.keyboard.up('Control');
  await new Promise((r) => setTimeout(r, 1500));
  const undone = await page.evaluate(() =>
    document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [contenteditable="true"]').textContent);
  undoWorks = { before, after, undone };
}
check('and undo still puts back what was there',
  !!undoWorks && /SECOND/.test(undoWorks.after) && !/SECOND/.test(undoWorks.undone) &&
  /FIRST/.test(undoWorks.undone),
  JSON.stringify(undoWorks));

// The photographs are still on the page after a step back -- a history that
// shares them must not hand back pages that have lost them.
const picturesStillThere = await page.evaluate(() => {
  const list = [...document.querySelectorAll('.rb-thumb')];
  for (let i = 0; i < list.length; i += 1) {
    list[i].click();
    const imgs = [...document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) img')]
      .filter((im) => (im.getAttribute('src') || '').length > 0);
    if (imgs.length) return imgs.length;
  }
  return 0;
});
check('and the slides still carry their photographs',
  picturesStillThere > 0, JSON.stringify({ pictures: picturesStillThere }));

await page.screenshot({ path: `${OUT}/report-undo-memory.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
