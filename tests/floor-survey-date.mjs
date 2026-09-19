/**
 * Focused Floor Survey inspection-date (proven type="date" calendar) tests.
 * Run: node tests/floor-survey-date.mjs
 */
import { createRequire } from 'module';
import fs from 'fs';
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
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

const today = new Date().toISOString().slice(0, 10);
const chosen = '2024-06-15';

await page.goto(BASE, { waitUntil: 'networkidle0' });
const ids = await page.evaluate(async () => {
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
  const c = document.createElement('canvas');
  c.width = 400;
  c.height = 300;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 400, 300);
  ctx.strokeStyle = '#444';
  ctx.strokeRect(30, 30, 340, 240);
  const planPng = c.toDataURL('image/png');
  const id = 'fs-date-1';
  const canvasId = 'canvas-date-1';
  const planId = 'plan-date-1';
  await window.ToolboxDB.putMedia(planId, planPng);
  let rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Date';
  rec.lastName = 'Survey';
  rec.propertyAddress = '15 Calendar Ln';
  rec.planSetup.canvases = [
    {
      id: canvasId,
      name: 'Main Level',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plan: { id: planId, width: 400, height: 300 },
      rooms: [],
      frontDoorFacing: 'S',
      frontDoor: null,
    },
  ];
  rec.planSetup.activeCanvasId = canvasId;
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(rec, canvasId);
  await window.ToolboxDB.saveCustomerFile(rec);
  return { id, canvasId };
});

await page.goto(BASE + `#/file/${ids.id}/floor`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1500));

const launch = await page.evaluate(() => {
  const dateInput = document.querySelector('#fs-inspection-date, [data-fs-inspection-date] input[type=date]');
  const active = [...document.querySelectorAll('button')].find(
    (b) =>
      (b.className || '').includes('border-primary') &&
      /Topo boundary/.test(b.textContent || ''),
  );
  const canvas = document.querySelector('canvas');
  return {
    hasDate: !!dateInput,
    dateValue: dateInput ? dateInput.value : null,
    type: dateInput?.getAttribute('type') || null,
    onBoundary: !!active,
    hasCanvas: !!canvas,
    label: document.querySelector('[data-fs-inspection-date] label')?.textContent?.trim() || null,
  };
});

check('Boundary/setup screen open with CF plan', launch.onBoundary && launch.hasCanvas);
check('Proven Inspection date calendar control visible', launch.hasDate && launch.type === 'date', JSON.stringify(launch));
check('Label is proven "Inspection date"', launch.label === 'Inspection date', String(launch.label));
check(
  'Brand-new survey has NO silent today date',
  launch.dateValue === '' || launch.dateValue == null,
  `value=${JSON.stringify(launch.dateValue)} today=${today}`,
);

await page.screenshot({ path: `${OUT}/fs_date_01_boundary_with_calendar.png` });

// Open / focus the proven date control (native calendar)
const dateSel = '#fs-inspection-date';
await page.waitForSelector(dateSel);
await page.click(dateSel);
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${OUT}/fs_date_02_calendar_focused.png` });

// Deliberately select a date (not today) — native setter so React onChange fires
await page.$eval(dateSel, (el, v) => {
  const input = el;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, v);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, chosen);
await new Promise((r) => setTimeout(r, 800));

const afterSelect = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  return el ? el.value : null;
}, dateSel);
check('Selected date displays on boundary/setup screen', afterSelect === chosen, afterSelect);

await page.screenshot({ path: `${OUT}/fs_date_03_date_selected.png` });

// Persist check on CF record
const persisted1 = await page.evaluate(async (cfId) => {
  const rec = await window.ToolboxDB.getCustomerFile(cfId);
  return {
    inspectionDate: rec.floorSurvey?.inspectionDate ?? null,
    hasTodayLeak: false,
  };
}, ids.id);
check(
  'Selected date persisted on floorSurvey.inspectionDate',
  persisted1.inspectionDate === chosen,
  JSON.stringify(persisted1),
);
check(
  'Persisted date is not createdAt/updatedAt/today substitute',
  persisted1.inspectionDate === chosen && persisted1.inspectionDate !== today,
  JSON.stringify({ persisted: persisted1.inspectionDate, today }),
);

// Draw a boundary (same proven interaction)
async function tapCanvas(nx, ny) {
  const box = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + box.w * nx, box.y + box.h * ny);
  await new Promise((r) => setTimeout(r, 180));
}
await tapCanvas(0.2, 0.2);
await tapCanvas(0.8, 0.2);
await tapCanvas(0.8, 0.8);
await tapCanvas(0.2, 0.8);
const closedUi = await page.evaluate(() => {
  const closeBtn = [...document.querySelectorAll('button')].find((b) =>
    /^Close$|Close shape|Finish/i.test((b.textContent || '').trim()),
  );
  if (closeBtn) {
    closeBtn.click();
    return 'clicked-close';
  }
  return 'no-close-btn';
});
if (closedUi === 'no-close-btn') await tapCanvas(0.2, 0.2);
await new Promise((r) => setTimeout(r, 700));

const afterBoundary = await page.evaluate(async (cfId, canvasId) => {
  const rec = await window.ToolboxDB.getCustomerFile(cfId);
  const layer = rec.floorSurvey.byCanvasId[canvasId];
  const closed = (layer?.areas || []).some((a) => (a.polygon || []).length >= 3);
  return {
    closed,
    inspectionDate: rec.floorSurvey?.inspectionDate ?? null,
    dateStillOnUi: document.querySelector('#fs-inspection-date')?.value || null,
  };
}, ids.id, ids.canvasId);
check(
  'Boundary created with selected date retained',
  afterBoundary.closed && afterBoundary.inspectionDate === chosen,
  JSON.stringify(afterBoundary),
);
await page.screenshot({ path: `${OUT}/fs_date_04_boundary_with_date.png` });

// Start surveying → field
for (let i = 0; i < 4; i++) {
  const state = await page.evaluate(() => {
    const t = document.body.innerText || '';
    return {
      field: /\bData\b/.test(t) && /\bTopo\b/.test(t) && !/Topo boundary/.test(t),
      start: [...document.querySelectorAll('button')].some((b) => /Start surveying/i.test(b.textContent || '')),
      next: [...document.querySelectorAll('button')].find((b) => /^Next:/.test((b.textContent || '').trim()))
        ?.textContent,
    };
  });
  if (state.field) break;
  if (state.start) {
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => /Start surveying/i.test(b.textContent || ''))?.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    break;
  }
  if (state.next) {
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => /^Next:/.test((b.textContent || '').trim()))?.click();
    });
    await new Promise((r) => setTimeout(r, 400));
  }
}

// Leave Floor Survey and reopen
await page.goto(BASE + `#/file/${ids.id}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 500));
await page.goto(BASE + `#/file/${ids.id}/floor`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1500));

// Reopen may land on field (boundary exists) — open Setup to see date, or check record
const reopened = await page.evaluate(async (cfId, canvasId) => {
  const rec = await window.ToolboxDB.getCustomerFile(cfId);
  const layer = rec.floorSurvey.byCanvasId[canvasId];
  // Open Setup via More menu if needed to show date control
  const more = document.querySelector('[aria-label="More"]');
  if (more) more.click();
  await new Promise((r) => setTimeout(r, 200));
  const setup = [...document.querySelectorAll('[role=menuitem]')].find((b) =>
    /^Setup$/i.test((b.textContent || '').trim()),
  );
  if (setup) setup.click();
  await new Promise((r) => setTimeout(r, 500));
  const areasTab = [...document.querySelectorAll('button')].find(
    (b) => (b.textContent || '').trim() === '3. Topo boundary',
  );
  areasTab?.click();
  await new Promise((r) => setTimeout(r, 400));
  const dateInput = document.querySelector('#fs-inspection-date');
  return {
    inspectionDate: rec.floorSurvey?.inspectionDate ?? null,
    uiDate: dateInput?.value ?? null,
    areas: (layer?.areas || []).length,
    poly: layer?.areas?.[0]?.polygon?.length || 0,
  };
}, ids.id, ids.canvasId);

check(
  'Reopen: survey date still correct on record + UI',
  reopened.inspectionDate === chosen && reopened.uiDate === chosen,
  JSON.stringify(reopened),
);
check(
  'Reopen: boundary data intact',
  reopened.areas >= 1 && reopened.poly >= 3,
  JSON.stringify(reopened),
);
await page.screenshot({ path: `${OUT}/fs_date_05_reopened_persisted_date.png` });

// Fresh CF: confirm still no today default after ensureFloorSurvey
const fresh = await page.evaluate(async () => {
  const id = 'fs-date-fresh';
  const c = document.createElement('canvas');
  c.width = 10;
  c.height = 10;
  c.getContext('2d').fillRect(0, 0, 10, 10);
  await window.ToolboxDB.putMedia('pf', c.toDataURL('image/png'));
  let rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.planSetup.canvases = [
    {
      id: 'cfresh',
      name: 'L',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plan: { id: 'pf', width: 10, height: 10 },
      rooms: [],
      frontDoorFacing: 'S',
      frontDoor: null,
    },
  ];
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(rec, 'cfresh');
  await window.ToolboxDB.saveCustomerFile(rec);
  const again = await window.ToolboxDB.getCustomerFile(id);
  return {
    hasKey: Object.prototype.hasOwnProperty.call(again.floorSurvey || {}, 'inspectionDate'),
    value: again.floorSurvey?.inspectionDate,
  };
});
check(
  'New Floor Survey layer does not prefill inspectionDate',
  !fresh.hasKey || fresh.value === '' || fresh.value == null,
  JSON.stringify(fresh),
);

await browser.close();
fs.writeFileSync(`${OUT}/fs_date_results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) process.exitCode = 1;
