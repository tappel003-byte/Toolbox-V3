/**
 * Report Builder: floor source-key reconcile + Present/Print preflight.
 * Run: node tests/report-floor-source-key.mjs
 * Requires static server at http://127.0.0.1:8765
 *
 * Covers: survey-id stamp without page growth; rename vs area recreate;
 * empty canvasId blocks Present/Print with reasons; multi-view preserved;
 * PDF/Present path does not emit unavailable drawings in a "complete" deck.
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
const FILE = 'rb-floor-source-key';
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
await page.setViewport({ width: 1700, height: 1050, deviceScaleFactor: 1 });
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
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
});

// --- Native create: Main (2 areas) + Garage, epoch initially "current" ---
const seeded = await page.evaluate(async (id) => {
  const plan = (() => {
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 600;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, 800, 600);
    x.strokeRect(20, 20, 760, 560);
    return c.toDataURL('image/jpeg', 0.85);
  })();

  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  delete rec.floorSurvey.id;
  rec.firstName = 'Pat';
  rec.lastName = 'SourceKey';
  rec.propertyAddress = '1 Source Key Lane';

  const main = rec.planSetup.canvases[0];
  main.name = 'Main Floor';
  const garage = window.ToolboxPlanSetup.blankCanvas('Garage');
  rec.planSetup.canvases.push(garage);
  const planMain = 'plan-' + id + '-main';
  const planGarage = 'plan-' + id + '-garage';
  await window.ToolboxDB.putMedia(planMain, plan);
  await window.ToolboxDB.putMedia(planGarage, plan);
  main.plan = { id: planMain, width: 800, height: 600 };
  garage.plan = { id: planGarage, width: 800, height: 600 };

  const left = [{ x: 40, y: 40 }, { x: 380, y: 40 }, { x: 380, y: 400 }, { x: 40, y: 400 }];
  const right = [{ x: 420, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 400 }, { x: 420, y: 400 }];
  const gPoly = [{ x: 40, y: 440 }, { x: 360, y: 440 }, { x: 360, y: 560 }, { x: 40, y: 560 }];

  const mainPoints = [];
  let n = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      n += 1;
      const inKitchen = col >= 2;
      mainPoints.push({
        id: 'mp' + n,
        floorId: main.id,
        index: n,
        x: (inKitchen ? 480 : 100) + (col % 2) * 100,
        y: 80 + row * 100,
        value: inKitchen ? (9.4 - row * 0.4) : (9.0 - row * 0.5),
      });
    }
  }
  const garagePoints = [];
  for (let i = 0; i < 6; i += 1) {
    garagePoints.push({
      id: 'gp' + (i + 1),
      floorId: garage.id,
      index: i + 1,
      x: 80 + (i % 3) * 80,
      y: 460 + Math.floor(i / 3) * 50,
      value: 12 - i * 0.4,
    });
  }

  rec.floorSurvey = {
    inspectionDate: '2026-10-09',
    schemaVersion: 1,
    byCanvasId: {
      [main.id]: {
        canvasId: main.id,
        points: mainPoints,
        areas: [
          { id: 'area-main-floor', name: 'Main Floor', polygon: left, createdAt: 1 },
          { id: 'area-lr-kitchen', name: 'Living Room / Kitchen', polygon: right, createdAt: 2 },
        ],
        boundary: [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 }],
      },
      [garage.id]: {
        canvasId: garage.id,
        points: garagePoints,
        areas: [{ id: 'area-garage', name: 'Garage', polygon: gPoly, createdAt: 1 }],
        boundary: gPoly,
      },
    },
  };
  await window.ToolboxDB.saveCustomerFile(rec);
  const outline = window.ToolboxReportSource.read(JSON.parse(JSON.stringify(rec)));
  return {
    mainId: main.id,
    garageId: garage.id,
    epochIds: [...new Set(outline.floor.figures.map((f) => f.epochId))],
  };
}, FILE);

check('native seed outlines as epoch current before floorSurvey.id exists',
  seeded.epochIds.join(',') === 'current', JSON.stringify(seeded.epochIds));

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 5000));

const afterNativeOpen = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = ((rec.reportBuilder || {}).pages || []).filter((p) => p.type === 'floor' && !p.meta?.reserved);
  return {
    count: floor.length,
    titles: floor.map((p) => p.title),
    epochs: floor.map((p) => p.meta?.epochId),
    ids: floor.map((p) => p.id),
  };
}, FILE);

check('native Report Builder opens one floor set (Main areas + Combined + Garage)',
  afterNativeOpen.count === 4, JSON.stringify(afterNativeOpen));

// --- Survey-id stamp: no second generation ---
await page.goto(`${BASE}#/file/${FILE}`, { waitUntil: 'networkidle0' });
await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  rec.floorSurvey.id = 'floorSurvey-source-key-1';
  // Leave page epochIds as whatever first open saved (often still "current"
  // if assemble used current before ensure stamped — force current on pages).
  (rec.reportBuilder.pages || []).forEach((p) => {
    if (p.type !== 'floor' || !p.meta) return;
    p.meta.epochId = 'current';
    if (Array.isArray(p.meta.views)) {
      p.meta.views.forEach((v) => { if (v) v.epochId = 'current'; });
    }
  });
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 5000));

const afterStamp = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = ((rec.reportBuilder || {}).pages || []).filter((p) => p.type === 'floor' && !p.meta?.reserved);
  return {
    count: floor.length,
    titles: floor.map((p) => p.title),
    epochs: [...new Set(floor.map((p) => p.meta?.epochId))],
    combinedCount: floor.filter((p) => /Combined/i.test(p.title)).length,
  };
}, FILE);

check('survey-id stamp remaps epoch without adding a second floor set',
  afterStamp.count === 4 && afterStamp.combinedCount === 1 &&
  afterStamp.epochs.length === 1 && afterStamp.epochs[0] === 'floorSurvey-source-key-1',
  JSON.stringify(afterStamp));

// Reopen again — no growth
await page.goto(`${BASE}#/file/${FILE}`, { waitUntil: 'networkidle0' });
await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 4000));

const afterReopen = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = ((rec.reportBuilder || {}).pages || []).filter((p) => p.type === 'floor' && !p.meta?.reserved);
  return { count: floor.length };
}, FILE);
check('repeated reopen does not grow floor pages',
  afterReopen.count === 4, JSON.stringify(afterReopen));

// --- Area rename (same id): no growth ---
await page.goto(`${BASE}#/file/${FILE}`, { waitUntil: 'networkidle0' });
await page.evaluate(async (id, mainId) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const canvas = rec.planSetup.canvases.find((c) => c.id === mainId);
  canvas.name = 'Main Level';
  const layer = rec.floorSurvey.byCanvasId[mainId];
  layer.areas[0].name = 'Main Level';
  layer.areas[1].name = 'Kitchen / Living Room';
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE, seeded.mainId);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 4000));

const afterRename = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = ((rec.reportBuilder || {}).pages || []).filter((p) => p.type === 'floor' && !p.meta?.reserved);
  return { count: floor.length, titles: floor.map((p) => p.title) };
}, FILE);
check('area rename without new area ids does not accumulate pages',
  afterRename.count === 4, JSON.stringify(afterRename));

// --- Empty canvasId: Present/Print blocked (before any stale boundary pages) ---
await page.goto(`${BASE}#/file/${FILE}`, { waitUntil: 'networkidle0' });
const brokenId = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = (rec.reportBuilder.pages || []).filter((p) => p.type === 'floor' && !p.meta?.reserved);
  const garage = floor.find((p) => /Garage/i.test(p.title || '') && p.meta && p.meta.scope !== 'all')
    || floor.find((p) => /garage/i.test(p.meta?.levelName || ''));
  if (!garage) {
    return { id: null, titles: floor.map((p) => p.title) };
  }
  garage.meta.canvasId = '';
  if (Array.isArray(garage.meta.views)) {
    garage.meta.views.forEach((v) => { if (v) v.canvasId = ''; });
  }
  await window.ToolboxDB.saveCustomerFile(rec);
  return { id: garage.id, title: garage.title };
}, FILE);
check('located Garage page to clear canvasId',
  !!(brokenId && brokenId.id), JSON.stringify(brokenId));

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 4000));

const printBlocked = await page.evaluate(async () => {
  const btn = document.querySelector('#rb-print');
  if (!btn) return { ok: false, detail: 'no print button' };
  btn.click();
  await new Promise((r) => setTimeout(r, 2500));
  const status = document.querySelector('#rb-save-status')?.textContent || '';
  const printDeck = !!document.querySelector('.rb-print');
  const unavailableInDom = /Floor Survey level is not available for this slide/
    .test(document.body.innerText || '');
  return { status, printDeck, unavailableInDom };
});

check('Print blocked when a floor view has empty canvasId',
  /Print blocked/i.test(printBlocked.status) && /canvasId|unresolved/i.test(printBlocked.status) &&
  printBlocked.printDeck === false,
  JSON.stringify(printBlocked));
check('blocked Print does not leave unavailable drawings in a print deck',
  printBlocked.unavailableInDom === false && printBlocked.printDeck === false,
  JSON.stringify(printBlocked));

const presentBlocked = await page.evaluate(async () => {
  const btn = document.querySelector('#rb-present');
  if (!btn) return { ok: false, detail: 'no present button' };
  btn.click();
  await new Promise((r) => setTimeout(r, 2500));
  const status = document.querySelector('#rb-save-status')?.textContent || '';
  const presenting = document.body.classList.contains('is-presenting');
  return { status, presenting };
});
check('Present blocked with slide-specific reason for unresolved Garage',
  /Present blocked/i.test(presentBlocked.status) && /Garage/i.test(presentBlocked.status) &&
  presentBlocked.presenting === false,
  JSON.stringify(presentBlocked));

// Restore Garage canvasId and drop the extra Garage page reconcile added while
// the authored one had an empty canvasId (empty key no longer covered the live source).
await page.goto(`${BASE}#/file/${FILE}`, { waitUntil: 'networkidle0' });
// Wait out Report Builder unmount autosave so it cannot overwrite the prune.
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(async (id, garagePageId, garageCanvasId) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const pages = rec.reportBuilder.pages || [];
  const pageRow = pages.find((p) => p.id === garagePageId);
  if (pageRow && pageRow.meta) {
    pageRow.meta.canvasId = garageCanvasId;
    if (Array.isArray(pageRow.meta.views)) {
      pageRow.meta.views.forEach((v) => { if (v) v.canvasId = garageCanvasId; });
    }
  }
  let seenGarage = false;
  rec.reportBuilder.pages = pages.filter((p) => {
    if (!p || p.type !== 'floor' || p.meta?.reserved) return true;
    const isGarage = /Garage/i.test(p.title || '') && p.meta?.scope !== 'all';
    if (!isGarage) return true;
    if (!seenGarage) {
      seenGarage = true;
      if (p.meta) p.meta.canvasId = garageCanvasId;
      return true;
    }
    return false;
  });
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE, brokenId && brokenId.id, seeded.garageId);

// --- Area recreation (new ids): adds new area pages; Combined key unchanged ---
await page.evaluate(async (id, mainId) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const layer = rec.floorSurvey.byCanvasId[mainId];
  layer.areas[0].id = 'area-main-level-v2';
  layer.areas[0].name = 'Main Level';
  layer.areas[1].id = 'area-kitchen-living-v2';
  layer.areas[1].name = 'Kitchen / Living Room';
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE, seeded.mainId);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 5000));

const afterRecreate = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = ((rec.reportBuilder || {}).pages || []).filter((p) => p.type === 'floor' && !p.meta?.reserved);
  return {
    count: floor.length,
    titles: floor.map((p) => p.title),
    areaIds: floor.map((p) => p.meta?.areaId),
    combinedCount: floor.filter((p) => p.meta?.scope === 'all').length,
  };
}, FILE);
// 4 authored + 2 new area pages; Combined shares source key so it is not duplicated.
const garagePages = afterRecreate.titles.filter((t) => /Garage/i.test(t)).length;
check('area recreation adds new area pages, keeps authored, does not duplicate Combined',
  afterRecreate.count === 6 && afterRecreate.combinedCount === 1 && garagePages === 1 &&
  afterRecreate.areaIds.includes('area-main-floor') &&
  afterRecreate.areaIds.includes('area-main-level-v2'),
  JSON.stringify(afterRecreate));

// Stale authored boundaries should block output (unresolved refs, no guessing)
const staleBlocked = await page.evaluate(async () => {
  document.querySelector('#rb-print')?.click();
  await new Promise((r) => setTimeout(r, 2500));
  return document.querySelector('#rb-save-status')?.textContent || '';
});
check('Print blocked for stale boundary ids after area recreation',
  /Print blocked/i.test(staleBlocked) && /boundary id/i.test(staleBlocked),
  staleBlocked);

// Keep only resolving floor pages for Present/PDF evidence (manual cleanup — not product auto-migrate)
await page.goto(`${BASE}#/file/${FILE}`, { waitUntil: 'networkidle0' });
await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const nonFloor = (rec.reportBuilder.pages || []).filter((p) => p && p.type !== 'floor');
  const floors = (rec.reportBuilder.pages || []).filter((p) => {
    if (!p || p.type !== 'floor' || p.meta?.reserved) return false;
    const layer = rec.floorSurvey.byCanvasId[p.meta.canvasId];
    if (!layer) return false;
    if (p.meta.scope === 'all' || !p.meta.areaId) return true;
    return (layer.areas || []).some((a) => a && a.id === p.meta.areaId);
  });
  rec.reportBuilder.pages = nonFloor.concat(floors);
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 5000));

const pdfProbe = await page.evaluate(async () => {
  const btn = document.querySelector('#rb-present');
  btn.click();
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    if (document.body.classList.contains('is-presenting')) break;
    const st = document.querySelector('#rb-save-status')?.textContent || '';
    if (/Present blocked|Print blocked/i.test(st)) {
      return { presenting: false, status: st, sheets: 0, unavailable: 0 };
    }
  }
  const sheets = [...document.querySelectorAll('.rb-print .rb-sheet')];
  const unavailable = sheets.filter((s) =>
    /Floor Survey level is not available for this slide/.test(s.textContent || '')).length;
  const floorSheet = sheets.find((s) => /Floor Level Survey/i.test(s.textContent || ''));
  const snippet = (floorSheet?.textContent || '').replace(/\s+/g, ' ').slice(0, 240);
  return {
    presenting: document.body.classList.contains('is-presenting'),
    sheets: sheets.length,
    unavailable,
    snippet,
    status: document.querySelector('#rb-save-status')?.textContent || '',
  };
});

check('Present opens when every floor view resolves (no unavailable notes in deck)',
  pdfProbe.presenting === true && pdfProbe.unavailable === 0 && pdfProbe.sheets > 0,
  JSON.stringify(pdfProbe));

if (pdfProbe.presenting) {
  const shot = `${OUT}/rb-floor-source-key-present.png`;
  await page.screenshot({ path: shot, fullPage: true });
  check('saved Present screenshot for review', true, shot);
}

// Intentional duplicate pages with same source key are preserved
const intentional = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = (rec.reportBuilder.pages || []).filter((p) => p.type === 'floor' && !p.meta?.reserved);
  if (floor.length < 1) return { before: 0 };
  const copy = JSON.parse(JSON.stringify(floor[0]));
  copy.id = floor[0].id + '::dup';
  copy.title = floor[0].title + ' (copy)';
  const pages = rec.reportBuilder.pages.slice();
  const at = pages.findIndex((p) => p.type === 'pictures');
  pages.splice(at >= 0 ? at : pages.length, 0, copy);
  rec.reportBuilder.pages = pages;
  await window.ToolboxDB.saveCustomerFile(rec);
  return { before: pages.filter((p) => p.type === 'floor' && !p.meta?.reserved).length };
}, FILE);

await page.goto(`${BASE}#/file/${FILE}`, { waitUntil: 'networkidle0' });
await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 4000));

const afterDup = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = ((rec.reportBuilder || {}).pages || []).filter((p) => p.type === 'floor' && !p.meta?.reserved);
  return {
    count: floor.length,
    hasCopy: floor.some((p) => /copy/i.test(p.title) || /::dup$/.test(p.id)),
  };
}, FILE);
check('intentionally duplicated floor page is preserved across reopen',
  afterDup.hasCopy === true && afterDup.count >= intentional.before,
  JSON.stringify({ intentional, afterDup }));

const shell = await page.evaluate(() => {
  const sw = performance.getEntriesByType?.('resource') || [];
  return {
    cacheHint: document.documentElement?.dataset || null,
    // shell version is in sw.js; surface from any meta if present
    title: document.title,
  };
});

await writeFile(`${OUT}/rb-floor-source-key-results.json`, JSON.stringify({
  dumpedAt: new Date().toISOString(),
  seeded,
  afterNativeOpen,
  afterStamp,
  afterReopen,
  afterRename,
  afterRecreate,
  printBlocked,
  presentBlocked,
  pdfProbe,
  afterDup,
  results,
  shell,
}, null, 2));

console.log('\nWrote', `${OUT}/rb-floor-source-key-results.json`);
console.log('Summary:', results.filter((r) => r.ok).length, 'pass /', results.length, 'total');
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
