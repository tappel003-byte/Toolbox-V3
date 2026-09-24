/**
 * Floor Survey field menu no longer opens 3D or Export.
 * Diagnostics opens the existing 3D view against saved Floor Survey data.
 * Run: node tests/floor-survey-diagnostics.mjs
 * Requires: Chrome, puppeteer-core, static server on :8765
 */
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
}

const tiny =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text());
});

await page.goto(BASE, { waitUntil: 'networkidle0' });

const seeded = await page.evaluate(async (planUrl) => {
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

  const id = 'dx-3d-1';
  const planId = 'plan-dx-1';
  await window.ToolboxDB.putMedia(planId, planUrl);
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Dana';
  rec.lastName = 'Diagnostics';
  rec.propertyAddress = '58 Survey Court';
  const now = new Date().toISOString();
  rec.planSetup.canvases = [
    {
      id: 'canvas-dx-1',
      name: 'First Floor',
      createdAt: now,
      updatedAt: now,
      plan: { id: planId, width: 200, height: 140 },
      rooms: [],
      frontDoorFacing: 'S',
      frontDoor: null,
    },
    {
      id: 'canvas-dx-2',
      name: 'Second Floor',
      createdAt: now,
      updatedAt: now,
      plan: { id: planId, width: 200, height: 140 },
      rooms: [],
      frontDoorFacing: 'N',
      frontDoor: null,
    },
  ];
  rec.planSetup.activeCanvasId = 'canvas-dx-1';
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(rec, 'canvas-dx-1');
  window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(rec, 'canvas-dx-2');
  const boundary = [
    { x: 10, y: 10 },
    { x: 180, y: 10 },
    { x: 180, y: 120 },
    { x: 10, y: 120 },
  ];
  rec.floorSurvey.byCanvasId['canvas-dx-1'].boundary = boundary;
  rec.floorSurvey.byCanvasId['canvas-dx-1'].points = [
    { id: 'p1', floorId: 'canvas-dx-1', index: 1, x: 40, y: 40, value: 0.1, createdAt: 1 },
    { id: 'p2', floorId: 'canvas-dx-1', index: 2, x: 140, y: 40, value: 0.4, createdAt: 1 },
    { id: 'p3', floorId: 'canvas-dx-1', index: 3, x: 40, y: 100, value: 0.8, createdAt: 1 },
    { id: 'p4', floorId: 'canvas-dx-1', index: 4, x: 140, y: 100, value: 1.2, createdAt: 1 },
  ];
  rec.floorSurvey.byCanvasId['canvas-dx-2'].boundary = boundary;
  rec.floorSurvey.byCanvasId['canvas-dx-2'].points = [
    { id: 'q1', floorId: 'canvas-dx-2', index: 1, x: 50, y: 50, value: 2.0, createdAt: 1 },
  ];
  rec.floorSurvey.updatedAt = '2026-09-24T12:00:00.000Z';
  rec.updatedAt = '2026-09-24T12:00:00.000Z';
  delete rec.diagnostics;
  await window.ToolboxDB.saveCustomerFile(rec);
  const saved = await window.ToolboxDB.getCustomerFile(id);
  return {
    id,
    floorUpdatedAt: saved.floorSurvey.updatedAt,
    points1: saved.floorSurvey.byCanvasId['canvas-dx-1'].points.length,
    points2: saved.floorSurvey.byCanvasId['canvas-dx-2'].points.length,
    hasDiagnostics: !!saved.diagnostics,
  };
}, tiny);

check('synthetic Customer File saved', seeded.points1 === 4 && seeded.points2 === 1, JSON.stringify(seeded));

await page.goto(BASE + '#/file/dx-3d-1/floor', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1200));

await page.click('[aria-label="More"]');
await new Promise((r) => setTimeout(r, 300));
const fieldChrome = await page.evaluate(() => {
  const items = [...document.querySelectorAll('[role="menuitem"]')].map((el) => (el.textContent || '').trim());
  const text = document.body.innerText || '';
  return {
    items,
    hasData: /\bData\b/.test(text),
    hasTopo: /\bTopo\b/.test(text),
    has3dView: !!document.querySelector('[aria-label="Close 3D view"]'),
  };
});
check(
  'Floor Survey menu keeps Review, Setup, and Transitions',
  fieldChrome.items.includes('Review') && fieldChrome.items.includes('Setup') && fieldChrome.items.includes('Transitions'),
  fieldChrome.items.join(', '),
);
check(
  'Floor Survey menu has no 3D or Export',
  !fieldChrome.items.includes('3D') && !fieldChrome.items.includes('Export') && !fieldChrome.has3dView,
  fieldChrome.items.join(', '),
);
check('Floor Survey still offers Data and Topo', fieldChrome.hasData && fieldChrome.hasTopo);
await page.screenshot({ path: OUT + '/diagnostics-field-menu-desktop.png' });

await page.goto(BASE + '#/file/dx-3d-1/diagnostics', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1800));

const opened = await page.evaluate(() => {
  const close = document.querySelector('[aria-label="Close 3D view"]');
  const floor = document.querySelector('[data-diagnostics-floor]');
  const canvas = document.querySelector('canvas');
  const text = document.body.innerText || '';
  return {
    close: !!close,
    title: text.includes('3D'),
    floorOptions: floor ? [...floor.options].map((o) => o.textContent) : [],
    selected: floor ? floor.value : '',
    canvas: !!canvas,
    message: /Need at least 3 survey points|Boundary is missing|Building surface|could not start/.test(text) ? text.slice(0, 180) : '',
    fieldMenu: !!document.querySelector('[aria-label="More"]'),
    exportImage: /Export image/.test(text),
    diagnosticsOpen: document.body.classList.contains('diagnostics-open'),
  };
});
check('Diagnostics opens the existing 3D view', opened.close && opened.title && opened.diagnosticsOpen, JSON.stringify(opened));
check('Diagnostics can switch floors', opened.floorOptions.join('|') === 'First Floor|Second Floor', opened.floorOptions.join('|'));
check('3D canvas is present', opened.canvas, opened.message);
check('Field capture menu is not on the 3D view', !opened.fieldMenu);
check('3D image export control remains with the engine', opened.exportImage);
await page.screenshot({ path: OUT + '/diagnostics-3d-desktop.png' });

if (opened.floorOptions.length === 2) {
  await page.select('[data-diagnostics-floor]', 'canvas-dx-2');
  await new Promise((r) => setTimeout(r, 600));
  const second = await page.evaluate(() => {
    const text = document.body.innerText || '';
    return {
      selected: document.querySelector('[data-diagnostics-floor]')?.value || '',
      needsPoints: text.includes('Need at least 3 survey points'),
    };
  });
  check(
    'Second floor uses its own survey in 3D',
    second.selected === 'canvas-dx-2' && second.needsPoints,
    JSON.stringify(second),
  );
  await page.screenshot({ path: OUT + '/diagnostics-3d-second-floor.png' });
}

const unchanged = await page.evaluate(async () => {
  const saved = await window.ToolboxDB.getCustomerFile('dx-3d-1');
  return {
    floorUpdatedAt: saved.floorSurvey.updatedAt,
    points1: saved.floorSurvey.byCanvasId['canvas-dx-1'].points.map((p) => p.value).join(','),
    points2: saved.floorSurvey.byCanvasId['canvas-dx-2'].points.length,
    hasDiagnostics: !!saved.diagnostics,
  };
});
check(
  'Opening Diagnostics does not write Floor Survey or Diagnostics data',
  unchanged.floorUpdatedAt === seeded.floorUpdatedAt &&
    unchanged.points1 === '0.1,0.4,0.8,1.2' &&
    unchanged.points2 === 1 &&
    unchanged.hasDiagnostics === false,
  JSON.stringify(unchanged),
);

await page.click('[aria-label="Close 3D view"]');
await new Promise((r) => setTimeout(r, 700));
const home = await page.evaluate(() => ({
  hash: location.hash,
  apps: [...document.querySelectorAll('[data-app]')].map((el) => el.getAttribute('data-app')),
  still3d: !!document.querySelector('[aria-label="Close 3D view"]'),
}));
check(
  'Close returns to this Customer File',
  home.hash === '#/file/dx-3d-1' && home.apps.join(',') === 'distress,floor,diagnostics,report' && !home.still3d,
  JSON.stringify(home),
);

await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 2 });
await page.goto(BASE + '#/file/dx-3d-1/diagnostics', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1000));
const ipad = await page.evaluate(() => {
  const close = document.querySelector('[aria-label="Close 3D view"]');
  const exportBtn = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').includes('Export image'));
  const floor = document.querySelector('[data-diagnostics-floor]');
  const cards = [...document.querySelectorAll('div')].filter((el) => {
    const text = el.textContent || '';
    return text.includes('Height exaggeration') && text.includes('Show survey points');
  });
  cards.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
  const panel = cards[0] || null;
  function box(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }
  function overlaps(a, b) {
    if (!a || !b) return false;
    return a.right > b.left + 1 && a.left < b.right - 1 && a.bottom > b.top + 1 && a.top < b.bottom - 1;
  }
  const closeBox = box(close);
  const exportBox = box(exportBtn);
  const floorBox = box(floor);
  const panelBox = box(panel);
  return {
    close: !!close,
    panel: !!panelBox,
    headerOverlap: overlaps(closeBox, exportBox) || overlaps(closeBox, floorBox) || overlaps(exportBox, floorBox),
    panelOverlap: overlaps(closeBox, panelBox) || overlaps(exportBox, panelBox) || overlaps(floorBox, panelBox),
    vw: window.innerWidth,
  };
});
check(
  'iPad 3D header and height controls stay apart',
  ipad.close && ipad.panel && !ipad.headerOverlap && !ipad.panelOverlap,
  JSON.stringify(ipad),
);
await page.screenshot({ path: OUT + '/diagnostics-3d-ipad.png' });

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(BASE + '#/file/dx-3d-1/diagnostics', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1000));
const phone = await page.evaluate(() => {
  const close = document.querySelector('[aria-label="Close 3D view"]');
  const exportBtn = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').includes('Export image'));
  const floor = document.querySelector('[data-diagnostics-floor]');
  const boxes = [close, exportBtn, floor].filter(Boolean).map((el) => {
    const r = el.getBoundingClientRect();
    return { label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20), left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width };
  });
  function overlaps(a, b) {
    return a.right > b.left + 1 && a.left < b.right - 1 && a.bottom > b.top + 1 && a.top < b.bottom - 1;
  }
  let crowded = false;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (overlaps(boxes[i], boxes[j])) crowded = true;
    }
  }
  const offscreen = boxes.some((b) => b.left < 0 || b.right > window.innerWidth + 1);
  return { crowded, offscreen, boxes, vw: window.innerWidth };
});
check('Phone 3D header controls do not overlap', !phone.crowded && !phone.offscreen, JSON.stringify(phone));
await page.screenshot({ path: OUT + '/diagnostics-3d-phone.png' });

await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
await page.goto(BASE + '#/file/dx-3d-1/floor', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));
const backToField = await page.evaluate(() => ({
  more: !!document.querySelector('[aria-label="More"]'),
  three: !!document.querySelector('[aria-label="Close 3D view"]'),
  diagnostics: document.body.classList.contains('diagnostics-open'),
}));
check('Returning to Floor Survey restores field capture', backToField.more && !backToField.three && !backToField.diagnostics, JSON.stringify(backToField));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) process.exitCode = 1;
