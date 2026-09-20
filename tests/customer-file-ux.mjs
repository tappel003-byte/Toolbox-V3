/**
 * Customer File responsive UX and plan-only readiness gate.
 * Run: node tests/customer-file-ux.mjs
 * Requires a static server at http://127.0.0.1:8765 (repo root).
 */
import { createRequire } from 'module';

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

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));

await page.goto(BASE, { waitUntil: 'networkidle0' });
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

  const noPlan = window.ToolboxApp.blankCustomerFile('ux-no-plan');
  window.ToolboxPlanSetup.ensurePlanSetup(noPlan);
  noPlan.firstName = 'No';
  noPlan.lastName = 'Plan';
  noPlan.propertyAddress = '10 Setup Lane';
  await window.ToolboxDB.saveCustomerFile(noPlan);

  const planCanvas = document.createElement('canvas');
  planCanvas.width = 640;
  planCanvas.height = 420;
  const context = planCanvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 640, 420);
  context.strokeStyle = '#082036';
  context.lineWidth = 5;
  context.strokeRect(35, 35, 570, 350);
  context.fillStyle = '#66727d';
  context.font = '30px sans-serif';
  context.fillText('Main Level', 220, 220);
  await window.ToolboxDB.putMedia('ux-plan-media', planCanvas.toDataURL('image/png'));

  const ready = window.ToolboxApp.blankCustomerFile('ux-ready');
  window.ToolboxPlanSetup.ensurePlanSetup(ready);
  ready.firstName = 'Jordan';
  ready.lastName = 'Miller';
  ready.propertyAddress = '125 Mountain View Drive, Phoenix, AZ';
  ready.cellPhone = '555-0100';
  ready.planSetup.canvases[0].name = 'Main Level';
  ready.planSetup.canvases[0].plan = { id: 'ux-plan-media', width: 640, height: 420 };
  ready.planSetup.canvases[0].rooms = [{ id: 'room-1', name: 'Living Room' }];
  await window.ToolboxDB.saveCustomerFile(ready);
});

const viewports = [
  { name: 'phone', width: 390, height: 844, scale: 2 },
  { name: 'ipad', width: 820, height: 1180, scale: 1 },
  { name: 'desktop', width: 1440, height: 960, scale: 1 },
];

for (const viewport of viewports) {
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.scale,
  });
  await page.goto(`${BASE}#/file/ux-ready`, { waitUntil: 'networkidle0' });
  await new Promise((resolve) => setTimeout(resolve, 450));

  const layout = await page.evaluate(() => {
    const grid = document.querySelector('.cf-home__apps');
    const cards = [...document.querySelectorAll('.cf-app-btn')];
    return {
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
      cards: cards.length,
      iconsLoaded: cards.every((card) => {
        const image = card.querySelector('img');
        return image && image.complete && image.naturalWidth > 0;
      }),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      hasPlanNeeded: cards.some((card) => card.classList.contains('is-locked')),
    };
  });

  check(`${viewport.name}: workspace home remains 2×2`, layout.columns === 2 && layout.cards === 4, JSON.stringify(layout));
  check(`${viewport.name}: all four app icons load`, layout.iconsLoaded, JSON.stringify(layout));
  check(`${viewport.name}: no horizontal overflow`, !layout.overflow, JSON.stringify(layout));
  check(`${viewport.name}: ready plan unlocks workspaces`, !layout.hasPlanNeeded, JSON.stringify(layout));
  await page.screenshot({
    path: `${OUT}/customer-file-ux-${viewport.name}.png`,
    fullPage: true,
  });

  await page.goto(`${BASE}#/file/ux-ready/edit/customer`, { waitUntil: 'networkidle0' });
  await new Promise((resolve) => setTimeout(resolve, 350));
  const editorLayout = await page.evaluate(() => ({
    tabs: document.querySelectorAll('[data-edit-section]').length,
    visiblePanels: [...document.querySelectorAll('[data-edit-panel]')].filter((panel) => !panel.hidden).length,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  check(`${viewport.name}: sectioned editor remains contained`, editorLayout.tabs === 3 && editorLayout.visiblePanels === 1 && !editorLayout.overflow, JSON.stringify(editorLayout));
  await page.screenshot({
    path: `${OUT}/customer-file-editor-${viewport.name}.png`,
    fullPage: true,
  });
}

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.goto(`${BASE}#/file/ux-no-plan`, { waitUntil: 'networkidle0' });
await new Promise((resolve) => setTimeout(resolve, 400));

const gateBefore = await page.evaluate(() => ({
  calloutVisible: !document.querySelector('#home-plan-callout')?.hidden,
  lockedCards: document.querySelectorAll('.cf-app-btn.is-locked').length,
}));
check('Missing plan clearly explains the only readiness gate', gateBefore.calloutVisible && gateBefore.lockedCards === 4, JSON.stringify(gateBefore));

await page.click('[data-app="distress"]');
await page.waitForFunction(() => location.hash.endsWith('/edit/plans'));
await new Promise((resolve) => setTimeout(resolve, 300));
const redirected = await page.evaluate(() => ({
  hash: location.hash,
  plansVisible: !document.querySelector('[data-edit-panel="plans"]')?.hidden,
  customerHidden: !!document.querySelector('[data-edit-panel="customer"]')?.hidden,
}));
check('Blocked workspace sends user directly to Plans & levels', redirected.plansVisible && redirected.customerHidden, JSON.stringify(redirected));
await page.screenshot({ path: `${OUT}/customer-file-ux-plan-setup-phone.png`, fullPage: true });

await page.click('[data-edit-section="contacts"]');
await page.type('#field-cellPhone', '555-0199');
await new Promise((resolve) => setTimeout(resolve, 1200));
const autosaved = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('ux-no-plan');
  return {
    value: record && record.cellPhone,
    visiblePanels: [...document.querySelectorAll('[data-edit-panel]')].filter((panel) => !panel.hidden).length,
  };
});
check('Sectioned editor preserves autosave', autosaved.value === '555-0199', JSON.stringify(autosaved));
check('Sectioned editor shows one clear task at a time', autosaved.visiblePanels === 1, JSON.stringify(autosaved));

await page.goto(`${BASE}#/file/ux-brand-new/edit`, { waitUntil: 'networkidle0' });
await new Promise((resolve) => setTimeout(resolve, 500));
const draftPersisted = await page.evaluate(async () => !!(await window.ToolboxDB.getCustomerFile('ux-brand-new')));
check('A newly opened Customer File draft persists immediately', draftPersisted);

await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' });
await new Promise((resolve) => setTimeout(resolve, 350));
const cabinet = await page.evaluate(() => ({
  title: document.querySelector('.cabinet-hero h1')?.textContent,
  rows: document.querySelectorAll('.cabinet-row').length,
  newButton: document.querySelector('#cabinet-new')?.textContent,
}));
check('Cabinet presents clear file-finding and creation actions', cabinet.title === 'Customer Files' && cabinet.rows >= 3 && /New Customer File/.test(cabinet.newButton || ''), JSON.stringify(cabinet));
await page.screenshot({ path: `${OUT}/customer-file-ux-cabinet-phone.png`, fullPage: true });

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
