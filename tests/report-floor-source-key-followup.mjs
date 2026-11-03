/**
 * PR #183 follow-up: canvas-resolution guard + missing verification matrix.
 * Run: node tests/report-floor-source-key-followup.mjs
 */
import { createRequire } from 'module';
import { mkdir, writeFile, readFile } from 'fs/promises';

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

function planDataUrl(w = 800, h = 600) {
  // Built in-page; placeholder for Node-side File construction helpers.
  return { w, h };
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

async function makePlan(w = 800, h = 600) {
  return page.evaluate((width, height) => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, width, height);
    x.strokeStyle = '#111';
    x.lineWidth = 4;
    x.strokeRect(20, 20, width - 40, height - 40);
    return c.toDataURL('image/jpeg', 0.9);
  }, w, h);
}

function densePoints(canvasId, originX, originY, base) {
  const points = [];
  let n = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      n += 1;
      points.push({
        id: `${canvasId}-p${n}`,
        floorId: canvasId,
        index: n,
        x: originX + col * 60,
        y: originY + row * 60,
        value: base - row * 0.4 - col * 0.1,
      });
    }
  }
  return points;
}

// ---------------------------------------------------------------------------
// 1) Canvas-resolution guard regression
// ---------------------------------------------------------------------------
const GUARD = 'rb-canvas-guard';
const planGuard = await makePlan();
await page.evaluate(async (id, plan) => {
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Guard';
  rec.lastName = 'Case';
  rec.propertyAddress = '2 Guard Lane';
  const live = rec.planSetup.canvases[0];
  live.name = 'Live Level';
  await window.ToolboxDB.putMedia('plan-guard-live', plan);
  live.plan = { id: 'plan-guard-live', width: 800, height: 600 };
  const left = [{ x: 40, y: 40 }, { x: 380, y: 40 }, { x: 380, y: 400 }, { x: 40, y: 400 }];
  const right = [{ x: 420, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 400 }, { x: 420, y: 400 }];
  const points = [];
  let n = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      n += 1;
      const kitchen = col >= 2;
      points.push({
        id: 'gp' + n,
        floorId: live.id,
        index: n,
        x: (kitchen ? 480 : 100) + (col % 2) * 80,
        y: 80 + row * 90,
        value: kitchen ? 9.4 - row * 0.3 : 9.0 - row * 0.4,
      });
    }
  }
  rec.floorSurvey = {
    id: 'floorSurvey-guard-1',
    inspectionDate: '2026-10-09',
    byCanvasId: {
      [live.id]: {
        canvasId: live.id,
        points,
        areas: [
          { id: 'area-live-a', name: 'Room A', polygon: left, createdAt: 1 },
          { id: 'area-live-b', name: 'Room B', polygon: right, createdAt: 2 },
        ],
        boundary: [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 }],
      },
    },
  };
  // Authored report: one resolvable current page + one unresolvable orphan canvas.
  const livePageId = `floor-current::${live.id}::area-live-a`;
  const orphanCanvas = 'canvas-orphan-gone';
  const orphanPageId = `floor-current::${orphanCanvas}::area-orphan`;
  rec.reportBuilder = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    activePageId: livePageId,
    pages: [
      {
        id: 'cover-1', type: 'cover', title: 'Cover', tocTitle: 'Cover', railLabel: 'Cover',
        includeInToc: true, meta: {}, reportText: null,
      },
      {
        id: livePageId, type: 'floor', title: 'Floor Level Survey — Room A',
        tocTitle: 'Floor Level Survey — Room A', railLabel: 'Floor · Room A',
        includeInToc: true,
        meta: {
          canvasId: live.id, epochId: 'current', areaId: 'area-live-a', scope: 'area',
          levelName: 'Room A', imported: true,
        },
        reportText: null,
      },
      {
        id: orphanPageId, type: 'floor', title: 'Floor Level Survey — Orphan',
        tocTitle: 'Floor Level Survey — Orphan', railLabel: 'Floor · Orphan',
        includeInToc: true,
        meta: {
          canvasId: orphanCanvas, epochId: 'current', areaId: 'area-orphan', scope: 'area',
          levelName: 'Orphan', imported: true,
        },
        reportText: null,
      },
    ],
  };
  await window.ToolboxDB.saveCustomerFile(rec);
  return { liveId: live.id };
}, GUARD, planGuard);

await page.goto(`${BASE}#/file/${GUARD}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 4000));

const guardState = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = (rec.reportBuilder.pages || []).filter((p) => p.type === 'floor' && !p.meta?.reserved);
  const live = floor.find((p) => /Room A/i.test(p.title));
  const orphan = floor.find((p) => /Orphan/i.test(p.title));
  return {
    liveEpoch: live?.meta?.epochId,
    orphanEpoch: orphan?.meta?.epochId,
    titles: floor.map((p) => p.title),
    count: floor.length,
  };
}, GUARD);

check('guard: resolvable current page remaps to floorSurvey.id',
  guardState.liveEpoch === 'floorSurvey-guard-1', JSON.stringify(guardState));
check('guard: unresolvable orphan keeps current (not remapped)',
  guardState.orphanEpoch === 'current', JSON.stringify(guardState));

const guardPrint = await page.evaluate(async () => {
  document.querySelector('#rb-print')?.click();
  await new Promise((r) => setTimeout(r, 2500));
  return {
    status: document.querySelector('#rb-save-status')?.textContent || '',
    printDeck: !!document.querySelector('.rb-print'),
  };
});
check('guard: Print fails closed on unresolvable orphan (explicit)',
  /Print blocked/i.test(guardPrint.status) && /Orphan|layer not found|canvas is not/i.test(guardPrint.status) &&
  guardPrint.printDeck === false,
  JSON.stringify(guardPrint));

// ---------------------------------------------------------------------------
// 2) Recovery import / replacement via ToolboxCustomerFileImport
// ---------------------------------------------------------------------------
const RECOVERY = 'rb-recovery-import';
const planRecovery = await makePlan();
const recoverySeed = await page.evaluate(async (id, plan) => {
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Recovery';
  rec.lastName = 'Import';
  rec.propertyAddress = '3 Recovery Road';
  const main = rec.planSetup.canvases[0];
  main.name = 'Original Level';
  await window.ToolboxDB.putMedia('plan-recovery-orig', plan);
  main.plan = { id: 'plan-recovery-orig', width: 800, height: 600 };
  const poly = [{ x: 40, y: 40 }, { x: 700, y: 40 }, { x: 700, y: 500 }, { x: 40, y: 500 }];
  const points = [];
  let n = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      n += 1;
      points.push({
        id: 'rp' + n, floorId: main.id, index: n,
        x: 100 + col * 80, y: 80 + row * 90, value: 9.2 - row * 0.3,
      });
    }
  }
  rec.floorSurvey = {
    id: 'floorSurvey-recovery-1',
    inspectionDate: '2026-10-09',
    byCanvasId: {
      [main.id]: {
        canvasId: main.id,
        points,
        areas: [{ id: 'area-original', name: 'Original Room', polygon: poly, createdAt: 1 }],
        boundary: poly,
      },
    },
  };
  await window.ToolboxDB.saveCustomerFile(rec);
  return { mainId: main.id, updatedAt: (await window.ToolboxDB.getCustomerFile(id)).updatedAt };
}, RECOVERY, planRecovery);

await page.goto(`${BASE}#/file/${RECOVERY}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 4000));

const beforeImport = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = (rec.reportBuilder.pages || []).filter((p) => p.type === 'floor' && !p.meta?.reserved);
  return {
    count: floor.length,
    areaIds: floor.map((p) => p.meta?.areaId),
    updatedAt: rec.updatedAt,
  };
}, RECOVERY);

const importResult = await page.evaluate(async (id, plan, targetUpdatedAt) => {
  const floorId = 'legacy-floor-1';
  const poly = [{ x: 50, y: 50 }, { x: 720, y: 50 }, { x: 720, y: 520 }, { x: 50, y: 520 }];
  const points = [];
  for (let i = 0; i < 12; i += 1) {
    points.push({
      id: 'legacy-pt-' + i,
      floorId,
      x: 120 + (i % 4) * 80,
      y: 100 + Math.floor(i / 4) * 80,
      value: 10 - i * 0.2,
      index: i + 1,
    });
  }
  const bundle = {
    kind: 'floor-survey-bundle',
    bundleVersion: 1,
    project: {
      client: 'Recovery Import',
      address: '3 Recovery Road',
      inspectionDate: '2026-10-10',
      notes: '',
      customSurfaces: [],
    },
    floors: [{
      id: floorId,
      name: 'Recovered Level',
      order: 0,
      planDataUrl: plan,
      planWidth: 800,
      planHeight: 600,
      boundary: poly,
      areas: [{ id: 'legacy-area-1', name: 'Recovered Room', polygon: poly, createdAt: 1 }],
      transitions: [],
    }],
    points,
  };
  const json = JSON.stringify(bundle);
  const file = new File([json], 'recovery-floor.json', { type: 'application/json' });
  const parsed = await window.ToolboxCustomerFileImport.inspectFile(file);
  const ctx = await window.ToolboxCustomerFileImport.getImportContext(parsed, id);
  const fieldChoices = {};
  (ctx.conflicts || []).forEach((c) => { fieldChoices[c.field] = 'import'; });
  // Keep customer identity as already on the Customer File when both sides match;
  // still resolve every reported conflict so applyImport can proceed.
  const applied = await window.ToolboxCustomerFileImport.applyImport(parsed, id, {
    canvasChoice: 'add',
    confirmAddFloorLevels: true,
    targetUpdatedAt: ctx.targetUpdatedAt || targetUpdatedAt,
    fieldChoices,
  });
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const recoveredCanvasIds = (applied.canvasIds || []).concat(applied.attachedCanvasIds || []);
  const layers = Object.keys(rec.floorSurvey.byCanvasId || {});
  const reminted = [];
  layers.forEach((cv) => {
    (rec.floorSurvey.byCanvasId[cv].areas || []).forEach((a) => {
      if (String(a.id || '').startsWith('area-import')) reminted.push(a.id);
    });
  });
  return {
    fingerprint: applied.fingerprint,
    canvasIds: recoveredCanvasIds,
    remintedAreaIds: reminted,
    floorCanvasCount: layers.length,
    updatedAt: rec.updatedAt,
  };
}, RECOVERY, planRecovery, beforeImport.updatedAt);

check('recovery import applies via ToolboxCustomerFileImport',
  !!importResult.fingerprint && importResult.remintedAreaIds.length >= 1,
  JSON.stringify(importResult));

await page.goto(`${BASE}#/file/${RECOVERY}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));
await page.goto(`${BASE}#/file/${RECOVERY}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 5000));

const afterImport = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = (rec.reportBuilder.pages || []).filter((p) => p.type === 'floor' && !p.meta?.reserved);
  return {
    count: floor.length,
    areaIds: floor.map((p) => p.meta?.areaId),
    titles: floor.map((p) => p.title),
    hasOriginal: floor.some((p) => p.meta?.areaId === 'area-original'),
    hasImportArea: floor.some((p) => String(p.meta?.areaId || '').startsWith('area-import')),
  };
}, RECOVERY);

check('recovery import adds reminted-area pages without deleting authored original',
  afterImport.count > beforeImport.count && afterImport.hasOriginal && afterImport.hasImportArea,
  JSON.stringify({ beforeImport, afterImport }));

// Replace: remove imported component, import again with a different fingerprint.
const replaceResult = await page.evaluate(async (id, plan, fingerprint) => {
  await window.ToolboxCustomerFileImport.removeImportedComponent(id, fingerprint);
  const recAfterRemove = await window.ToolboxDB.getCustomerFile(id);
  const floorId = 'legacy-floor-2';
  const poly = [{ x: 60, y: 60 }, { x: 700, y: 60 }, { x: 700, y: 500 }, { x: 60, y: 500 }];
  const points = [];
  for (let i = 0; i < 12; i += 1) {
    points.push({
      id: 'legacy2-pt-' + i, floorId,
      x: 140 + (i % 4) * 70, y: 110 + Math.floor(i / 4) * 70,
      value: 9.8 - i * 0.15, index: i + 1,
    });
  }
  const bundle = {
    kind: 'floor-survey-bundle', bundleVersion: 1,
    project: {
      client: 'Recovery Import', address: '3 Recovery Road',
      inspectionDate: '2026-10-11', notes: '', customSurfaces: [],
    },
    floors: [{
      id: floorId, name: 'Recovered Level B', order: 0,
      planDataUrl: plan, planWidth: 800, planHeight: 600,
      boundary: poly,
      areas: [{ id: 'legacy-area-2', name: 'Recovered Room B', polygon: poly, createdAt: 1 }],
      transitions: [],
    }],
    points,
  };
  const file = new File([JSON.stringify(bundle)], 'recovery-floor-b.json', { type: 'application/json' });
  const parsed = await window.ToolboxCustomerFileImport.inspectFile(file);
  const ctx = await window.ToolboxCustomerFileImport.getImportContext(parsed, id);
  const fieldChoices = {};
  (ctx.conflicts || []).forEach((c) => { fieldChoices[c.field] = 'import'; });
  const applied = await window.ToolboxCustomerFileImport.applyImport(parsed, id, {
    canvasChoice: 'add',
    confirmAddFloorLevels: true,
    targetUpdatedAt: ctx.targetUpdatedAt || recAfterRemove.updatedAt,
    fieldChoices,
  });
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const reminted = [];
  Object.keys(rec.floorSurvey.byCanvasId || {}).forEach((cv) => {
    (rec.floorSurvey.byCanvasId[cv].areas || []).forEach((a) => {
      if (String(a.id || '').startsWith('area-import')) reminted.push(a.id);
    });
  });
  return {
    newFingerprint: applied.fingerprint,
    reminted,
    recoveryCount: (rec.recoveryImports || []).filter((e) => e.kind === 'floor').length,
  };
}, RECOVERY, planRecovery, importResult.fingerprint);

check('recovery replacement remints area ids again via import path',
  replaceResult.reminted.length >= 1 &&
  replaceResult.newFingerprint !== importResult.fingerprint,
  JSON.stringify(replaceResult));

await page.goto(`${BASE}#/file/${RECOVERY}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));
await page.goto(`${BASE}#/file/${RECOVERY}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 5000));

const afterReplace = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = (rec.reportBuilder.pages || []).filter((p) => p.type === 'floor' && !p.meta?.reserved);
  return {
    count: floor.length,
    hasOriginal: floor.some((p) => p.meta?.areaId === 'area-original'),
    importAreas: floor.map((p) => p.meta?.areaId).filter((a) => String(a || '').startsWith('area-import')),
  };
}, RECOVERY);

check('after replacement, authored original pages remain; new import areas appear',
  afterReplace.hasOriginal && afterReplace.importAreas.length >= 1,
  JSON.stringify(afterReplace));

// ---------------------------------------------------------------------------
// 3) Multi-view drawing / statistics correspondence
// ---------------------------------------------------------------------------
const MULTI = 'rb-multiview-stats';
const planMulti = await makePlan();
await page.evaluate(async (id, plan) => {
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Multi';
  rec.lastName = 'View';
  rec.propertyAddress = '4 Multi View Way';
  const main = rec.planSetup.canvases[0];
  main.name = 'Main';
  await window.ToolboxDB.putMedia('plan-multi', plan);
  main.plan = { id: 'plan-multi', width: 800, height: 600 };
  const left = [{ x: 40, y: 40 }, { x: 380, y: 40 }, { x: 380, y: 400 }, { x: 40, y: 400 }];
  const right = [{ x: 420, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 400 }, { x: 420, y: 400 }];
  const points = [];
  let n = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      n += 1;
      const kitchen = col >= 2;
      points.push({
        id: 'mv' + n, floorId: main.id, index: n,
        x: (kitchen ? 480 : 100) + (col % 2) * 90,
        y: 90 + row * 90,
        value: kitchen ? (8.8 - row * 0.3) : (9.6 - row * 0.4),
      });
    }
  }
  rec.floorSurvey = {
    id: 'floorSurvey-multi-1',
    inspectionDate: '2026-10-09',
    byCanvasId: {
      [main.id]: {
        canvasId: main.id, points,
        areas: [
          { id: 'area-mv-a', name: 'West', polygon: left, createdAt: 1 },
          { id: 'area-mv-b', name: 'East', polygon: right, createdAt: 2 },
        ],
        boundary: [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 }],
      },
    },
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, MULTI, planMulti);

await page.goto(`${BASE}#/file/${MULTI}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 5000));

const multiSetup = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = (rec.reportBuilder.pages || []).filter((p) => p.type === 'floor' && !p.meta?.reserved);
  const west = floor.find((p) => p.meta?.areaId === 'area-mv-a');
  if (!west) return { ok: false, floor: floor.map((p) => p.meta) };
  // Promote west page to two views (West + East) on one slide.
  west.meta.views = [
    {
      id: 'v0', canvasId: west.meta.canvasId, epochId: west.meta.epochId,
      areaId: 'area-mv-a', scope: 'area',
      showLegend: false, showPill: false,
      frame: { x: 0, y: 0, w: 48, h: 100, z: 1 },
    },
    {
      id: 'v1', canvasId: west.meta.canvasId, epochId: west.meta.epochId,
      areaId: 'area-mv-b', scope: 'area',
      showLegend: false, showPill: false,
      frame: { x: 52, y: 0, w: 48, h: 100, z: 1 },
    },
  ];
  west.meta.floorTwoUp = true;
  west.title = 'Floor Level Survey — West / East';
  // Drop the separate East page so Present only needs Combined + multi + maybe Combined
  rec.reportBuilder.pages = (rec.reportBuilder.pages || []).filter((p) => {
    if (!p || p.type !== 'floor') return true;
    if (p.id === west.id) return true;
    if (p.meta?.areaId === 'area-mv-b') return false;
    return true;
  });
  await window.ToolboxDB.saveCustomerFile(rec);
  return { westId: west.id, canvasId: west.meta.canvasId, epochId: west.meta.epochId };
}, MULTI);

await page.goto(`${BASE}#/file/${MULTI}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1000));
await page.goto(`${BASE}#/file/${MULTI}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 5000));

const multiStats = await page.evaluate(async (setup) => {
  const rec = await window.ToolboxDB.getCustomerFile('rb-multiview-stats');
  const getMedia = window.ToolboxDB.getMedia.bind(window.ToolboxDB);
  const api = window.ToolboxFloorSurvey;
  const a = await api.composeReportTopoFigureForPage(rec, {
    canvasId: setup.canvasId, epochId: 'floorSurvey-multi-1',
    areaId: 'area-mv-a', scope: 'area',
  }, getMedia);
  const b = await api.composeReportTopoFigureForPage(rec, {
    canvasId: setup.canvasId, epochId: 'floorSurvey-multi-1',
    areaId: 'area-mv-b', scope: 'area',
  }, getMedia);
  // Open Present so composeFloorStills writes _viewStats / _liveStats on pages
  document.querySelector('#rb-present')?.click();
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 400));
    if (document.body.classList.contains('is-presenting')) break;
    const st = document.querySelector('#rb-save-status')?.textContent || '';
    if (/Present blocked/i.test(st)) {
      return { presenting: false, status: st };
    }
  }
  const sheets = [...document.querySelectorAll('.rb-print .rb-sheet')];
  // Multi-view sheet: Relative readings names both view sources (West + East).
  const multiSheet = sheets.find((s) => {
    const t = s.textContent || '';
    return /Relative readings/i.test(t) && /West/i.test(t) && /East/i.test(t);
  });
  const sheetText = (multiSheet?.textContent || '').replace(/\s+/g, ' ');
  const dataImgs = multiSheet
    ? [...multiSheet.querySelectorAll('img')].filter((img) => (img.src || '').startsWith('data:image')).length
    : 0;
  const statsA = (a?.stats || []).map((s) => ({ name: s.name, hi: s.hi, lo: s.lo, delta: s.delta }));
  const statsB = (b?.stats || []).map((s) => ({ name: s.name, hi: s.hi, lo: s.lo, delta: s.delta }));
  const hiA = statsA[0] && Number(statsA[0].hi).toFixed(1);
  const hiB = statsB[0] && Number(statsB[0].hi).toFixed(1);
  const loA = statsA[0] && Number(statsA[0].lo).toFixed(1);
  const loB = statsB[0] && Number(statsB[0].lo).toFixed(1);
  return {
    presenting: document.body.classList.contains('is-presenting'),
    dataImgs,
    sheetTitles: sheets.map((s) => (s.textContent || '').replace(/\s+/g, ' ').slice(0, 80)),
    statsA, statsB,
    railSnippet: sheetText.slice(0, 360),
    railHasWest: /West/i.test(sheetText),
    railHasEast: /East/i.test(sheetText),
    railHasHiA: hiA ? sheetText.includes(hiA) : false,
    railHasHiB: hiB ? sheetText.includes(hiB) : false,
    railHasLoA: loA ? sheetText.includes(loA) : false,
    railHasLoB: loB ? sheetText.includes(loB) : false,
    composedOk: !!(a?.dataUrl && b?.dataUrl),
  };
}, multiSetup);

check('multi-view Present opens with composed stills',
  multiStats.presenting === true && multiStats.composedOk === true && multiStats.dataImgs >= 1,
  JSON.stringify(multiStats));
check('multi-view rail readings correspond to both view sources',
  multiStats.railHasWest && multiStats.railHasEast &&
  multiStats.railHasHiA && multiStats.railHasHiB &&
  multiStats.railHasLoA && multiStats.railHasLoB,
  JSON.stringify(multiStats));

if (multiStats.presenting) {
  await page.screenshot({ path: `${OUT}/rb-multiview-present.png`, fullPage: true });
  // Close present
  await page.evaluate(() => document.querySelector('[data-present="close"]')?.click());
  await new Promise((r) => setTimeout(r, 500));
}

// ---------------------------------------------------------------------------
// 4) Real PDF with floor drawings + matching relative readings
// ---------------------------------------------------------------------------
const PDF = 'rb-pdf-inspect';
const planPdf = await makePlan();
await page.evaluate(async (id, plan) => {
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Pdf';
  rec.lastName = 'Inspect';
  rec.propertyAddress = '5 Pdf Court';
  const main = rec.planSetup.canvases[0];
  main.name = 'Main Floor';
  await window.ToolboxDB.putMedia('plan-pdf', plan);
  main.plan = { id: 'plan-pdf', width: 800, height: 600 };
  const left = [{ x: 40, y: 40 }, { x: 380, y: 40 }, { x: 380, y: 400 }, { x: 40, y: 400 }];
  const right = [{ x: 420, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 400 }, { x: 420, y: 400 }];
  const points = [];
  let n = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      n += 1;
      const kitchen = col >= 2;
      points.push({
        id: 'pdfp' + n, floorId: main.id, index: n,
        x: (kitchen ? 480 : 100) + (col % 2) * 90,
        y: 90 + row * 90,
        value: kitchen ? (9.1 - row * 0.3) : (9.5 - row * 0.4),
      });
    }
  }
  rec.floorSurvey = {
    id: 'floorSurvey-pdf-1',
    inspectionDate: '2026-10-09',
    byCanvasId: {
      [main.id]: {
        canvasId: main.id, points,
        areas: [
          { id: 'area-pdf-a', name: 'Living', polygon: left, createdAt: 1 },
          { id: 'area-pdf-b', name: 'Kitchen', polygon: right, createdAt: 2 },
        ],
        boundary: [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 }],
      },
    },
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, PDF, planPdf);

await page.goto(`${BASE}#/file/${PDF}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 5000));

const pdfProbe = await page.evaluate(async () => {
  const rec = await window.ToolboxDB.getCustomerFile('rb-pdf-inspect');
  const floorPages = (rec.reportBuilder.pages || []).filter((p) => p.type === 'floor' && !p.meta?.reserved);
  const getMedia = window.ToolboxDB.getMedia.bind(window.ToolboxDB);
  const expected = [];
  for (const fp of floorPages) {
    const composed = await window.ToolboxFloorSurvey.composeReportTopoFigureForPage(rec, {
      canvasId: fp.meta.canvasId,
      epochId: fp.meta.epochId || rec.floorSurvey.id,
      areaId: fp.meta.scope === 'all' ? null : fp.meta.areaId,
      scope: fp.meta.scope || 'all',
    }, getMedia);
    expected.push({
      title: fp.title,
      hasDrawing: !!(composed && composed.dataUrl),
      stats: (composed?.stats || []).map((s) => ({
        name: s.name,
        hi: Number(s.hi).toFixed(1),
        lo: Number(s.lo).toFixed(1),
        delta: Number(s.delta).toFixed(1),
      })),
    });
  }

  document.querySelector('#rb-present')?.click();
  for (let i = 0; i < 50; i += 1) {
    await new Promise((r) => setTimeout(r, 400));
    if (document.body.classList.contains('is-presenting')) break;
    const st = document.querySelector('#rb-save-status')?.textContent || '';
    if (/Present blocked/i.test(st)) return { presenting: false, status: st, expected };
  }

  const sheets = [...document.querySelectorAll('.rb-print .rb-sheet')];
  // Figure sheets only — Relative readings + a composed data:image still.
  const floorSheets = sheets.filter((s) => {
    const t = s.textContent || '';
    if (!/Relative readings/i.test(t)) return false;
    return [...s.querySelectorAll('img')].some((img) => (img.src || '').startsWith('data:image'));
  });
  const unavailable = sheets.filter((s) =>
    /Floor Survey level is not available for this slide/.test(s.textContent || '')).length;
  const inspected = floorSheets.map((s) => {
    const text = (s.textContent || '').replace(/\s+/g, ' ');
    const imgs = [...s.querySelectorAll('img')].filter((img) =>
      (img.src || '').startsWith('data:image')).length;
    return { text: text.slice(0, 400), imgs, full: text };
  });

  return {
    presenting: true,
    floorSheetCount: floorSheets.length,
    expectedCount: expected.length,
    unavailable,
    expected,
    inspected,
  };
});

check('PDF path Present opens with all floor sheets and no unavailable notes',
  pdfProbe.presenting && pdfProbe.unavailable === 0 &&
  pdfProbe.floorSheetCount === pdfProbe.expectedCount && pdfProbe.expectedCount >= 3,
  JSON.stringify({
    presenting: pdfProbe.presenting,
    floorSheetCount: pdfProbe.floorSheetCount,
    expectedCount: pdfProbe.expectedCount,
    unavailable: pdfProbe.unavailable,
  }));

const readingsMatch = (pdfProbe.expected || []).every((exp) => {
  const short = exp.title.replace(/^Floor Level Survey — /, '');
  const sheet = (pdfProbe.inspected || []).find((s) => {
    const full = s.full || '';
    // Prefer the sheet whose drawing title matches this figure.
    return new RegExp('Drawing title\\s*Floor Level Survey\\s*' + short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(full)
      || full.includes(exp.title);
  });
  if (!sheet || sheet.imgs < 1) return false;
  return (exp.stats || []).every((st) =>
    sheet.full.includes(st.hi) && sheet.full.includes(st.lo) && sheet.full.includes(st.name));
});
check('each floor sheet drawing has matching relative readings from same source',
  readingsMatch === true,
  JSON.stringify({
    expected: pdfProbe.expected,
    inspected: (pdfProbe.inspected || []).map((s) => ({ imgs: s.imgs, text: s.text })),
  }));

let pdfBytes = 0;
if (pdfProbe.presenting) {
  const pdf = await page.pdf({
    path: `${OUT}/rb-floor-source-key-report.pdf`,
    printBackground: true,
    landscape: true,
    width: '17in',
    height: '11in',
  });
  pdfBytes = pdf?.length || (await readFile(`${OUT}/rb-floor-source-key-report.pdf`)).length;
  check('generated real PDF artifact', pdfBytes > 20000, `bytes=${pdfBytes}`);
  await page.screenshot({ path: `${OUT}/rb-pdf-present-floor.png`, fullPage: true });
  await page.evaluate(() => document.querySelector('[data-present="close"]')?.click());
  await new Promise((r) => setTimeout(r, 400));
} else {
  check('generated real PDF artifact', false, 'Present did not open');
}

// ---------------------------------------------------------------------------
// 5) Report without Floor Survey pages Present/Print without composer
// ---------------------------------------------------------------------------
const NOFLOOR = 'rb-no-floor-present';
await page.evaluate(async (id) => {
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'No';
  rec.lastName = 'Floor';
  rec.propertyAddress = '6 No Floor Ave';
  // No floorSurvey work — delete byCanvasId layers
  rec.floorSurvey = { inspectionDate: '', byCanvasId: {} };
  rec.reportBuilder = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    activePageId: 'cover-nf',
    pages: [
      {
        id: 'cover-nf', type: 'cover', title: 'Cover', tocTitle: 'Cover', railLabel: 'Cover',
        includeInToc: true, meta: {}, reportText: null,
      },
      {
        id: 'discussion-nf', type: 'section', title: 'Discussion',
        tocTitle: 'Floor Level Survey Results - Discussion', railLabel: 'Discussion',
        includeInToc: true, meta: { sectionId: 'discussion' }, reportText: { body: 'Notes.' },
      },
    ],
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, NOFLOOR);

await page.goto(`${BASE}#/file/${NOFLOOR}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 2000));

const noFloorPresent = await page.evaluate(async () => {
  // Force Floor Survey composer offline for this check.
  const saved = window.ToolboxFloorSurvey;
  window.ToolboxFloorSurvey = undefined;
  try {
    document.querySelector('#rb-present')?.click();
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 300));
      if (document.body.classList.contains('is-presenting')) {
        const sheets = document.querySelectorAll('.rb-print .rb-sheet').length;
        document.querySelector('[data-present="close"]')?.click();
        return { presenting: true, sheets, status: '' };
      }
      const st = document.querySelector('#rb-save-status')?.textContent || '';
      if (/Present blocked|failed|compose/i.test(st)) {
        return { presenting: false, sheets: 0, status: st };
      }
    }
    return {
      presenting: document.body.classList.contains('is-presenting'),
      sheets: document.querySelectorAll('.rb-print .rb-sheet').length,
      status: document.querySelector('#rb-save-status')?.textContent || 'timeout',
    };
  } finally {
    window.ToolboxFloorSurvey = saved;
  }
});

check('no-floor report Presents without Floor Survey composer',
  noFloorPresent.presenting === true && noFloorPresent.sheets >= 2,
  JSON.stringify(noFloorPresent));

const noFloorPrint = await page.evaluate(async () => {
  const saved = window.ToolboxFloorSurvey;
  window.ToolboxFloorSurvey = undefined;
  try {
    document.querySelector('#rb-print')?.click();
    await new Promise((r) => setTimeout(r, 2000));
    const status = document.querySelector('#rb-save-status')?.textContent || '';
    const blocked = /Print blocked|compose is not available/i.test(status);
    const printDeck = !!document.querySelector('.rb-print');
    // Clear any print deck remnant
    document.querySelectorAll('.rb-print').forEach((el) => el.remove());
    document.body.classList.remove('is-printing');
    return { blocked, status, printDeckStarted: printDeck || /Saved|Print/i.test(status) };
  } finally {
    window.ToolboxFloorSurvey = saved;
  }
});

check('no-floor report Print path does not require Floor Survey composer',
  noFloorPrint.blocked === false,
  JSON.stringify(noFloorPrint));

await writeFile(`${OUT}/rb-floor-source-key-followup.json`, JSON.stringify({
  dumpedAt: new Date().toISOString(),
  guardState, guardPrint,
  beforeImport, importResult, afterImport, replaceResult, afterReplace,
  multiStats, pdfProbe: {
    presenting: pdfProbe.presenting,
    floorSheetCount: pdfProbe.floorSheetCount,
    expectedCount: pdfProbe.expectedCount,
    unavailable: pdfProbe.unavailable,
    expected: pdfProbe.expected,
  },
  pdfBytes,
  noFloorPresent, noFloorPrint,
  results,
}, null, 2));

console.log('\nWrote', `${OUT}/rb-floor-source-key-followup.json`);
console.log('Summary:', results.filter((r) => r.ok).length, 'pass /', results.length, 'total');
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
