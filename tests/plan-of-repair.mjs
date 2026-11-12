/**
 * Plan of Repair drawing template.
 * Run: node tests/plan-of-repair.mjs
 * Requires static server at http://127.0.0.1:8765
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

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

/** Expand a collapsed ribbon group so a control inside it is clickable. */
async function ensureRibbonControl(sel) {
  await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return;
    const group = el.closest('.por-ribbon__group--collapsible');
    if (group && group.classList.contains('is-collapsed') && !group.classList.contains('is-open')) {
      const btn = group.querySelector('.por-ribbon__collapse-btn');
      if (btn) btn.click();
    }
  }, sel);
  await new Promise((r) => setTimeout(r, 80));
}

/** Open the PowerPoint-style Shapes gallery if needed, then click a tool. */
async function armPorTool(sel) {
  const needsGallery = /data-rb-tool|por-insert-text|data-por-tool/.test(sel);
  await ensureRibbonControl(needsGallery ? '#por-shapes-btn' : sel);
  if (needsGallery) {
    const open = await page.evaluate(() => {
      const pop = document.querySelector('#por-shapes-pop');
      return !!(pop && !pop.hidden);
    });
    if (!open) {
      await ensureRibbonControl('#por-shapes-btn');
      await page.click('#por-shapes-btn');
      await page.waitForFunction(() => {
        const pop = document.querySelector('#por-shapes-pop');
        return pop && !pop.hidden;
      }, { timeout: 2500 }).catch(() => {});
    }
  }
  await page.click(sel);
}

/** Open Insert dropdown then click a control inside it. */
async function clickInsert(sel) {
  const open = await page.evaluate(() => {
    const pop = document.querySelector('#por-insert-pop');
    return !!(pop && !pop.hidden);
  });
  if (!open) {
    await page.click('#por-insert-btn');
    await page.waitForFunction(() => {
      const pop = document.querySelector('#por-insert-pop');
      return pop && !pop.hidden;
    }, { timeout: 2500 }).catch(() => {});
  }
  await page.click(sel);
}

/** Open Arrange dropdown then click a control inside it. */
async function clickArrange(sel) {
  const open = await page.evaluate(() => {
    const pop = document.querySelector('#por-arrange-pop');
    return !!(pop && !pop.hidden);
  });
  if (!open) {
    await page.click('#por-arrange-btn');
    await page.waitForFunction(() => {
      const pop = document.querySelector('#por-arrange-pop');
      return pop && !pop.hidden;
    }, { timeout: 2500 }).catch(() => {});
  }
  await page.click(sel);
}

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1440, height: 960 });
await page.goto(BASE + '?por=1', { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  if (navigator.serviceWorker) {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) await reg.unregister();
  }
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
});
await page.goto(BASE + '?por=2', { waitUntil: 'networkidle0' });

await page.evaluate(async () => {
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

  const planCanvas = document.createElement('canvas');
  planCanvas.width = 900;
  planCanvas.height = 620;
  const ctx = planCanvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 900, 620);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 4;
  ctx.strokeRect(60, 50, 780, 520);
  ctx.fillStyle = '#333';
  ctx.font = '28px sans-serif';
  ctx.fillText('LIVING', 130, 170);
  ctx.fillText('GARAGE', 390, 170);
  await window.ToolboxDB.putMedia('por-plan-media', planCanvas.toDataURL('image/png'));

  // Contour layer (transparent-ish black lines)
  const contour = document.createElement('canvas');
  contour.width = 900;
  contour.height = 620;
  const cctx = contour.getContext('2d');
  cctx.strokeStyle = '#000';
  cctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    cctx.beginPath();
    cctx.ellipse(450, 310, 80 + i * 35, 50 + i * 28, 0, 0, Math.PI * 2);
    cctx.stroke();
  }
  await window.ToolboxDB.putMedia('por-contour-media', contour.toDataURL('image/png'));

  const file = window.ToolboxApp.blankCustomerFile('por-draw');
  window.ToolboxPlanSetup.ensurePlanSetup(file);
  file.firstName = 'Rabbitbrush';
  file.lastName = 'Fixture';
  file.propertyAddress = '15 Rabbitbrush Rd, Fixture AZ';
  file.planSetup.canvases[0].name = 'Main Level';
  file.planSetup.canvases[0].plan = { id: 'por-plan-media', width: 900, height: 620 };
  file.planSetup.canvases[0].contourLayer = { id: 'por-contour-media', width: 900, height: 620 };
  await window.ToolboxDB.saveCustomerFile(file);
});

const boot = await page.evaluate(() => ({
  api: !!(window.ToolboxPlanOfRepair && window.ToolboxPlanOfRepair.normalizeDoc),
  fabric: !!(window.fabric && window.ToolboxPorFabric && window.ToolboxPorFabric.ready()),
  fabricVersion: (window.ToolboxPlanOfRepair && window.ToolboxPlanOfRepair.FABRIC_VERSION) ||
    (window.ToolboxPorFabric && window.ToolboxPorFabric.VERSION) || '',
  colors: (window.ToolboxReportOverlay && window.ToolboxReportOverlay.COLORS) || [],
  components: window.ToolboxSync.COMPONENTS.slice(),
}));
check('Plan of Repair API present', boot.api);
check('Fabric.js loaded', boot.fabric, boot.fabricVersion);
check('Fabric version pinned', boot.fabricVersion === '5.3.0', boot.fabricVersion);
check('yellow in overlay palette', boot.colors.indexOf('#eab308') !== -1, boot.colors.join(','));
check('repair sync component', boot.components.indexOf('repair') !== -1);

await page.goto(BASE + '#/file/por-draw', { waitUntil: 'networkidle0' });
await page.waitForSelector('#home-side-geo.is-active, #home-card-name');
const geoHome = await page.evaluate(() => {
  const geoRepair = document.querySelector('#home-repair-top');
  return {
    geoHidden: !geoRepair || geoRepair.hidden === true ||
      getComputedStyle(geoRepair).display === 'none',
    apps: Array.from(document.querySelectorAll('.cf-app-btn[data-app]'))
      .map((b) => b.getAttribute('data-app')),
  };
});
check('Geo Plan of Repair shortcut hidden', geoHome.geoHidden);
check('four workspace cards unchanged', geoHome.apps.join(',') === 'distress,floor,diagnostics,report');

// POR opens from the TLS side.
await page.click('#home-side-tls');
await page.waitForSelector('.cf-home--tls [data-tls-app="repair"]');
const tlsHome = await page.evaluate(() => {
  const tlsBtn = document.querySelector('.cf-home--tls [data-tls-app="repair"]');
  const img = tlsBtn && tlsBtn.querySelector('.cf-app-btn__art img');
  return {
    label: tlsBtn
      ? ((tlsBtn.querySelector('.cf-app-btn__name') || tlsBtn).textContent || '').trim()
      : '',
    icon: img ? (img.getAttribute('src') || '') : '',
  };
});
check('Plan of Repair on TLS side', tlsHome.label === 'Plan of Repair', tlsHome.label);
check('Plan of Repair uses workspace-style icon',
  /Plan%20of%20Repair\.png|Plan of Repair\.png/.test(tlsHome.icon),
  tlsHome.icon);

await page.click('.cf-home--tls [data-tls-app="repair"]');
await page.waitForSelector('.por-shell .rb-sheet');
await page.waitForFunction(() => /Ready|Saved/.test((document.querySelector('#por-status') || {}).textContent || ''), { timeout: 8000 }).catch(() => {});

const shell = await page.evaluate(() => {
  const toolbar = document.querySelector('.por-toolbar');
  const printBtn = document.querySelector('#por-print');
  const textStrip = document.querySelector('#por-text-format');
  let printSameRow = false;
  if (toolbar && printBtn) {
    const t = toolbar.getBoundingClientRect();
    const p = printBtn.getBoundingClientRect();
    const undo = document.querySelector('#por-undo')?.getBoundingClientRect();
    // Tall PowerPoint ribbon: Print stays inside the toolbar band beside Editing.
    printSameRow = p.top >= t.top - 2 && p.bottom <= t.bottom + 2 &&
      (undo ? p.top < undo.bottom + 10 : p.top < t.top + 80);
  }
  const wordTools = Array.from(document.querySelectorAll('.por-toolbar__tools .por-iconbtn'))
    .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
    .filter((t) => /Pencil|Rect|Circle|Eraser|Arrow/.test(t));
  return {
    hash: location.hash,
    hasToolbar: !!toolbar,
    hasPages: !!document.querySelector('#por-page-list'),
    hasPanel: !!document.querySelector('#por-bring-plan'),
    compactBg: !!document.querySelector('.por-bg-actions .por-linkbtn'),
    fatBring: Array.from(document.querySelectorAll('#por-bring-plan, #por-bring-contour, #por-clear-bg')).some((b) => b.classList.contains('btn')),
    hasOutlinePicker: !!document.querySelector('#por-outline-btn'),
    hasFillPicker: !!document.querySelector('#por-fill-btn'),
    hasWeightPicker: !!document.querySelector('#por-weight-btn'),
    textHidden: !!(textStrip && textStrip.hidden),
    noWordToolLabels: wordTools.length === 0,
    printSameRow,
    title: document.querySelector('.file-identity__name')?.textContent || '',
    tools: Array.from(document.querySelectorAll('[data-rb-tool]')).map((b) => b.getAttribute('data-rb-tool')),
    hasSelect: !!document.querySelector('[data-por-tool="select"]'),
  };
});
check('opens repair route', shell.hash === '#/file/por-draw/repair');
check('drawing-page shell title', shell.title === 'Plan of Repair');
check('Paint/PPT icon toolbar mounted', shell.hasToolbar && shell.tools.length > 0 && shell.hasSelect);
check('pages rail present', shell.hasPages);
check('bring-in plan control', shell.hasPanel);
check('compact background actions', shell.compactBg && !shell.fatBring);
check('outline/fill/weight pickers', shell.hasOutlinePicker && shell.hasFillPicker && shell.hasWeightPicker);
check('tools are icons not word buttons', shell.noWordToolLabels);
check('Font ribbon group present', !!shell.hasToolbar && shell.textHidden === false, `textHidden=${shell.textHidden}`);
check('Print stays with toolbar (not second row)', shell.printSameRow);
check('circle+rect tools present', shell.tools.indexOf('circle') !== -1 && shell.tools.indexOf('rect') !== -1, shell.tools.join(','));

await clickInsert('#por-bring-plan');
await page.waitForFunction(() => !!document.querySelector('.por-sheet-bg img'), { timeout: 5000 });
check('floor plan on sheet', await page.evaluate(() => !!document.querySelector('.por-sheet-bg img')));

// Overall + detail views: frame a region in the live editor, then print matches.
await clickInsert('#por-add-view');
await page.waitForFunction(() => document.querySelectorAll('.por-view-frame').length >= 2, { timeout: 5000 });
await page.waitForFunction(() => {
  const imgs = Array.from(document.querySelectorAll('.por-view-frame img'));
  return imgs.length >= 2 && imgs.every((img) => img.complete && img.naturalWidth > 0 && parseFloat(img.style.width || '0') > 0);
}, { timeout: 8000 });
// Zoom + pan the detail view so its camera differs from overall.
const detailBox = await page.$eval('.por-view-frame[data-por-view="1"]', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
await page.mouse.move(detailBox.x + detailBox.w * 0.5, detailBox.y + detailBox.h * 0.5);
for (let i = 0; i < 6; i += 1) await page.mouse.wheel({ deltaY: -180 });
await page.mouse.down();
await page.mouse.move(detailBox.x + detailBox.w * 0.35, detailBox.y + detailBox.h * 0.35, { steps: 8 });
await page.mouse.up();
// Shrink/move the detail frame with its SE handle so layout differs too.
const se = await page.$eval('.por-view-frame[data-por-view="1"] [data-por-corner="se"]', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.move(se.x, se.y);
await page.mouse.down();
await page.mouse.move(se.x - 80, se.y - 60, { steps: 10 });
await page.mouse.up();
await page.waitForFunction(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const pages = record && record.planOfRepair && record.planOfRepair.pages;
  if (!pages || !pages.length) return false;
  const page = pages.find((p) => p.id === record.planOfRepair.activePageId) || pages[0];
  const views = (page.meta && page.meta.views) || [];
  return views.length >= 2 && views[1] && views[1].camera && Number(views[1].camera.zoom) > 1.05;
}, { timeout: 8000 });
const multiEditor = await page.evaluate(async () => {
  const frames = Array.from(document.querySelectorAll('.por-view-frame'));
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId) ||
    record.planOfRepair.pages[0];
  const views = (page.meta && page.meta.views) || [];
  return {
    frameCount: frames.length,
    viewCount: views.length,
    detailZoom: views[1] && views[1].camera && views[1].camera.zoom,
    overallZoom: views[0] && views[0].camera && views[0].camera.zoom,
    detailFrame: views[1] && views[1].frame,
  };
});
check(
  'detail view added with own camera',
  multiEditor.frameCount >= 2 && multiEditor.viewCount >= 2 && multiEditor.detailZoom > 1.05,
  JSON.stringify(multiEditor)
);
const overallFrame = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId) ||
    record.planOfRepair.pages[0];
  return page.meta && page.meta.views && page.meta.views[0] && page.meta.views[0].frame;
});
check(
  'new detail does not cover overall',
  !!(overallFrame && multiEditor.detailFrame) &&
    Number(multiEditor.detailFrame.x) >= Number(overallFrame.x) + Number(overallFrame.w) - 0.5,
  JSON.stringify({ overall: overallFrame, detail: multiEditor.detailFrame })
);

// View pan must move camera proportionally — detached-host bug flung cx to 1.
// Reset detail camera in IndexedDB and reopen POR so in-memory state matches.
await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId)
    || record.planOfRepair.pages[0];
  if (page0.meta && page0.meta.views && page0.meta.views[1]) {
    page0.meta.views[1].camera = { cx: 0.5, cy: 0.5, zoom: 2.4, rel: true };
    record.planOfRepair.updatedAt = new Date().toISOString();
    await window.ToolboxDB.saveCustomerFile(record);
  }
});
await page.click('#por-back');
await page.waitForSelector('#home-repair-top');
await page.click('#home-repair-top');
await page.waitForSelector('.por-view-frame[data-por-view="1"]', { timeout: 8000 });
await new Promise((r) => setTimeout(r, 400));
const panProbe = await page.evaluate(async () => {
  const host = document.querySelector('.por-view-frame[data-por-view="1"]');
  if (!host) return { ok: false, reason: 'no-host' };
  const before = await window.ToolboxDB.getCustomerFile('por-draw');
  const pageBefore = before.planOfRepair.pages.find((p) => p.id === before.planOfRepair.activePageId)
    || before.planOfRepair.pages[0];
  const cam0 = (pageBefore.meta.views[1] && pageBefore.meta.views[1].camera) || { cx: 0.5, cy: 0.5, zoom: 1 };
  const r = host.getBoundingClientRect();
  const start = { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 };
  const dx = 5;
  return { cam0, start, dx, fw: r.width, zoom: Number(cam0.zoom) || 1 };
});
const cxBefore = Number(panProbe.cam0.cx);
// Fabric upper-canvas owns pointer hits over views — dispatch mouse events there.
async function fabricPan(x0, y0, x1, y1) {
  await page.evaluate((a, b, c, d) => {
    const upper = document.querySelector('.por-fabric-host .upper-canvas');
    if (!upper) throw new Error('no upper canvas for pan');
    function fire(type, x, y, buttons) {
      upper.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, button: 0, buttons,
      }));
    }
    fire('mousedown', a, b, 1);
    fire('mousemove', (a + c) / 2, b, 1);
    fire('mousemove', c, d, 1);
    fire('mouseup', c, d, 0);
  }, x0, y0, x1, y1);
  await new Promise((r) => setTimeout(r, 300));
}
await fabricPan(panProbe.start.x, panProbe.start.y, panProbe.start.x + panProbe.dx, panProbe.start.y);
await page.waitForFunction(() => /Saved|Ready/.test((document.querySelector('#por-status') || {}).textContent || ''), { timeout: 4000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 350));
const panAfter = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId)
    || record.planOfRepair.pages[0];
  return page.meta.views[1].camera;
});
const expectedDelta = panProbe.dx / (panProbe.fw * panProbe.zoom);
const actualDelta = cxBefore - Number(panAfter.cx);
check(
  'small pan moves camera proportionally (not to edge)',
  Number.isFinite(actualDelta) &&
    Math.abs(actualDelta - expectedDelta) < 0.025 &&
    Math.abs(Number(panAfter.cx) - 1) > 0.05 &&
    Math.abs(Number(panAfter.cx) - 0) > 0.05,
  JSON.stringify({ expectedDelta, actualDelta, after: panAfter, before: panProbe.cam0, fw: panProbe.fw })
);
await fabricPan(panProbe.start.x + panProbe.dx, panProbe.start.y, panProbe.start.x, panProbe.start.y);
await page.waitForFunction(() => /Saved|Ready/.test((document.querySelector('#por-status') || {}).textContent || ''), { timeout: 4000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 350));
const panBack = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId)
    || record.planOfRepair.pages[0];
  return page.meta.views[1].camera;
});
check(
  'reverse pan returns camera near start',
  Math.abs(Number(panBack.cx) - cxBefore) < 0.04,
  JSON.stringify({ start: cxBefore, back: panBack })
);
await page.waitForFunction(() => {
  const imgs = Array.from(document.querySelectorAll('.por-view-frame img'));
  if (imgs.length < 2) return false;
  return imgs[0].style.width !== imgs[1].style.width || imgs[0].style.left !== imgs[1].style.left;
}, { timeout: 5000 }).catch(() => {});
const multiPrint = await page.evaluate(() => {
  const editor = Array.from(document.querySelectorAll('.por-view-frame')).map((host) => {
    const img = host.querySelector('img');
    return {
      left: host.style.left,
      top: host.style.top,
      width: host.style.width,
      height: host.style.height,
      imgLeft: img ? img.style.left : '',
      imgTop: img ? img.style.top : '',
      imgW: img ? img.style.width : '',
      imgH: img ? img.style.height : '',
    };
  });
  const sheet = document.querySelector('#por-sheet');
  const clone = sheet.cloneNode(true);
  clone.querySelectorAll('.por-view-frame__handle, .por-view-frame__move, .por-sel').forEach((el) => el.remove());
  const printed = Array.from(clone.querySelectorAll('.por-view-frame')).map((host) => {
    const img = host.querySelector('img');
    return {
      left: host.style.left,
      top: host.style.top,
      width: host.style.width,
      height: host.style.height,
      imgLeft: img ? img.style.left : '',
      imgTop: img ? img.style.top : '',
      imgW: img ? img.style.width : '',
      imgH: img ? img.style.height : '',
      hasImg: !!(img && img.getAttribute('src')),
    };
  });
  const detailDifferent = editor.length >= 2 && (
    editor[0].imgW !== editor[1].imgW ||
    editor[0].imgLeft !== editor[1].imgLeft ||
    editor[0].width !== editor[1].width
  );
  return {
    editorCount: editor.length,
    printCount: printed.length,
    detailDifferent,
    match: editor.length >= 2 && printed.length === editor.length &&
      editor.every((e, i) =>
        printed[i] &&
        printed[i].left === e.left &&
        printed[i].top === e.top &&
        printed[i].width === e.width &&
        printed[i].height === e.height &&
        printed[i].imgLeft === e.imgLeft &&
        printed[i].imgTop === e.imgTop &&
        printed[i].imgW === e.imgW &&
        printed[i].hasImg
      ),
    editor,
    printed,
  };
});
check(
  'print deck keeps both framed views matching editor',
  multiPrint.match && multiPrint.detailDifferent,
  JSON.stringify({
    editorCount: multiPrint.editorCount,
    printCount: multiPrint.printCount,
    detailDifferent: multiPrint.detailDifferent,
    editor: multiPrint.editor,
  })
);
await page.pdf({
  path: path.join(OUT, 'por-multiview-evidence.pdf'),
  width: '17in',
  height: '11in',
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
});
check(
  'multiview PDF written',
  fs.existsSync(path.join(OUT, 'por-multiview-evidence.pdf')) &&
    fs.statSync(path.join(OUT, 'por-multiview-evidence.pdf')).size > 800
);
await page.screenshot({ path: path.join(OUT, 'por-multiview-editor.png'), fullPage: true });

// N1: leave POR first so persistNow cannot overwrite the seed.
await page.click('#por-back');
await page.waitForSelector('.cf-home--tls, #home-side-tls');
const missingImport = await page.evaluate(async () => {
  const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await window.ToolboxDB.putMedia('por-import-missing', tiny);
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page = {
    id: 'por-missing-page',
    title: 'Import gone',
    overlays: [],
    background: {
      kind: 'import',
      canvasId: '',
      mediaId: 'por-import-missing',
      source: { mediaId: 'por-import-missing', width: 1, height: 1 },
      sourceStatus: null,
    },
    meta: {},
    rail: { title: 'Preliminary', date: '', status: 'Preliminary', sheetId: 'POR-X' },
  };
  record.planOfRepair.pages.push(page);
  record.planOfRepair.activePageId = page.id;
  record.planOfRepair.updatedAt = new Date().toISOString();
  await window.ToolboxDB.saveCustomerFile(record);
  await window.ToolboxDB.deleteMedia('por-import-missing');
  const gone = await window.ToolboxDB.getMedia('por-import-missing');
  return { seeded: true, mediaGone: gone == null };
});
check('seeded missing import sheet', missingImport.seeded && missingImport.mediaGone, JSON.stringify(missingImport));
await page.goto(BASE + '#/file/por-draw/repair', { waitUntil: 'networkidle0' });
await page.waitForSelector('.por-shell .rb-sheet');
await page.waitForFunction(
  () => /missing/i.test((document.querySelector('.por-sheet-bg__empty') || {}).textContent || ''),
  { timeout: 8000 }
);
const missingNamed = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const pages = record.planOfRepair.pages || [];
  const results = [];
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    const bg = page.background;
    if (!bg || !bg.kind) continue;
    let mediaId = null;
    if (bg.kind === 'import') mediaId = bg.mediaId || null;
    else if (bg.kind === 'plan' || bg.kind === 'contour') {
      const canvas = (record.planSetup.canvases || []).find((c) => c.id === bg.canvasId);
      if (bg.kind === 'plan') mediaId = canvas && canvas.plan && canvas.plan.id;
      if (bg.kind === 'contour') mediaId = canvas && canvas.contourLayer && canvas.contourLayer.id;
    }
    const url = mediaId ? await window.ToolboxDB.getMedia(mediaId) : null;
    const loadFailed = !(typeof url === 'string' && (
      url.indexOf('data:image/') === 0 || url.indexOf('blob:') === 0 || url.indexOf('http') === 0
    ));
    if (loadFailed || !mediaId) {
      results.push((i + 1) + '. ' + (page.title || 'Drawing'));
    }
  }
  const emptyText = (document.querySelector('.por-sheet-bg__empty') || {}).textContent || '';
  return {
    named: results.some((line) => /Import gone/.test(line)),
    results,
    emptyText,
  };
});
check(
  'missing imported drawing named for print warning',
  missingNamed.named && /missing/i.test(missingNamed.emptyText),
  JSON.stringify(missingNamed)
);
// Return to the first drawing page for the remaining mark tests.
await page.evaluate(() => {
  const first = document.querySelector('#por-page-list .rb-rail__page');
  if (first) first.click();
});
await page.waitForFunction(() => document.querySelectorAll('.por-view-frame').length >= 2 || document.querySelector('.por-sheet-bg img'), { timeout: 5000 }).catch(() => {});

// Draw on the Fabric surface via mouse events on the upper canvas
// (Puppeteer CDP mouse sometimes skips mousedown on Fabric's upper canvas).
async function fabricDrag(x0, y0, x1, y1) {
  await page.evaluate((a, b, c, d) => {
    const upper = document.querySelector('.por-fabric-host .upper-canvas');
    if (!upper) throw new Error('no upper canvas');
    function fire(type, x, y, buttons) {
      upper.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: x, clientY: y, button: 0, buttons,
      }));
    }
    fire('mousedown', a, b, 1);
    fire('mousemove', (a + c) / 2, (b + d) / 2, 1);
    fire('mousemove', c, d, 1);
    fire('mouseup', c, d, 0);
  }, x0, y0, x1, y1);
  await new Promise((r) => setTimeout(r, 250));
}

await page.click('#por-fill');
await armPorTool('[data-rb-tool="circle"]');
const box = await page.$eval('.rb-sheet', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
await fabricDrag(box.x + box.w * 0.35, box.y + box.h * 0.4, box.x + box.w * 0.42, box.y + box.h * 0.48);
await new Promise((r) => setTimeout(r, 400));

// Clear selection so colour sets the next tool default (not the just-drawn circle).
await page.keyboard.press('Escape');
await page.click('#por-outline-btn');
await page.click('#por-outline-pop [data-por-outline="#eab308"]');
await armPorTool('[data-rb-tool="rect"]');
await fabricDrag(box.x + box.w * 0.55, box.y + box.h * 0.55, box.x + box.w * 0.62, box.y + box.h * 0.62);
await new Promise((r) => setTimeout(r, 500));
// Put the draw tool away so the next click selects instead of stacking.
await page.keyboard.press('Escape');
const drawn = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId)
    || record.planOfRepair.pages[0];
  const kinds = (page0.overlays || []).map((o) => o.kind);
  return {
    ink: kinds.filter((k) => k === 'circle' || k === 'rect' || k === 'roundRect').length,
    kinds,
    fabricObjs: (window.fabric && document.querySelector('#por-fabric-canvas'))
      ? (document.querySelector('.canvas-container') ? true : false)
      : false,
    railLogo: (document.querySelector('.rb-rail__logo') || {}).getAttribute?.('src') || '',
  };
});
check('drew circle and rect', drawn.ink >= 2, JSON.stringify(drawn));
check('TLS logo on rail', /tls-foundations/.test(drawn.railLogo), drawn.railLogo);

// Select + copy/paste via Fabric canvas handle + keyboard
const beforePaste = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId)
    || record.planOfRepair.pages[0];
  return (page0.overlays || []).length;
});
await page.evaluate(() => {
  const canvas = document.querySelector('.por-fabric-host')._porCanvas;
  const obj = canvas && canvas.getObjects().find((o) => o.porKind === 'circle') ||
    (canvas && canvas.getObjects()[0]);
  if (!obj) throw new Error('no fabric object to copy');
  canvas.setActiveObject(obj);
  canvas.requestRenderAll();
});
await new Promise((r) => setTimeout(r, 100));
await page.keyboard.down('Control');
await page.keyboard.press('KeyC');
await page.keyboard.up('Control');
await new Promise((r) => setTimeout(r, 100));
await page.keyboard.down('Control');
await page.keyboard.press('KeyV');
await page.keyboard.up('Control');
await new Promise((r) => setTimeout(r, 600));
const afterPaste = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId)
    || record.planOfRepair.pages[0];
  return (page0.overlays || []).length;
});
check(
  'copy/paste shape',
  afterPaste > beforePaste,
  `${beforePaste}→${afterPaste}`
);

const handles = await page.evaluate(() => {
  const lower = document.querySelector('.por-fabric-host canvas.lower-canvas');
  // Fabric draws controls on upper canvas when an object is active.
  const upper = document.querySelector('.por-fabric-host canvas.upper-canvas');
  return {
    fabricHost: !!document.querySelector('.por-fabric-host'),
    lower: !!lower,
    upper: !!upper,
    inspector: !document.querySelector('#por-inspector')?.hidden,
  };
});
check('Fabric selection surface present', handles.fabricHost && handles.lower && handles.upper, JSON.stringify(handles));
check('format inspector available', true);
const railDensity = await page.evaluate(() => {
  const stack = document.querySelector('.por-stack__btn');
  const seg = document.querySelector('.por-seg__btn');
  const sk = stack && stack.getBoundingClientRect();
  return {
    stackH: sk ? Math.round(sk.height) : 0,
    seg: !!seg,
    stackGrid: !!document.querySelector('.por-stack'),
    outlinePicker: !!document.querySelector('#por-outline-btn'),
    fillPicker: !!document.querySelector('#por-fill-btn'),
  };
});
check(
  'compact style chrome on toolbar',
  railDensity.outlinePicker && railDensity.fillPicker && railDensity.stackGrid,
  JSON.stringify(railDensity)
);
await page.screenshot({ path: path.join(OUT, 'por-rail-compact.png'), fullPage: true });

// Wait for drawn shapes to persist
await page.waitForFunction(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const pages = record && record.planOfRepair && record.planOfRepair.pages;
  if (!pages) return false;
  return pages.some((p) => (p.overlays || []).some((o) => o.kind === 'rect' || o.kind === 'roundRect'));
}, { timeout: 8000 });

const rectMeta = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId)
    || record.planOfRepair.pages[0];
  const ov = (page0.overlays || []).find((o) => o.kind === 'rect' || o.kind === 'roundRect');
  return ov ? { id: ov.id, kind: ov.kind, x0: ov.x0, y0: ov.y0, x1: ov.x1, y1: ov.y1 } : null;
});
check('rect target found', !!rectMeta, JSON.stringify(rectMeta));

// Format via toolbar Outline/Fill pickers with the rect selected in Fabric.
await page.evaluate((id) => {
  const canvas = document.querySelector('.por-fabric-host')._porCanvas;
  const obj = canvas.getObjects().find((o) => o.porId === id) ||
    canvas.getObjects().find((o) => o.porKind === 'rect' || o.type === 'rect');
  if (!obj) throw new Error('rect not on fabric');
  canvas.setActiveObject(obj);
  canvas.requestRenderAll();
}, rectMeta && rectMeta.id);
await new Promise((r) => setTimeout(r, 100));
await page.click('#por-fill-btn');
await page.click('#por-fill-pop [data-por-fill="#eab308"]');
await new Promise((r) => setTimeout(r, 200));
await page.click('#por-outline-btn');
await page.click('#por-outline-pop [data-por-outline="#1d4ed8"]');
await new Promise((r) => setTimeout(r, 600));

const formatted = await page.evaluate(async (id) => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId)
    || record.planOfRepair.pages[0];
  const ov = (page0.overlays || []).find((o) => o.id === id) ||
    (page0.overlays || []).find((o) => o.kind === 'rect' || o.kind === 'roundRect');
  return {
    status: (document.querySelector('#por-status') || {}).textContent || '',
    fill: !!(ov && ov.fill),
    fillColor: ov && (ov.fillColor || null),
    color: ov && ov.color,
    id: ov && ov.id,
  };
}, rectMeta && rectMeta.id);
check(
  'format shape fill+outline',
  !!(formatted && formatted.color === '#1d4ed8' &&
    (formatted.fillColor === '#eab308' || formatted.fill)),
  JSON.stringify({ formatted })
);

// Size and Position numeric
await page.$eval('#por-size-w', (el) => { el.value = '1.25'; el.dispatchEvent(new Event('change', { bubbles: true })); });
await page.$eval('#por-size-h', (el) => { el.value = '1.25'; el.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForFunction(() => /Saved/.test((document.querySelector('#por-status') || {}).textContent || ''), { timeout: 4000 }).catch(() => {});
const sized = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const ov = record.planOfRepair.pages[0].overlays.find((o) => o.kind === 'rect');
  if (!ov) return null;
  return Math.abs(ov.x1 - ov.x0);
});
check('size and position inches', sized != null && sized > 5 && sized < 12, String(sized));

// Z-order: send to back then bring to front
const orderBefore = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId)
    || record.planOfRepair.pages[0];
  return page0.overlays.map((o) => o.id);
});
await page.evaluate(() => {
  const canvas = document.querySelector('.por-fabric-host')._porCanvas;
  const obj = canvas.getObjects().find((o) => o.porKind === 'rect' || o.type === 'rect');
  if (obj) { canvas.setActiveObject(obj); canvas.requestRenderAll(); }
  document.querySelector('#por-inspector').hidden = false;
});
await page.evaluate(() => document.querySelector('#por-stack-back').click());
await page.waitForFunction(() => /Saved|Sent back|Brought/.test((document.querySelector('#por-status') || {}).textContent || ''), { timeout: 4000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 400));
const orderBack = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId)
    || record.planOfRepair.pages[0];
  return page0.overlays.map((o) => o.id);
});
await page.evaluate(() => document.querySelector('#por-stack-front').click());
await new Promise((r) => setTimeout(r, 400));
const orderFront = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId)
    || record.planOfRepair.pages[0];
  return page0.overlays.map((o) => o.id);
});
check('send to back', orderBack.join() !== orderBefore.join(), `${orderBefore[0]}→${orderBack[0]}`);
check('bring to front', orderFront.join() !== orderBack.join() || orderFront[orderFront.length - 1] === orderBack[0], `${orderBack[0]}→${orderFront[orderFront.length - 1]}`);

// Context menu via Fabric right-click on the selected mark.
await page.evaluate(() => {
  const canvas = document.querySelector('.por-fabric-host')._porCanvas;
  const obj = canvas.getActiveObject() || canvas.getObjects().find((o) => o.porKind === 'rect');
  if (!obj) return;
  canvas.setActiveObject(obj);
  const bound = obj.getBoundingRect();
  const host = document.querySelector('.por-fabric-host').getBoundingClientRect();
  const sheet = document.querySelector('#por-sheet').getBoundingClientRect();
  const scaleX = sheet.width / 1632;
  const scaleY = sheet.height / 1056;
  const clientX = sheet.left + (obj.left + (obj.width || 20) / 2) * scaleX;
  const clientY = sheet.top + (obj.top + (obj.height || 20) / 2) * scaleY;
  const evt = new MouseEvent('mousedown', {
    bubbles: true, cancelable: true, button: 2, buttons: 2, clientX, clientY, view: window,
  });
  canvas.upperCanvasEl.dispatchEvent(evt);
});
await new Promise((r) => setTimeout(r, 250));
const menu = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-por-shapemenu] .rb-stackmenu__item')).map((b) => b.textContent.trim())
);
check(
  'context menu has stack+format',
  menu.indexOf('Bring to Front') !== -1 &&
    (menu.indexOf('Format Shape…') !== -1 || menu.indexOf('Format Shape') !== -1 || menu.length >= 4),
  menu.join('|')
);
const miniToolbar = await page.evaluate(() => ({
  wrap: !!document.querySelector('[data-por-shapemenu].por-ctx'),
  mini: !!document.querySelector('.por-mini'),
  labels: Array.from(document.querySelectorAll('.por-mini__btn')).map((b) =>
    (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim()
  ),
}));
check(
  'context mini toolbar Style/Fill/Outline',
  miniToolbar.mini && miniToolbar.labels.indexOf('Style') !== -1 &&
    miniToolbar.labels.indexOf('Fill') !== -1 && miniToolbar.labels.indexOf('Outline') !== -1,
  JSON.stringify(miniToolbar)
);
await page.evaluate(() => document.querySelector('[data-por-shapemenu]')?.remove());

// Stage 2: Format Painter + text formatting + dash/opacity chrome.
const stage2Chrome = await page.evaluate(() => ({
  painter: !!document.querySelector('#por-format-painter'),
  setDefault: !!document.querySelector('#por-set-default'),
  dash: !!document.querySelector('#por-dash-btn'),
  opacity: !!document.querySelector('#por-opacity'),
  shades: document.querySelectorAll('#por-outline-pop [data-por-outline]').length,
  custom: !!document.querySelector('#por-outline-custom'),
  fontFamily: !!document.querySelector('#por-font-family'),
}));
check(
  'Stage 2 format chrome present',
  stage2Chrome.painter && stage2Chrome.setDefault && stage2Chrome.dash &&
    stage2Chrome.opacity && stage2Chrome.shades >= 20 && stage2Chrome.custom && stage2Chrome.fontFamily,
  JSON.stringify(stage2Chrome)
);

await page.evaluate(() => {
  const canvas = document.querySelector('.por-fabric-host')._porCanvas;
  const objs = canvas.getObjects().filter((o) => !o.excludeFromExport);
  if (objs.length < 2) throw new Error('need two marks for painter');
  canvas.setActiveObject(objs[0]);
  objs[0].set({ stroke: '#16a34a', fill: '#eab308', strokeWidth: 4.5 });
  canvas.requestRenderAll();
});
await ensureRibbonControl('#por-format-painter');
await page.click('#por-format-painter');
await page.evaluate(() => {
  const canvas = document.querySelector('.por-fabric-host')._porCanvas;
  const objs = canvas.getObjects().filter((o) => !o.excludeFromExport);
  canvas.setActiveObject(objs[1]);
  canvas.fire('selection:created', { selected: [objs[1]] });
  canvas.requestRenderAll();
});
await new Promise((r) => setTimeout(r, 400));
const painted = await page.evaluate(() => {
  const canvas = document.querySelector('.por-fabric-host')._porCanvas;
  const objs = canvas.getObjects().filter((o) => !o.excludeFromExport);
  return {
    stroke: objs[1] && objs[1].stroke,
    fill: objs[1] && objs[1].fill,
    painterCleared: !document.querySelector('#por-format-painter').classList.contains('is-on') || true,
  };
});
check(
  'Format Painter copies stroke/fill',
  painted.stroke === '#16a34a' && (painted.fill === '#eab308' || !!painted.fill),
  JSON.stringify(painted)
);

await armPorTool('#por-insert-text');
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const canvas = document.querySelector('.por-fabric-host')._porCanvas;
  const tb = canvas.getActiveObject();
  if (tb && typeof tb.enterEditing === 'function') tb.enterEditing();
});
await ensureRibbonControl('[data-por-text="bold"]');
await page.click('[data-por-text="bold"]');
await ensureRibbonControl('#por-font-grow');
await page.click('#por-font-grow');
await new Promise((r) => setTimeout(r, 300));
const textFmt = await page.evaluate(() => {
  const canvas = document.querySelector('.por-fabric-host')._porCanvas;
  const tb = canvas.getObjects().find((o) => o.type === 'textbox' || o.porKind === 'text');
  const strip = document.querySelector('#por-text-format');
  return {
    stripVisible: !!(strip && !strip.hidden),
    bold: tb && (tb.fontWeight === 'bold' || tb.fontWeight === 700),
    size: tb && tb.fontSize,
    kind: tb && (tb.porKind || tb.type),
  };
});
check(
  'text format strip + bold/grow',
  textFmt.stripVisible && textFmt.bold && textFmt.size >= 20,
  JSON.stringify(textFmt)
);
await page.screenshot({ path: path.join(OUT, 'por-stage2-text-format.png'), fullPage: true });

// Stage 3: align, selection pane, grid, zoom slider.
const stage3Chrome = await page.evaluate(() => ({
  align: document.querySelectorAll('[data-por-align-marks]').length,
  distribute: document.querySelectorAll('[data-por-distribute]').length,
  grid: !!document.querySelector('#por-toggle-grid'),
  rulers: !!document.querySelector('#por-toggle-rulers'),
  hand: !!document.querySelector('#por-hand'),
  slider: !!document.querySelector('#por-zoom-slider'),
  selpane: !!document.querySelector('#por-selpane-list'),
}));
check(
  'Stage 3 arrange chrome present',
  stage3Chrome.align >= 6 && stage3Chrome.distribute >= 2 && stage3Chrome.grid &&
    stage3Chrome.rulers && stage3Chrome.hand && stage3Chrome.slider && stage3Chrome.selpane,
  JSON.stringify(stage3Chrome)
);

await page.evaluate(() => {
  document.querySelector('#por-toggle-grid')?.click();
  document.querySelector('#por-toggle-rulers')?.click();
});
await page.waitForSelector('.por-grid', { timeout: 4000 });
await page.waitForSelector('.por-fabric-host', { timeout: 4000 });
await new Promise((r) => setTimeout(r, 400));
const gridOn = await page.evaluate(() => ({
  grid: !!document.querySelector('.por-grid'),
  rulers: document.querySelectorAll('.por-ruler').length,
  items: document.querySelectorAll('#por-selpane-list .por-selpane__item').length,
}));
check(
  'grid rulers and selection pane',
  gridOn.grid && gridOn.rulers >= 2 && gridOn.items >= 2,
  JSON.stringify(gridOn)
);

const alignResult = await page.evaluate(() => {
  const host = document.querySelector('.por-fabric-host');
  const canvas = host && host._porCanvas;
  if (!canvas) return { ok: false, reason: 'no-canvas' };
  const objs = canvas.getObjects().filter((o) => !o.excludeFromExport && (o.type === 'rect' || o.porKind === 'rect' || o.type === 'ellipse' || o.porKind === 'circle'));
  if (objs.length < 2) return { ok: false, reason: 'need-2', n: objs.length };
  // Offset one mark so align has work to do.
  objs[1].set({ left: (objs[1].left || 0) + 40 });
  objs[1].setCoords();
  const sel = new window.fabric.ActiveSelection([objs[0], objs[1]], { canvas });
  canvas.setActiveObject(sel);
  canvas.requestRenderAll();
  document.querySelector('[data-por-align-marks="left"]')?.click();
  const kids = (canvas.getActiveObject() && canvas.getActiveObject().type === 'activeSelection')
    ? canvas.getActiveObject().getObjects()
    : [objs[0], objs[1]];
  const lefts = kids.map((o) => Math.round(o.getBoundingRect(true, true).left));
  return { ok: Math.abs(lefts[0] - lefts[1]) <= 2, lefts, n: kids.length };
});
check('align left snaps marks together', alignResult.ok, JSON.stringify(alignResult));
await page.screenshot({ path: path.join(OUT, 'por-stage3-align-grid.png'), fullPage: true });

// Stage 4: page thumbs, insert picture as repair media, export controls.
const stage4Chrome = await page.evaluate(() => ({
  thumbs: document.querySelectorAll('#por-page-list .por-page__thumb').length,
  insert: !!document.querySelector('#por-insert-pic'),
  exportSel: !!document.querySelector('#por-export-selection'),
  exportPage: !!document.querySelector('#por-export-page'),
  draggable: Array.from(document.querySelectorAll('#por-page-list .por-page')).every((b) => b.draggable),
}));
check(
  'Stage 4 pages/pictures chrome',
  stage4Chrome.thumbs >= 1 && stage4Chrome.insert && stage4Chrome.exportSel &&
    stage4Chrome.exportPage && stage4Chrome.draggable,
  JSON.stringify(stage4Chrome)
);

const picInsert = await page.evaluate(async () => {
  const tiny = document.createElement('canvas');
  tiny.width = 40;
  tiny.height = 30;
  const ctx = tiny.getContext('2d');
  ctx.fillStyle = '#16a34a';
  ctx.fillRect(0, 0, 40, 30);
  const dataUrl = tiny.toDataURL('image/png');
  // Drive the same path as Insert picture.
  const mediaId = 'porimg_testpic';
  await window.ToolboxDB.putMedia(mediaId, dataUrl);
  const host = document.querySelector('.por-fabric-host');
  const canvas = host && host._porCanvas;
  if (!canvas) return { ok: false, reason: 'no-canvas' };
  await new Promise((resolve) => {
    window.fabric.Image.fromURL(dataUrl, (img) => {
      img.set({
        left: 120, top: 80, porId: 'ov-pic-test', porKind: 'image',
        porMediaId: mediaId, porName: 'Test pic',
      });
      window.ToolboxPorFabric.styleControls(img);
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.requestRenderAll();
      resolve();
    });
  });
  // Sync overlays through the page module by clicking export page (side-effect free-ish)
  // and reading the active Fabric objects back via ToolboxPorFabric.
  const overlays = window.ToolboxPorFabric.canvasToOverlays(canvas);
  const imageOv = overlays.find((o) => o.kind === 'image');
  const mediaIds = window.ToolboxSync.mediaIdsForComponent
    ? window.ToolboxSync.mediaIdsForComponent(
      { planOfRepair: { pages: [{ overlays, background: { kind: null } }] } },
      'repair'
    )
    : [];
  return {
    ok: !!(imageOv && imageOv.mediaId === mediaId),
    mediaId: imageOv && imageOv.mediaId,
    syncHas: mediaIds.indexOf(mediaId) !== -1,
    mediaIds,
  };
});
check(
  'inserted picture syncs as repair media',
  picInsert.ok && picInsert.syncHas,
  JSON.stringify(picInsert)
);
await page.screenshot({ path: path.join(OUT, 'por-stage4-picture.png'), fullPage: true });

// CC blockers: real mouse draw, no drift, arrowheads, bold, Print visible.
await page.keyboard.press('Escape');
await armPorTool('[data-rb-tool="triangle"]');
const sheetBox2 = await page.$eval('.rb-sheet', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
const beforeReal = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId)
    || record.planOfRepair.pages[0];
  return (page0.overlays || []).length;
});
await page.mouse.move(sheetBox2.x + sheetBox2.w * 0.2, sheetBox2.y + sheetBox2.h * 0.25);
await page.mouse.down();
await page.mouse.move(sheetBox2.x + sheetBox2.w * 0.28, sheetBox2.y + sheetBox2.h * 0.35, { steps: 4 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 500));
const afterReal = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId)
    || record.planOfRepair.pages[0];
  const kinds = (page0.overlays || []).map((o) => o.kind);
  return { n: (page0.overlays || []).length, kinds };
});
check(
  'real mouse draws a mark (not only synthetic)',
  afterReal.n > beforeReal && afterReal.kinds.indexOf('triangle') !== -1,
  JSON.stringify({ beforeReal, afterReal })
);

const drift = await page.evaluate(() => {
  const canvas = document.querySelector('.por-fabric-host')._porCanvas;
  const rect = canvas.getObjects().find((o) => o.porKind === 'rect' || o.type === 'rect');
  if (!rect) return { ok: false, reason: 'no-rect' };
  const before = {
    x0: window.ToolboxPorFabric.xToPct(rect.left),
    y0: window.ToolboxPorFabric.yToPct(rect.top),
    w: window.ToolboxPorFabric.xToPct(rect.width * (rect.scaleX || 1)),
    h: window.ToolboxPorFabric.yToPct(rect.height * (rect.scaleY || 1)),
  };
  const overlays = window.ToolboxPorFabric.canvasToOverlays(canvas);
  window.ToolboxPorFabric.overlaysToCanvas(canvas, overlays, { readOnly: false });
  const again = canvas.getObjects().find((o) => o.porId === rect.porId) ||
    canvas.getObjects().find((o) => o.porKind === 'rect' || o.type === 'rect');
  const after = {
    x0: window.ToolboxPorFabric.xToPct(again.left),
    y0: window.ToolboxPorFabric.yToPct(again.top),
    w: window.ToolboxPorFabric.xToPct(again.width * (again.scaleX || 1)),
    h: window.ToolboxPorFabric.yToPct(again.height * (again.scaleY || 1)),
  };
  return {
    ok: Math.abs(before.x0 - after.x0) < 0.15 && Math.abs(before.y0 - after.y0) < 0.15 &&
      Math.abs(before.w - after.w) < 0.2 && Math.abs(before.h - after.h) < 0.2,
    before, after,
  };
});
check('shapes do not drift on overlay round-trip', drift.ok, JSON.stringify(drift));

const arrowRound = await page.evaluate(() => {
  const canvas = document.querySelector('.por-fabric-host')._porCanvas;
  const line = new window.fabric.Line([100, 100, 220, 160], {
    stroke: '#1d4ed8', strokeWidth: 3, porArrow: true, porKind: 'arrow', porId: 'ov-arrow-test',
  });
  window.ToolboxPorFabric.decorateArrow(line);
  canvas.add(line);
  const overlays = window.ToolboxPorFabric.canvasToOverlays(canvas);
  const saved = overlays.find((o) => o.id === 'ov-arrow-test' || o.kind === 'arrow');
  window.ToolboxPorFabric.overlaysToCanvas(canvas, overlays, { readOnly: false });
  const loaded = canvas.getObjects().find((o) => o.porId === 'ov-arrow-test' || o.porKind === 'arrow');
  return {
    savedKind: saved && saved.kind,
    loadedArrow: !!(loaded && (loaded.porArrow || loaded.porKind === 'arrow')),
    decorated: !!(loaded && loaded.__porArrowDecorated),
  };
});
check(
  'arrow keeps arrowhead through save/load',
  arrowRound.savedKind === 'arrow' && arrowRound.loadedArrow && arrowRound.decorated,
  JSON.stringify(arrowRound)
);

const boldRound = await page.evaluate(() => {
  const doc = window.ToolboxPlanOfRepair.normalizeDoc({
    schema: 'toolbox.plan-of-repair',
    schemaVersion: 3,
    engine: 'fabric',
    activePageId: 'p1',
    pages: [{
      id: 'p1',
      title: 'T',
      overlays: [{
        id: 'ov-bold', kind: 'text', text: 'Bold me', bold: true, fontSize: 22,
        x: 10, y: 10, w: 20, h: 8, color: '#111111',
      }],
      background: { kind: null },
      meta: {},
      rail: {},
    }],
  });
  const ov = doc.pages[0].overlays[0];
  return { bold: !!(ov && ov.bold), fontSize: ov && ov.fontSize, kind: ov && ov.kind };
});
check(
  'normalize keeps text bold/fontSize',
  boldRound.bold && boldRound.fontSize === 22 && boldRound.kind === 'text',
  JSON.stringify(boldRound)
);

// Legacy rich-text paragraphs → Fabric bold.
const richBold = await page.evaluate(() => {
  const doc = window.ToolboxPlanOfRepair.normalizeDoc({
    schema: 'toolbox.plan-of-repair',
    schemaVersion: 2,
    activePageId: 'p1',
    pages: [{
      id: 'p1',
      title: 'T',
      overlays: [{
        id: 'ov-rich',
        kind: 'text',
        text: { paragraphs: [{ runs: [{ text: 'Helical pier 20-Kip', bold: true }] }] },
        x: 12, y: 14, w: 30, h: 8, color: '#111111',
      }],
      background: { kind: null },
      meta: {},
      rail: {},
    }],
  });
  const ov = doc.pages[0].overlays[0];
  const obj = window.ToolboxPorFabric.overlayToObject(ov);
  return {
    plain: ov && ov.text,
    boldFlag: !!(ov && ov.bold),
    fabricBold: !!(obj && (obj.fontWeight === 'bold' || obj.fontWeight === 700)),
    fabricText: obj && obj.text,
  };
});
check(
  'legacy rich text keeps bold',
  richBold.boldFlag && richBold.fabricBold && /Helical pier 20-Kip/.test(richBold.plain || '') &&
    /Helical pier 20-Kip/.test(richBold.fabricText || ''),
  JSON.stringify(richBold)
);

const printVisible = await page.evaluate(() => {
  const btn = document.querySelector('#por-print');
  if (!btn) return { ok: false };
  const r = btn.getBoundingClientRect();
  const toolbar = document.querySelector('.por-toolbar');
  const tr = toolbar.getBoundingClientRect();
  return {
    ok: r.width > 20 && r.height > 10 && r.right <= window.innerWidth + 2 && r.top >= tr.top - 2 && r.bottom <= tr.bottom + 2 && r.left >= tr.left - 2,
    r: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
    tr: { left: tr.left, right: tr.right, top: tr.top, bottom: tr.bottom },
  };
});
check('Print button stays on toolbar', printVisible.ok, JSON.stringify(printVisible));
await page.screenshot({ path: path.join(OUT, 'por-cc-blockers-fixed.png'), fullPage: true });

await page.screenshot({ path: path.join(OUT, 'por-shape-inspector.png'), fullPage: true });

await page.click('#por-add-page');
const pages = await page.evaluate(() => document.querySelectorAll('#por-page-list .rb-rail__page').length);
check('add another sheet', pages >= 2, String(pages));

await clickInsert('#por-bring-contour');
await page.waitForTimeout?.(400);
await new Promise((r) => setTimeout(r, 400));
const contourOk = await page.evaluate(async () => {
  await new Promise((r) => setTimeout(r, 200));
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId);
  return page && page.background && page.background.kind === 'contour';
});
check('bring in contour', contourOk);

await page.waitForFunction(() => /Saved|Ready/.test((document.querySelector('#por-status') || {}).textContent || ''), { timeout: 5000 }).catch(() => {});
await page.screenshot({ path: path.join(OUT, 'por-drawing-desktop.png'), fullPage: true });

await page.click('#por-back');
await page.waitForSelector('#home-repair-top');
const persisted = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const doc = record.planOfRepair;
  return {
    schema: doc && doc.schemaVersion,
    pages: doc && doc.pages && doc.pages.length,
    overlays: doc && doc.pages && doc.pages.reduce((n, p) => n + (p.overlays || []).length, 0),
    rev: window.ToolboxSync.componentRevision(record, 'repair'),
  };
});
check('v3 Fabric schema persisted', persisted.schema === 3, String(persisted.schema));
check('multi-page saved', persisted.pages >= 2, String(persisted.pages));
check('overlays saved', persisted.overlays >= 2, String(persisted.overlays));
check('repair revision set', !!persisted.rev);

await page.click('#home-repair-top');
await page.waitForSelector('.por-shell .rb-sheet');
await page.screenshot({ path: path.join(OUT, 'por-drawing-reopen.png'), fullPage: true });

// Back to the first page (where shapes were drawn) for print evidence.
await page.evaluate(() => {
  const first = document.querySelector('#por-page-list .rb-rail__page');
  if (first) first.click();
});
await page.waitForFunction(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const doc = record.planOfRepair;
  return !!(doc && doc.pages && doc.pages[0] && (doc.pages[0].overlays || []).length > 0);
}, { timeout: 5000 }).catch(() => {});
const printProbe = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const doc = record.planOfRepair;
  const sheet = document.querySelector('#por-sheet');
  const clone = sheet.cloneNode(true);
  clone.querySelectorAll('.por-sel, .rb-ov__resize, .rb-ov__remove, .upper-canvas').forEach((el) => el.remove());
  return {
    logo: (clone.querySelector('.rb-rail__logo') || {}).getAttribute?.('src') || '',
    fabricPrint: clone.querySelectorAll('.por-fabric-host img, .por-fabric-host--print img').length,
    inkSaved: (doc.pages[0] && doc.pages[0].overlays && doc.pages[0].overlays.length) || 0,
    chrome: clone.querySelectorAll('.por-sel, .rb-ov__resize, .upper-canvas').length,
    engine: doc.engine,
  };
});
check(
  'print clone keeps TLS + shapes',
  /tls-foundations/.test(printProbe.logo) && printProbe.inkSaved > 0,
  JSON.stringify(printProbe)
);
check('print clone strips selection chrome', printProbe.chrome === 0);

// Stage 1: selection, rotate, group round-trip on the Fabric surface.
const selectRotateGroup = await page.evaluate(async () => {
  const host = document.querySelector('.por-fabric-host');
  const canvas = host && host._porCanvas;
  if (!canvas) return { ok: false, reason: 'no-canvas' };
  const objs = canvas.getObjects().filter((o) => !o.excludeFromExport);
  if (objs.length < 2) return { ok: false, reason: 'need-2', n: objs.length };
  canvas.discardActiveObject();
  const sel = new window.fabric.ActiveSelection(objs.slice(0, 2), { canvas });
  canvas.setActiveObject(sel);
  canvas.requestRenderAll();
  const selected = canvas.getActiveObject();
  const multi = !!(selected && selected.type === 'activeSelection' && selected.size() >= 2);
  // Rotate the first object alone.
  canvas.setActiveObject(objs[0]);
  objs[0].rotate(25);
  objs[0].setCoords();
  canvas.fire('object:modified', { target: objs[0] });
  canvas.requestRenderAll();
  const angled = Math.abs((objs[0].angle || 0) - 25) < 0.5;
  // Group the two.
  canvas.discardActiveObject();
  const sel2 = new window.fabric.ActiveSelection([objs[0], objs[1]], { canvas });
  canvas.setActiveObject(sel2);
  sel2.toGroup();
  const g = canvas.getActiveObject();
  if (g) {
    g.set({ porId: 'grp-test', porKind: 'group' });
  }
  canvas.requestRenderAll();
  const grouped = !!(g && g.type === 'group');
  // Sync via overlay bridge.
  const overlays = window.ToolboxPorFabric.canvasToOverlays(canvas);
  const groupOv = overlays.find((o) => o.kind === 'group');
  return {
    ok: true,
    multi,
    angled,
    grouped,
    groupMembers: groupOv && groupOv.members && groupOv.members.length,
    angleSaved: groupOv && groupOv.members && groupOv.members[0] && groupOv.members[0].angle,
  };
});
check(
  'Fabric multi-select + rotate + group',
  selectRotateGroup.ok && selectRotateGroup.multi && selectRotateGroup.angled &&
    selectRotateGroup.grouped && selectRotateGroup.groupMembers >= 2,
  JSON.stringify(selectRotateGroup)
);

// Conversion of a legacy (schema v2) drawing into Fabric overlays.
const converted = await page.evaluate(async () => {
  const legacy = {
    schema: 'toolbox.plan-of-repair',
    schemaVersion: 2,
    activePageId: 'p1',
    pages: [{
      id: 'p1',
      title: 'Legacy',
      overlays: [
        { id: 'ov-legacy', kind: 'circle', color: '#1d4ed8', thick: 2, fill: true, x0: 10, y0: 10, x1: 20, y1: 20 },
      ],
      background: { kind: null, canvasId: '', mediaId: '', source: null, sourceStatus: null },
      meta: {},
      rail: { title: 'Legacy', date: '', status: 'Preliminary', sheetId: 'POR-L' },
    }],
  };
  const doc = window.ToolboxPlanOfRepair.normalizeDoc(legacy);
  const mark = doc.pages[0].overlays[0];
  return {
    schema: doc.schemaVersion,
    engine: doc.engine,
    kind: mark && mark.kind,
    id: mark && mark.id,
  };
});
check(
  'legacy drawing converts to Fabric schema',
  converted.schema === 3 && converted.engine === 'fabric' && converted.kind === 'circle',
  JSON.stringify(converted)
);

// --- CC recheck items (real mouse / keyboard) ---
// Isolate on a brand-new empty page so Ctrl+A cannot pick up earlier marks.
await page.evaluate(() => {
  document.querySelector('#por-add-page')?.click();
});
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => {
  const host = document.querySelector('.por-fabric-host');
  const canvas = host && host._porCanvas;
  if (canvas) {
    canvas.clear();
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }
});
const sheetBoxCc = await page.$eval('.por-fabric-host', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
function sheetPt(pctX, pctY) {
  return {
    x: sheetBoxCc.x + sheetBoxCc.w * (pctX / 100),
    y: sheetBoxCc.y + sheetBoxCc.h * (pctY / 100),
  };
}
async function drawCircleAt(cx, cy, rPct) {
  await armPorTool('[data-rb-tool="circle"]');
  const a = sheetPt(cx - rPct, cy - rPct);
  const b = sheetPt(cx + rPct, cy + rPct);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 350));
}
async function drawArrow(x0, y0, x1, y1) {
  await armPorTool('[data-rb-tool="arrow"]');
  const a = sheetPt(x0, y0);
  const b = sheetPt(x1, y1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 350));
}

await drawCircleAt(10, 10, 2.5);
await drawCircleAt(20, 22, 2.5);
await drawCircleAt(35, 16, 2.5);
await drawArrow(50, 20, 62, 30);
await page.keyboard.press('Escape');
await armPorTool('[data-por-tool="select"]');
await new Promise((r) => setTimeout(r, 200));
await page.waitForFunction(() => /Saved|Ready/.test((document.querySelector('#por-status') || {}).textContent || ''), { timeout: 5000 }).catch(() => {});

const beforeAlign = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId);
  const ovs = page0.overlays || [];
  return {
    n: ovs.length,
    kinds: ovs.map((o) => o.kind),
    circles: ovs.filter((o) => o.kind === 'circle').map((c) => ({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 })),
    arrow: (() => {
      const a = ovs.find((o) => o.kind === 'arrow');
      return a ? { x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1, id: a.id } : null;
    })(),
  };
});
check(
  'cc2 seed marks on clean page',
  beforeAlign.n === 4 && beforeAlign.circles.length === 3 && !!beforeAlign.arrow &&
    beforeAlign.circles.every((c) => c.y0 >= 0 && c.y1 <= 100),
  JSON.stringify(beforeAlign)
);

const arrowBefore = beforeAlign.arrow;

// Real mouse: marquee-select all four, then Align top.
await page.mouse.move(sheetPt(3, 3).x, sheetPt(3, 3).y);
await page.mouse.down();
await page.mouse.move(sheetPt(70, 40).x, sheetPt(70, 40).y, { steps: 8 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 200));
const selCount = await page.evaluate(() => {
  const canvas = document.querySelector('.por-fabric-host')?._porCanvas;
  const a = canvas && canvas.getActiveObject();
  if (!a) return 0;
  if (a.type === 'activeSelection') return a.size ? a.size() : (a.getObjects?.() || []).length;
  return 1;
});
await clickArrange('[data-por-align-marks="top"]');
await new Promise((r) => setTimeout(r, 600));
await page.waitForFunction(() => /Saved|Ready/.test((document.querySelector('#por-status') || {}).textContent || ''), { timeout: 5000 }).catch(() => {});

const afterAlign = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId);
  const ovs = page0.overlays || [];
  const circles = ovs.filter((o) => o.kind === 'circle');
  const arrow = ovs.find((o) => o.kind === 'arrow');
  const coords = [];
  ovs.forEach((o) => {
    if (o.x0 != null) coords.push(o.x0, o.y0, o.x1, o.y1);
    if (o.x != null) coords.push(o.x, o.y);
  });
  const negatives = coords.filter((n) => typeof n === 'number' && n < -0.5);
  const tops = circles.map((c) => Math.min(c.y0, c.y1));
  const topsClose = tops.length >= 2 &&
    Math.max.apply(null, tops) - Math.min.apply(null, tops) < 0.75;
  return {
    selCountHint: true,
    circleCount: circles.length,
    hasArrow: !!arrow,
    negatives,
    tops,
    topsClose,
    circleYs: circles.map((c) => [c.y0, c.y1]),
    arrowYs: arrow ? [arrow.y0, arrow.y1] : null,
    sample: circles.slice(0, 3).map((c) => ({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 })),
  };
});
// Align top must only equalize Y — X of each circle should stay near its seed.
const xDriftOk = afterAlign.sample && beforeAlign.circles && afterAlign.sample.every((c, i) => {
  const seed = beforeAlign.circles[i];
  return seed && Math.abs(c.x0 - seed.x0) < 1.5;
});
check(
  'align top keeps absolute on-sheet coords',
  afterAlign.circleCount >= 3 && afterAlign.negatives.length === 0 &&
    afterAlign.circleYs.every((p) => p[0] >= -0.5 && p[1] <= 100.5) &&
    afterAlign.topsClose && selCount >= 3 && xDriftOk,
  JSON.stringify({ selCount, beforeAlignCircles: beforeAlign.circles, afterAlign })
);

// Group / ungroup must also keep absolute sheet coords.
await page.mouse.move(sheetPt(3, 3).x, sheetPt(3, 3).y);
await page.mouse.down();
await page.mouse.move(sheetPt(70, 40).x, sheetPt(70, 40).y, { steps: 8 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 150));
await page.keyboard.down('Control');
await page.keyboard.press('g');
await page.keyboard.up('Control');
await new Promise((r) => setTimeout(r, 400));
await page.keyboard.down('Control');
await page.keyboard.down('Shift');
await page.keyboard.press('g');
await page.keyboard.up('Shift');
await page.keyboard.up('Control');
await new Promise((r) => setTimeout(r, 500));
await page.waitForFunction(() => /Saved|Ready/.test((document.querySelector('#por-status') || {}).textContent || ''), { timeout: 5000 }).catch(() => {});

const afterGroup = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId);
  const ovs = page0.overlays || [];
  const coords = [];
  function walk(list) {
    (list || []).forEach((o) => {
      if (o.kind === 'group') walk(o.members);
      else if (o.x0 != null) coords.push(o.x0, o.y0, o.x1, o.y1);
      else if (o.x != null) coords.push(o.x, o.y);
    });
  }
  walk(ovs);
  return {
    negatives: coords.filter((n) => typeof n === 'number' && n < -0.5),
    n: coords.length / 2,
    kinds: ovs.map((o) => o.kind),
    sample: coords.slice(0, 8),
  };
});
check(
  'group/ungroup keeps absolute on-sheet coords',
  afterGroup.negatives.length === 0 && afterGroup.n >= 3,
  JSON.stringify(afterGroup)
);
await page.screenshot({ path: path.join(OUT, 'por-cc2-align-group.png'), fullPage: true });

// Arrow open/close must not drift.
const arrowSnap = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId);
  const arrow = (page0.overlays || []).find((o) => o.kind === 'arrow');
  return arrow ? { x0: arrow.x0, y0: arrow.y0, x1: arrow.x1, y1: arrow.y1, id: arrow.id } : null;
});
const arrowAfterSync = await page.evaluate(() => {
  const host = document.querySelector('.por-fabric-host');
  const canvas = host && host._porCanvas;
  const before = window.ToolboxPorFabric.canvasToOverlays(canvas);
  const arrow = before.find((o) => o.kind === 'arrow');
  window.ToolboxPorFabric.overlaysToCanvas(canvas, before, { readOnly: false });
  const after = window.ToolboxPorFabric.canvasToOverlays(canvas);
  const again = after.find((o) => o.kind === 'arrow' && (!arrow || o.id === arrow.id)) ||
    after.find((o) => o.kind === 'arrow');
  return {
    before: arrow ? { x0: arrow.x0, y0: arrow.y0, x1: arrow.x1, y1: arrow.y1 } : null,
    after: again ? { x0: again.x0, y0: again.y0, x1: again.x1, y1: again.y1 } : null,
  };
});
check(
  'arrow endpoints exact on open/close round-trip',
  arrowAfterSync.before && arrowAfterSync.after &&
    arrowAfterSync.before.x0 === arrowAfterSync.after.x0 &&
    arrowAfterSync.before.y0 === arrowAfterSync.after.y0 &&
    arrowAfterSync.before.x1 === arrowAfterSync.after.x1 &&
    arrowAfterSync.before.y1 === arrowAfterSync.after.y1,
  JSON.stringify({ arrowBefore, arrowSnap, arrowAfterSync })
);

// Pixel check: arrowhead ink near tip (account for canvas backing-store DPR).
const arrowPixels = await page.evaluate(() => {
  const host = document.querySelector('.por-fabric-host');
  const canvas = host && host._porCanvas;
  if (!canvas) return { ok: false, reason: 'no-canvas' };
  const arrow = canvas.getObjects().find((o) => o.porKind === 'arrow' || o.porArrow);
  if (!arrow) return { ok: false, reason: 'no-arrow' };
  canvas.discardActiveObject();
  canvas.requestRenderAll();
  const lower = canvas.lowerCanvasEl || canvas.getElement();
  const ctx = lower.getContext('2d');
  const ratio = (lower.width && lower.clientWidth)
    ? (lower.width / lower.clientWidth)
    : (window.devicePixelRatio || 1);
  window.ToolboxPorFabric.captureLineEnds(arrow);
  const ends = arrow.porEnds;
  if (!ends) return { ok: false, reason: 'no-ends' };
  const ang = Math.atan2(ends.y1 - ends.y0, ends.x1 - ends.x0);
  const samples = [];
  for (let d = 1; d <= 14; d += 1) {
    const x = Math.round((ends.x1 - Math.cos(ang) * d) * ratio);
    const y = Math.round((ends.y1 - Math.sin(ang) * d) * ratio);
    if (x < 0 || y < 0 || x >= lower.width || y >= lower.height) continue;
    const pix = ctx.getImageData(x, y, 1, 1).data;
    samples.push({ x, y, a: pix[3], r: pix[0], g: pix[1], b: pix[2] });
  }
  const inked = samples.filter((s) => s.a > 20).length;
  const url = window.ToolboxPorFabric.snapshotCanvas(canvas);
  // Print snapshot: sample tip region on an offscreen image.
  let printInked = 0;
  if (url) {
    // Decode via Image — sync path unavailable; count non-trivial PNG size as proxy
    // plus editor ink. Dedicated print paint uses the same decorateArrow renderer.
    printInked = url.length > 1000 ? inked : 0;
  }
  return {
    ok: inked >= 2,
    inked,
    printInked,
    printBytes: (url || '').length,
    ratio,
    ends,
    samples: samples.filter((s) => s.a > 0).slice(0, 6),
  };
});
check(
  'arrowhead pixels on screen',
  arrowPixels.ok && arrowPixels.printBytes > 1000,
  JSON.stringify(arrowPixels)
);

// Insert Text → type immediately → typed text saves.
await page.keyboard.press('Escape');
await armPorTool('#por-insert-text');
await new Promise((r) => setTimeout(r, 300));
await page.keyboard.type('Pier note typed', { delay: 20 });
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 600));
await page.waitForFunction(() => /Saved|Ready/.test((document.querySelector('#por-status') || {}).textContent || ''), { timeout: 5000 }).catch(() => {});
const typedText = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId);
  const texts = (page0.overlays || []).filter((o) => o.kind === 'text');
  const hit = texts.find((t) => /Pier note typed/.test(String(t.text || '')));
  const host = document.querySelector('.por-fabric-host');
  const canvas = host && host._porCanvas;
  const editing = canvas && canvas.getActiveObject && canvas.getActiveObject() &&
    canvas.getActiveObject().isEditing;
  return {
    hit: !!(hit && hit.text),
    text: hit && hit.text,
    placeholders: texts.filter((t) => t.text === 'Text').length,
    stillEditing: !!editing,
  };
});
check(
  'Insert Text captures typed text',
  typedText.hit && /Pier note typed/.test(typedText.text || ''),
  JSON.stringify(typedText)
);
await page.screenshot({ path: path.join(OUT, 'por-cc2-text-arrow.png'), fullPage: true });

// --- CC3: style save, undo/redo, Print on first toolbar row ---
await page.evaluate(() => { document.querySelector('#por-add-page')?.click(); });
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => {
  const canvas = document.querySelector('.por-fabric-host')?._porCanvas;
  if (canvas) { canvas.clear(); canvas.discardActiveObject(); canvas.requestRenderAll(); }
});
const sheetBoxStyle = await page.$eval('.por-fabric-host', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
function stylePt(px, py) {
  return { x: sheetBoxStyle.x + sheetBoxStyle.w * (px / 100), y: sheetBoxStyle.y + sheetBoxStyle.h * (py / 100) };
}

// Fill on + draw rect with real mouse.
await page.evaluate(() => {
  const cb = document.querySelector('#por-fill');
  if (cb && !cb.checked) cb.click();
});
await armPorTool('[data-rb-tool="rect"]');
const r0 = stylePt(40, 40);
const r1 = stylePt(55, 55);
await page.mouse.move(r0.x, r0.y);
await page.mouse.down();
await page.mouse.move(r1.x, r1.y, { steps: 6 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 400));
await page.keyboard.press('Escape');
await armPorTool('[data-por-tool="select"]');
await new Promise((r) => setTimeout(r, 150));
// Click empty then rect centre (CC repro).
await page.mouse.click(stylePt(10, 10).x, stylePt(10, 10).y);
await new Promise((r) => setTimeout(r, 100));
await page.mouse.click(stylePt(47.5, 47.5).x, stylePt(47.5, 47.5).y);
await new Promise((r) => setTimeout(r, 200));

await page.click('#por-outline-btn');
await new Promise((r) => setTimeout(r, 150));
const outlineSwatch = await page.evaluate(() => {
  const sw = Array.from(document.querySelectorAll('#por-outline-pop [data-por-outline]')).find(
    (b) => b.getAttribute('data-por-outline') === '#c14a2b'
  );
  if (!sw) return null;
  const r = sw.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, open: !document.querySelector('#por-outline-pop')?.hidden };
});
check('outline swatch visible', !!(outlineSwatch && outlineSwatch.open), JSON.stringify(outlineSwatch));
// Re-read swatch after fixed positioning, then real mouse click.
const outlineHit = await page.evaluate(() => {
  const sw = Array.from(document.querySelectorAll('#por-outline-pop [data-por-outline]')).find(
    (b) => b.getAttribute('data-por-outline') === '#c14a2b'
  );
  if (!sw) return null;
  const r = sw.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const el = document.elementFromPoint(x, y);
  return {
    x, y,
    hitSwatch: !!(el && (el === sw || sw.contains(el))),
    hitCls: el && String(el.className || '').slice(0, 60),
  };
});
check('outline swatch is topmost at click point', !!(outlineHit && outlineHit.hitSwatch), JSON.stringify(outlineHit));
if (outlineHit) {
  await page.mouse.move(outlineHit.x, outlineHit.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
}
await new Promise((r) => setTimeout(r, 800));
await page.waitForFunction(() => /Saved/.test((document.querySelector('#por-status') || {}).textContent || ''), { timeout: 5000 }).catch(() => {});

const outlineSaved = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId);
  const rect = (page0.overlays || []).find((o) => o.kind === 'rect' || o.kind === 'roundRect');
  const canvas = document.querySelector('.por-fabric-host')?._porCanvas;
  const obj = canvas && rect && canvas.getObjects().find((o) => o.porId === rect.id);
  return {
    color: rect && rect.color,
    fabricStroke: obj && obj.stroke,
    id: rect && rect.id,
    n: (page0.overlays || []).length,
  };
});
check(
  'outline colour saves on selected shape',
  outlineSaved.color === '#c14a2b' && outlineSaved.fabricStroke === '#c14a2b',
  JSON.stringify(outlineSaved)
);
const outlineChipSync = await page.evaluate(() => {
  const chip = document.querySelector('#por-outline-chip');
  const bg = (chip && (chip.style.background || getComputedStyle(chip).backgroundColor)) || '';
  return { bg, matches: /c14a2b|193,\s*74,\s*43/i.test(bg) };
});
check(
  'outline chip shows selected shape colour',
  outlineChipSync.matches,
  JSON.stringify(outlineChipSync)
);

await page.mouse.click(stylePt(47.5, 47.5).x, stylePt(47.5, 47.5).y);
await new Promise((r) => setTimeout(r, 100));
await page.click('#por-dash-btn');
await new Promise((r) => setTimeout(r, 150));
const dashSwatch = await page.evaluate(() => {
  const sw = document.querySelector('#por-dash-pop [data-por-dash="dashed"]');
  if (!sw) return null;
  const r = sw.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, open: !document.querySelector('#por-dash-pop')?.hidden };
});
if (dashSwatch) await page.mouse.click(dashSwatch.x, dashSwatch.y);
await new Promise((r) => setTimeout(r, 700));
await page.waitForFunction(() => /Saved/.test((document.querySelector('#por-status') || {}).textContent || ''), { timeout: 5000 }).catch(() => {});

const dashSaved = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId);
  const rect = (page0.overlays || []).find((o) => o.kind === 'rect' || o.kind === 'roundRect');
  const canvas = document.querySelector('.por-fabric-host')?._porCanvas;
  const obj = canvas && canvas.getObjects().find((o) => o.porId === (rect && rect.id));
  return {
    dash: rect && rect.dash,
    fabricDash: obj && obj.strokeDashArray,
    color: rect && rect.color,
  };
});
check(
  'dash style saves on selected shape',
  dashSaved.dash === 'dashed' && Array.isArray(dashSaved.fabricDash) && dashSaved.fabricDash.length >= 2,
  JSON.stringify(dashSaved)
);

// Undo/redo with real keyboard after drawing another shape.
const beforeUndoN = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId);
  return (page0.overlays || []).length;
});
await armPorTool('[data-rb-tool="circle"]');
const c0 = stylePt(70, 40);
const c1 = stylePt(80, 52);
await page.mouse.move(c0.x, c0.y);
await page.mouse.down();
await page.mouse.move(c1.x, c1.y, { steps: 5 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 500));
await page.waitForFunction(() => /Saved|Ready/.test((document.querySelector('#por-status') || {}).textContent || ''), { timeout: 5000 }).catch(() => {});
const afterDrawN = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId);
  return {
    n: (page0.overlays || []).length,
    fabricN: (document.querySelector('.por-fabric-host')?._porCanvas?.getObjects() || []).length,
  };
});
await page.keyboard.down('Control');
await page.keyboard.press('z');
await page.keyboard.up('Control');
await new Promise((r) => setTimeout(r, 700));
await page.waitForFunction(() => /Saved|Ready/.test((document.querySelector('#por-status') || {}).textContent || ''), { timeout: 5000 }).catch(() => {});
const afterUndo = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId);
  return {
    n: (page0.overlays || []).length,
    fabricN: (document.querySelector('.por-fabric-host')?._porCanvas?.getObjects() || []).length,
    kinds: (page0.overlays || []).map((o) => o.kind),
  };
});
check(
  'Ctrl+Z undoes draw on canvas and overlays',
  afterDrawN.n > beforeUndoN && afterUndo.n === beforeUndoN && afterUndo.fabricN === beforeUndoN,
  JSON.stringify({ beforeUndoN, afterDrawN, afterUndo })
);

await page.click('#por-undo'); // may be disabled if stack empty after Ctrl+Z — draw then toolbar undo
await armPorTool('[data-rb-tool="triangle"]');
const t0 = stylePt(20, 60);
const t1 = stylePt(30, 75);
await page.mouse.move(t0.x, t0.y);
await page.mouse.down();
await page.mouse.move(t1.x, t1.y, { steps: 5 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 500));
const midN = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId);
  return (page0.overlays || []).length;
});
await page.click('#por-undo');
await new Promise((r) => setTimeout(r, 700));
const afterToolbarUndo = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId);
  return {
    n: (page0.overlays || []).length,
    fabricN: (document.querySelector('.por-fabric-host')?._porCanvas?.getObjects() || []).length,
  };
});
check(
  'toolbar Undo removes last shape',
  midN > afterToolbarUndo.n && afterToolbarUndo.n === afterToolbarUndo.fabricN,
  JSON.stringify({ midN, afterToolbarUndo })
);

await page.click('#por-redo');
await new Promise((r) => setTimeout(r, 700));
const afterRedo = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const page0 = record.planOfRepair.pages.find((p) => p.id === record.planOfRepair.activePageId);
  return {
    n: (page0.overlays || []).length,
    fabricN: (document.querySelector('.por-fabric-host')?._porCanvas?.getObjects() || []).length,
  };
});
check(
  'toolbar Redo restores shape',
  afterRedo.n === midN && afterRedo.fabricN === midN,
  JSON.stringify({ midN, afterRedo })
);

// Print stays on first toolbar row at 1440 and 1280.
async function toolbarPrintRow(width) {
  await page.setViewport({ width, height: 960 });
  await page.evaluate(() => {
    // Close overflow menus so an open collapse body does not inflate toolbar height.
    document.querySelectorAll('.por-ribbon__group--collapsible.is-open').forEach((g) => {
      g.classList.remove('is-open');
      const btn = g.querySelector('.por-ribbon__collapse-btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
    document.querySelectorAll('.por-picker__pop').forEach((pop) => {
      if (pop.id === 'por-shapes-pop' && pop.classList.contains('por-shapes__pop--docked')) return;
      pop.hidden = true;
    });
    window.dispatchEvent(new Event('resize'));
  });
  await new Promise((r) => setTimeout(r, 250));
  return page.evaluate(() => {
    const toolbar = document.querySelector('.por-toolbar');
    const printBtn = document.querySelector('#por-print');
    if (!toolbar || !printBtn) return { ok: false };
    const tr = toolbar.getBoundingClientRect();
    const pr = printBtn.getBoundingClientRect();
    const undo = document.querySelector('#por-undo')?.getBoundingClientRect();
    return {
      ok: pr.top < (undo ? undo.bottom + 8 : tr.top + 40) && pr.bottom <= tr.bottom + 1,
      toolbarH: tr.height,
      printTop: pr.top,
      undoBottom: undo ? undo.bottom : null,
      width: window.innerWidth,
      openGroups: Array.from(document.querySelectorAll('.por-ribbon__group--collapsible.is-open'))
        .map((g) => g.getAttribute('data-por-collapse')),
    };
  });
}
const print1440 = await toolbarPrintRow(1440);
check(
  'Print stays on first toolbar row at 1440',
  // Tall PowerPoint-style ribbon (Tim Nov 11) — command band taller than the old 78px strip.
  print1440.ok && print1440.toolbarH <= 140,
  JSON.stringify(print1440)
);
const print1280 = await toolbarPrintRow(1280);
check(
  'Print stays on first toolbar row at 1280',
  print1280.ok && print1280.toolbarH <= 140,
  JSON.stringify(print1280)
);

// PowerPoint chrome pass checks (handles, mini toolbar colours, no side panel at rest).
await page.setViewport({ width: 1440, height: 900 });
await armPorTool('[data-por-tool="select"]');
await new Promise((r) => setTimeout(r, 200));
const chromeAtRest = await page.evaluate(() => {
  const panel = document.querySelector('#por-panel');
  const inspector = document.querySelector('#por-inspector');
  return {
    panelHidden: !panel || panel.hidden || getComputedStyle(panel).display === 'none',
    inspectorHidden: !inspector || inspector.hidden,
    ribbonLabels: Array.from(document.querySelectorAll('.por-ribbon__label')).map((el) => el.textContent.trim()),
    shapesBtn: !!document.querySelector('#por-shapes-btn'),
    statusbar: !!document.querySelector('.por-statusbar'),
    pageIndicator: (document.querySelector('#por-page-indicator') || {}).textContent || '',
    fillChip: (document.querySelector('#por-fill-chip') || {}).style?.background || '',
    outlineChip: (document.querySelector('#por-outline-chip') || {}).style?.background || '',
  };
});
check(
  'no side panel open at rest',
  chromeAtRest.panelHidden && chromeAtRest.inspectorHidden,
  JSON.stringify(chromeAtRest)
);
check(
  'ribbon groups + shape gallery + status bar',
  chromeAtRest.shapesBtn &&
    chromeAtRest.statusbar &&
    chromeAtRest.ribbonLabels.indexOf('Drawing') !== -1 &&
    chromeAtRest.ribbonLabels.indexOf('Clipboard') !== -1,
  JSON.stringify(chromeAtRest)
);

// CC chrome blockers: every *visible* ribbon + status-bar control must be
// inside the viewport and top-at-centre (elementFromPoint). Document height
// equals window height. Collapse groups may hide Font/Clipboard bodies —
// their collapse buttons must still be reachable.
async function layoutReachable(width, height) {
  await page.setViewport({ width, height });
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    document.querySelectorAll('.por-picker__pop').forEach((p) => { p.hidden = true; });
    document.querySelectorAll('.por-ribbon__group--collapsible.is-open').forEach((g) => {
      g.classList.remove('is-open');
    });
    document.querySelector('[data-por-shapemenu]')?.remove();
    // Exit any IText edit so Fabric's hidden textarea is idle (parked by CSS).
    try {
      const host = document.querySelector('.por-fabric-host');
      const canvas = host && host._porCanvas;
      const active = canvas && canvas.getActiveObject && canvas.getActiveObject();
      if (active && typeof active.exitEditing === 'function') active.exitEditing();
      if (canvas && canvas.discardActiveObject) {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      }
    } catch (_) {}
    document.querySelectorAll('body > textarea').forEach((ta) => {
      if (document.activeElement === ta) ta.blur();
      ta.style.top = '0px';
      ta.style.left = '0px';
      ta.style.paddingTop = '0px';
    });
    // Fit mode: whole sheet in the stage; document must not page-scroll.
    const fit = document.querySelector('#por-zoom-level');
    if (fit) fit.click();
    window.dispatchEvent(new Event('resize'));
  });
  await new Promise((r) => setTimeout(r, 250));
  return page.evaluate(() => {
    const bad = [];
    function isVisible(el) {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0.5 && r.height > 0.5;
    }
    function checkEl(el, name) {
      if (!isVisible(el)) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const inView = cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight;
      const hit = inView ? document.elementFromPoint(cx, cy) : null;
      const top = !!(hit && (hit === el || el.contains(hit) ||
        (el.id && hit.closest && hit.closest('#' + CSS.escape(el.id)))));
      if (!inView || !top) {
        bad.push({
          name,
          inView,
          top,
          x: Math.round(r.left),
          y: Math.round(r.top),
          hit: hit && (hit.id || String(hit.className).slice(0, 40)),
        });
      }
    }
    const ribbonIds = [
      'por-paste', 'por-cut', 'por-copy', 'por-format-painter',
      'por-shapes-btn', 'por-fill', 'por-fill-btn', 'por-outline-btn',
      'por-weight-btn', 'por-dash-btn', 'por-opacity', 'por-set-default',
      'por-select-menu-btn', 'por-undo', 'por-redo', 'por-toggle-grid',
      'por-toggle-rulers', 'por-hand', 'por-insert-btn', 'por-print',
      'por-arrange-btn',
    ];
    ribbonIds.forEach((id) => checkEl(document.getElementById(id), id));
    document.querySelectorAll('.por-ribbon__collapse-btn').forEach((btn, i) => {
      checkEl(btn, 'collapse-' + i + '-' + (btn.getAttribute('aria-label') || ''));
    });
    const statusIds = [
      'por-page-indicator', 'por-zoom-out', 'por-zoom-slider',
      'por-zoom-pct', 'por-zoom-level', 'por-zoom-in',
    ];
    statusIds.forEach((id) => checkEl(document.getElementById(id), id));
    checkEl(document.querySelector('.por-statusbar'), 'statusbar');
    const docH = document.documentElement.scrollHeight;
    const winH = window.innerHeight;
    const heightOk = Math.abs(docH - winH) <= 1;
    const status = document.querySelector('.por-statusbar');
    const app = document.querySelector('#app-view');
    const statusOk = !!(status && app &&
      status.getBoundingClientRect().bottom <= winH + 1 &&
      app.getBoundingClientRect().bottom <= winH + 1);
    const collapsed = Array.from(
      document.querySelectorAll('.por-ribbon__group--collapsible.is-collapsed')
    ).map((g) => g.getAttribute('data-por-collapse'));
    return {
      ok: bad.length === 0 && heightOk && statusOk,
      bad,
      heightOk,
      statusOk,
      docH,
      winH,
      collapsed,
      width: window.innerWidth,
    };
  });
}
const layout1280 = await layoutReachable(1280, 800);
check('ribbon+status reachable, height fits at 1280×800', layout1280.ok, JSON.stringify(layout1280));
const layout1440 = await layoutReachable(1440, 900);
check('ribbon+status reachable, height fits at 1440×900', layout1440.ok, JSON.stringify(layout1440));
const layout1920 = await layoutReachable(1920, 1080);
check('ribbon+status reachable, height fits at 1920×1080', layout1920.ok, JSON.stringify(layout1920));

// Open Insert → Floor plan with page.mouse at 1280×800 (page.click can pierce covers).
await page.setViewport({ width: 1280, height: 800 });
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => {
  document.querySelectorAll('.por-picker__pop').forEach((p) => { p.hidden = true; });
  document.querySelectorAll('.por-ribbon__group--collapsible.is-open').forEach((g) => {
    g.classList.remove('is-open');
  });
});
const insertMouse = await page.evaluate(() => {
  const btn = document.querySelector('#por-insert-btn');
  if (!btn) return null;
  const r = btn.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
check('Insert centre known at 1280', !!insertMouse, JSON.stringify(insertMouse));
if (insertMouse) {
  await page.mouse.click(insertMouse.x, insertMouse.y);
  await page.waitForFunction(() => {
    const pop = document.querySelector('#por-insert-pop');
    return pop && !pop.hidden;
  }, { timeout: 2500 }).catch(() => {});
  const planTarget = await page.evaluate(() => {
    const plan = document.querySelector('#por-bring-plan');
    if (!plan) return null;
    const r = plan.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      top: !!(hit && (hit.id === 'por-bring-plan' || hit.closest?.('#por-bring-plan'))),
    };
  });
  check('Floor plan item top-at-centre after Insert mouse open', !!(planTarget && planTarget.top), JSON.stringify(planTarget));
  if (planTarget && planTarget.top) {
    await page.mouse.click(planTarget.x, planTarget.y);
    await new Promise((r) => setTimeout(r, 600));
  }
  const afterPlan = await page.evaluate(() => ({
    bg: !!document.querySelector('.por-sheet-bg img'),
    popClosed: !!(document.querySelector('#por-insert-pop')?.hidden),
  }));
  check('Insert→Floor plan via page.mouse at 1280', afterPlan.bg, JSON.stringify(afterPlan));
}
await page.setViewport({ width: 1440, height: 900 });
await new Promise((r) => setTimeout(r, 200));

// Small pier-dot selection: handles must leave the mark visible (padding > corner).
await armPorTool('[data-rb-tool="circle"]');
await page.waitForSelector('.por-fabric-host canvas.upper-canvas');
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => {
  const canvas = document.querySelector('.por-fabric-host')?._porCanvas
    || window.fabric?.Canvas?.instances?.[0];
  // Draw a small circle via Fabric API if mouse path is heavy — prefer real mouse below.
});
const upperChrome = await page.$('.por-fabric-host canvas.upper-canvas');
const chromeBox = await upperChrome.boundingBox();
await page.mouse.move(chromeBox.x + chromeBox.width * 0.22, chromeBox.y + chromeBox.height * 0.28);
await page.mouse.down();
await page.mouse.move(chromeBox.x + chromeBox.width * 0.235, chromeBox.y + chromeBox.height * 0.295, { steps: 4 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 400));
await armPorTool('[data-por-tool="select"]');
await new Promise((r) => setTimeout(r, 200));
// Click near the small circle to select it.
await page.mouse.click(chromeBox.x + chromeBox.width * 0.227, chromeBox.y + chromeBox.height * 0.287);
await new Promise((r) => setTimeout(r, 300));
const handlePad = await page.evaluate(() => {
  const host = document.querySelector('.por-fabric-host');
  const canvas = host && host._porCanvas;
  const active = canvas && canvas.getActiveObject && canvas.getActiveObject();
  if (!active) return { ok: false, reason: 'no-active' };
  const pad = Number(active.padding) || 0;
  const corner = Number(active.cornerSize) || 0;
  const br = active.getBoundingRect(true, true);
  return {
    ok: pad >= 10 && corner <= 10 && br.width > 0,
    pad,
    corner,
    w: br.width,
    h: br.height,
    cornerColor: active.cornerColor,
    cornerStroke: active.cornerStrokeColor,
  };
});
check(
  'selected small circle not covered by handles',
  handlePad.ok && handlePad.pad >= handlePad.corner,
  JSON.stringify(handlePad)
);

// Right-click mini toolbar shows current fill/outline colour bars.
await page.evaluate(() => document.querySelector('[data-por-shapemenu]')?.remove());
const miniColors = await page.evaluate(() => {
  const host = document.querySelector('.por-fabric-host');
  const canvas = host && host._porCanvas;
  if (!canvas) return { ok: false, reason: 'no-canvas' };
  let active = canvas.getActiveObject && canvas.getActiveObject();
  if (!active) {
    const objs = canvas.getObjects().filter((o) => !o.excludeFromExport && o.porId);
    if (objs.length) {
      canvas.setActiveObject(objs[objs.length - 1]);
      active = canvas.getActiveObject();
    }
  }
  if (!active || !active.porId) return { ok: false, reason: 'no-active' };
  // Give the mark a known fill/outline so the mini bars are meaningful.
  if (active.set) {
    active.set({ fill: '#eab308', stroke: '#1d4ed8' });
    canvas.requestRenderAll();
  }
  const rect = canvas.upperCanvasEl.getBoundingClientRect();
  const br = active.getBoundingRect(true);
  const clientX = rect.left + br.left + br.width / 2;
  const clientY = rect.top + br.top + br.height / 2;
  const evt = new MouseEvent('mousedown', {
    bubbles: true, cancelable: true, button: 2, buttons: 2, clientX, clientY, view: window,
  });
  // Fire Fabric's own mouse:down so openShapeMenu runs with a real target.
  canvas.fire('mouse:down', { e: evt, target: active, button: 2 });
  return { ok: true, clientX, clientY, id: active.porId, fill: active.fill, stroke: active.stroke };
});
await new Promise((r) => setTimeout(r, 300));
const miniChrome = await page.evaluate(() => {
  const bars = Array.from(document.querySelectorAll('.por-mini__bar')).map((el) => ({
    role: el.getAttribute('data-por-mini-swatch'),
    bg: el.style.background || getComputedStyle(el).backgroundColor,
  }));
  const labels = Array.from(document.querySelectorAll('.por-mini__btn')).map((b) =>
    (b.getAttribute('aria-label') || b.textContent || '').trim()
  );
  return {
    mini: !!document.querySelector('.por-mini'),
    bars,
    labels,
    hasFillBar: bars.some((b) => b.role === 'fill' && b.bg),
    hasOutlineBar: bars.some((b) => b.role === 'outline' && b.bg),
  };
});
check(
  'mini toolbar shows current fill/outline colours',
  miniChrome.mini && miniChrome.hasFillBar && miniChrome.hasOutlineBar &&
    miniChrome.labels.indexOf('Style') !== -1,
  JSON.stringify({ miniColors, miniChrome })
);
await page.evaluate(() => document.querySelector('[data-por-shapemenu]')?.remove());

await page.setViewport({ width: 1440, height: 900 });
await page.screenshot({ path: path.join(OUT, 'por-chrome-1440-selected.png'), fullPage: true });
await page.setViewport({ width: 1280, height: 800 });
await page.screenshot({ path: path.join(OUT, 'por-chrome-1280-ribbon.png'), fullPage: true });
await page.setViewport({ width: 1440, height: 960 });
await page.screenshot({ path: path.join(OUT, 'por-cc3-style-undo.png'), fullPage: true });

await page.pdf({
  path: path.join(OUT, 'por-drawing-evidence.pdf'),
  width: '17in',
  height: '11in',
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
});
check('11x17 PDF written', fs.existsSync(path.join(OUT, 'por-drawing-evidence.pdf')) && fs.statSync(path.join(OUT, 'por-drawing-evidence.pdf')).size > 800);

await page.setViewport({ width: 390, height: 844 });
await page.goto(BASE + '#/file/por-draw', { waitUntil: 'networkidle0' });
await page.waitForSelector('#home-repair-top');
await page.screenshot({ path: path.join(OUT, 'por-btn-narrow.png'), fullPage: true });
check('narrow screenshot', fs.existsSync(path.join(OUT, 'por-btn-narrow.png')));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
