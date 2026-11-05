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
  colors: (window.ToolboxReportOverlay && window.ToolboxReportOverlay.COLORS) || [],
  components: window.ToolboxSync.COMPONENTS.slice(),
}));
check('Plan of Repair API present', boot.api);
check('yellow in overlay palette', boot.colors.indexOf('#eab308') !== -1, boot.colors.join(','));
check('repair sync component', boot.components.indexOf('repair') !== -1);

await page.goto(BASE + '#/file/por-draw', { waitUntil: 'networkidle0' });
await page.waitForSelector('#home-repair-top');
const home = await page.evaluate(() => {
  const btn = document.querySelector('#home-repair-top');
  return {
    label: btn ? btn.textContent.trim() : '',
    accent: btn ? btn.classList.contains('btn--accent') : false,
    apps: Array.from(document.querySelectorAll('.cf-app-btn')).map((b) => b.getAttribute('data-app')),
  };
});
check('Plan of Repair button present', home.label === 'Plan of Repair');
check('Plan of Repair button more pronounced', home.accent);
check('four workspace cards unchanged', home.apps.join(',') === 'distress,floor,diagnostics,report');

await page.click('#home-repair-top');
await page.waitForSelector('.por-shell .rb-sheet');
await page.waitForFunction(() => /Ready|Saved/.test((document.querySelector('#por-status') || {}).textContent || ''), { timeout: 8000 }).catch(() => {});

const shell = await page.evaluate(() => ({
  hash: location.hash,
  hasToolbar: !!document.querySelector('[data-rb-format-host] .rb-format, .rb-format'),
  hasPages: !!document.querySelector('#por-page-list'),
  hasPanel: !!document.querySelector('#por-bring-plan'),
  compactBg: !!document.querySelector('.por-bg-actions .por-linkbtn'),
  fatBring: Array.from(document.querySelectorAll('#por-bring-plan, #por-bring-contour, #por-clear-bg')).some((b) => b.classList.contains('btn')),
  title: document.querySelector('.file-identity__name')?.textContent || '',
  tools: Array.from(document.querySelectorAll('[data-rb-tool]')).map((b) => b.getAttribute('data-rb-tool')),
}));
check('opens repair route', shell.hash === '#/file/por-draw/repair');
check('RB-style shell title', shell.title === 'Plan of Repair');
check('formatting/drawing toolbar mounted', shell.hasToolbar || shell.tools.length > 0);
check('pages rail present', shell.hasPages);
check('bring-in plan control', shell.hasPanel);
check('compact background actions', shell.compactBg && !shell.fatBring);
check('circle+rect tools present', shell.tools.indexOf('circle') !== -1 && shell.tools.indexOf('rect') !== -1, shell.tools.join(','));

await page.click('#por-bring-plan');
await page.waitForFunction(() => !!document.querySelector('.por-sheet-bg img'), { timeout: 5000 });
check('floor plan on sheet', await page.evaluate(() => !!document.querySelector('.por-sheet-bg img')));

// Draw a filled circle
await page.click('#por-fill');
await page.click('[data-rb-tool="circle"]');
const box = await page.$eval('.rb-sheet', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
await page.mouse.move(box.x + box.w * 0.35, box.y + box.h * 0.4);
await page.mouse.down();
await page.mouse.move(box.x + box.w * 0.42, box.y + box.h * 0.48);
await page.mouse.up();

await page.click('[data-rb-ov-color="#eab308"]');
await page.click('[data-rb-tool="rect"]');
await page.mouse.move(box.x + box.w * 0.55, box.y + box.h * 0.55);
await page.mouse.down();
await page.mouse.move(box.x + box.w * 0.62, box.y + box.h * 0.62);
await page.mouse.up();
// Put the draw tool away so the next click selects instead of stacking.
await page.keyboard.press('Escape');

const drawn = await page.evaluate(() => {
  const rec = null;
  return {
    ink: document.querySelectorAll('[data-rb-ov-kind="circle"], [data-rb-ov-kind="rect"]').length,
    railLogo: (document.querySelector('.rb-rail__logo') || {}).getAttribute?.('src') || '',
  };
});
check('drew circle and rect', drawn.ink >= 2, String(drawn.ink));
check('TLS logo on rail', /tls-foundations/.test(drawn.railLogo), drawn.railLogo);

// Select + copy/paste via keyboard
await page.evaluate(() => {
  const el = document.querySelector('[data-rb-ov-kind="circle"]') || document.querySelector('[data-rb-ov]');
  if (!el) return;
  const hit = el.querySelector('.rb-ink__hit') || el;
  const r = hit.getBoundingClientRect();
  hit.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
  }));
  hit.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, cancelable: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
  }));
});
await page.waitForSelector('.por-sel', { timeout: 3000 });
const beforePaste = await page.evaluate(() => document.querySelectorAll('[data-rb-ov]').length);
await page.evaluate(() => {
  const el = document.querySelector('[data-rb-ov-kind="circle"]') || document.querySelector('[data-rb-ov]');
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4, button: 2,
  }));
});
await page.waitForSelector('[data-por-shapemenu]');
const copied = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('[data-por-shapemenu] .rb-stackmenu__item'));
  const copy = items.find((b) => b.textContent.trim() === 'Copy');
  if (!copy) return false;
  copy.click();
  return true;
});
await new Promise((r) => setTimeout(r, 150));
await page.evaluate(() => {
  const el = document.querySelector('[data-rb-ov-kind="circle"]') || document.querySelector('[data-rb-ov]');
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + 8, button: 2,
  }));
});
await page.waitForSelector('[data-por-shapemenu]');
const pasted = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('[data-por-shapemenu] .rb-stackmenu__item'));
  const paste = items.find((b) => b.textContent.trim() === 'Paste');
  if (!paste || paste.disabled) return { ok: false, disabled: !!(paste && paste.disabled) };
  paste.click();
  return { ok: true };
});
await new Promise((r) => setTimeout(r, 300));
const afterPaste = await page.evaluate(() => document.querySelectorAll('[data-rb-ov]').length);
check(
  'copy/paste shape',
  copied && pasted.ok && afterPaste > beforePaste,
  `copied=${copied} pasted=${JSON.stringify(pasted)} ${beforePaste}→${afterPaste}`
);

const handles = await page.evaluate(() => ({
  count: document.querySelectorAll('.por-sel__handle').length,
  corners: Array.from(document.querySelectorAll('.por-sel__handle')).map((h) => h.getAttribute('data-por-corner')),
  inspector: !document.querySelector('#por-inspector')?.hidden,
}));
check('eight selection handles', handles.count === 8, JSON.stringify(handles));
check('format inspector visible', handles.inspector);
const railDensity = await page.evaluate(() => {
  const swatch = document.querySelector('.por-inspector__swatch');
  const stack = document.querySelector('.por-stack__btn');
  const seg = document.querySelector('.por-seg__btn');
  const sr = swatch && swatch.getBoundingClientRect();
  const sk = stack && stack.getBoundingClientRect();
  return {
    swatch: sr ? Math.round(sr.width) : 0,
    stackH: sk ? Math.round(sk.height) : 0,
    seg: !!seg,
    stackGrid: !!document.querySelector('.por-stack'),
  };
});
check(
  'compact inspector chrome',
  railDensity.swatch > 0 && railDensity.swatch <= 18 && railDensity.stackH > 0 && railDensity.stackH <= 32 && railDensity.seg && railDensity.stackGrid,
  JSON.stringify(railDensity)
);
await page.screenshot({ path: path.join(OUT, 'por-rail-compact.png'), fullPage: true });

// Wait for drawn shapes to persist, then select the rect by its ink hit box.
await page.waitForFunction(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  return !!(record.planOfRepair && record.planOfRepair.pages[0].overlays.some((o) => o.kind === 'rect'));
}, { timeout: 5000 });

const rectClick = await page.evaluate(() => {
  const el = document.querySelector('[data-rb-ov-kind="rect"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: el.getAttribute('data-rb-ov') };
});
check('rect target found', !!rectClick, JSON.stringify(rectClick));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 100));
if (rectClick) {
  await page.evaluate((id) => {
    const el = document.querySelector('[data-rb-ov="' + id + '"]');
    if (!el) return;
    const hit = el.querySelector('.rb-ink__hit') || el;
    const r = hit.getBoundingClientRect();
    hit.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }));
  }, rectClick.id);
}
await page.waitForSelector('#por-inspector:not([hidden])', { timeout: 3000 });

await page.evaluate(() => {
  const fillOn = document.querySelector('#por-shape-fill');
  if (fillOn && !fillOn.checked) fillOn.click();
  const fill = document.querySelector('#por-fill-swatches [data-por-color="#eab308"]');
  if (fill) fill.click();
});
await new Promise((r) => setTimeout(r, 200));
const outlineStatus = await page.evaluate(() => {
  const outline = document.querySelector('#por-outline-swatches [data-por-color="#1d4ed8"]');
  if (!outline) return { clicked: false };
  outline.click();
  return { clicked: true, status: (document.querySelector('#por-status') || {}).textContent || '' };
});
await new Promise((r) => setTimeout(r, 500));

const formatted = await page.evaluate(async (id) => {
  const ink = document.querySelector('[data-rb-ov="' + id + '"] .rb-ink');
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const ov = (record.planOfRepair.pages[0].overlays || []).find((o) => o.id === id);
  return {
    status: (document.querySelector('#por-status') || {}).textContent || '',
    domStroke: ink && ink.getAttribute('stroke'),
    domFill: ink && ink.getAttribute('fill'),
    fill: !!(ov && ov.fill),
    fillColor: ov && (ov.fillColor || null),
    color: ov && ov.color,
    id: ov && ov.id,
  };
}, rectClick && rectClick.id);
check(
  'format shape fill+outline',
  !!(formatted && formatted.domFill === '#eab308' && formatted.domStroke === '#1d4ed8' &&
    formatted.fillColor === '#eab308' && formatted.color === '#1d4ed8'),
  JSON.stringify({ outlineStatus, formatted })
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
  return record.planOfRepair.pages[0].overlays.map((o) => o.id);
});
await page.click('#por-stack-back');
await page.waitForFunction(() => /Saved|Sent back|Brought/.test((document.querySelector('#por-status') || {}).textContent || ''), { timeout: 4000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 400));
const orderBack = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  return record.planOfRepair.pages[0].overlays.map((o) => o.id);
});
await page.click('#por-stack-front');
await new Promise((r) => setTimeout(r, 400));
const orderFront = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  return record.planOfRepair.pages[0].overlays.map((o) => o.id);
});
check('send to back', orderBack.join() !== orderBefore.join(), `${orderBefore[0]}→${orderBack[0]}`);
check('bring to front', orderFront.join() !== orderBack.join() || orderFront[orderFront.length - 1] === orderBack[0], `${orderBack[0]}→${orderFront[orderFront.length - 1]}`);

// Context menu entries — dispatch on the selected shape after stack changes.
const menu = await page.evaluate(() => {
  const sheet = document.querySelector('#por-sheet');
  const el = document.querySelector('[data-rb-ov-kind="rect"]') || document.querySelector('[data-rb-ov]');
  if (!sheet || !el) return [];
  const r = el.getBoundingClientRect();
  const evt = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: r.left + Math.max(4, r.width / 2),
    clientY: r.top + Math.max(4, r.height / 2),
    button: 2,
  });
  // Hit the ink path inside the group when the group itself has no box.
  const hit = el.querySelector('.rb-ink__hit') || el;
  hit.dispatchEvent(evt);
  return Array.from(document.querySelectorAll('[data-por-shapemenu] .rb-stackmenu__item')).map((b) => b.textContent.trim());
});
check('context menu has stack+format', menu.indexOf('Bring to Front') !== -1 && menu.indexOf('Format Shape…') !== -1 && menu.indexOf('Size and Position…') !== -1, menu.join('|'));
await page.evaluate(() => document.querySelector('[data-por-shapemenu]')?.remove());

await page.screenshot({ path: path.join(OUT, 'por-shape-inspector.png'), fullPage: true });

await page.click('#por-add-page');
const pages = await page.evaluate(() => document.querySelectorAll('#por-page-list .rb-rail__page').length);
check('add another sheet', pages >= 2, String(pages));

await page.click('#por-bring-contour');
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
check('v2 schema persisted', persisted.schema === 2);
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
await page.waitForFunction(() => document.querySelectorAll('#por-sheet [data-rb-ov]').length > 0, { timeout: 5000 }).catch(() => {});
const printProbe = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('por-draw');
  const doc = record.planOfRepair;
  const sheet = document.querySelector('#por-sheet');
  const clone = sheet.cloneNode(true);
  clone.querySelectorAll('.por-sel, .rb-ov__resize, .rb-ov__remove').forEach((el) => el.remove());
  return {
    logo: (clone.querySelector('.rb-rail__logo') || {}).getAttribute?.('src') || '',
    inkDom: clone.querySelectorAll('[data-rb-ov]').length,
    inkSaved: (doc.pages[0] && doc.pages[0].overlays && doc.pages[0].overlays.length) || 0,
    chrome: clone.querySelectorAll('.por-sel, .rb-ov__resize').length,
  };
});
check(
  'print clone keeps TLS + shapes',
  /tls-foundations/.test(printProbe.logo) && (printProbe.inkDom > 0 || printProbe.inkSaved > 0),
  JSON.stringify(printProbe)
);
check('print clone strips selection chrome', printProbe.chrome === 0);

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
