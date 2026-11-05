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
  title: document.querySelector('.file-identity__name')?.textContent || '',
  tools: Array.from(document.querySelectorAll('[data-rb-tool]')).map((b) => b.getAttribute('data-rb-tool')),
}));
check('opens repair route', shell.hash === '#/file/por-draw/repair');
check('RB-style shell title', shell.title === 'Plan of Repair');
check('formatting/drawing toolbar mounted', shell.hasToolbar || shell.tools.length > 0);
check('pages rail present', shell.hasPages);
check('bring-in plan control', shell.hasPanel);
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
await page.mouse.click(box.x + box.w * 0.38, box.y + box.h * 0.44);
await page.keyboard.down('Control');
await page.keyboard.press('KeyC');
await page.keyboard.up('Control');
await page.keyboard.down('Control');
await page.keyboard.press('KeyV');
await page.keyboard.up('Control');
const afterPaste = await page.evaluate(() => document.querySelectorAll('[data-rb-ov]').length);
check('copy/paste shape', afterPaste >= 3, String(afterPaste));

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
