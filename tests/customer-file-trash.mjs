/**
 * Customer File stub deletion + Soft Trash + expired retention.
 * Run: node tests/customer-file-trash.mjs
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
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));

await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.setRequestInterception(true);
page.on('request', (request) => {
  const url = request.url();
  if (url.includes('sync.sandiageotoolbox.com')) request.abort().catch(() => {});
  else request.continue().catch(() => {});
});
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

  const photoDb = await new Promise((resolve, reject) => {
    const request = indexedDB.open('pgg_photos_v1', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('photos')) {
        request.result.createObjectStore('photos');
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise((resolve, reject) => {
    const tx = photoDb.transaction('photos', 'readwrite');
    tx.objectStore('photos').clear();
    tx.objectStore('photos').put('data:image/jpeg;base64,d29ya2Vk', 'ph_worked');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  photoDb.close();

  function makeFile(id, first, last, address, planId) {
    const record = window.ToolboxApp.blankCustomerFile(id);
    window.ToolboxPlanSetup.ensurePlanSetup(record);
    record.firstName = first;
    record.lastName = last;
    record.propertyAddress = address;
    record.planSetup.canvases[0].plan = { id: planId, width: 100, height: 80 };
    return record;
  }

  // Truly empty stub — only this path may hard-delete.
  const empty = window.ToolboxApp.blankCustomerFile('trash-empty');
  window.ToolboxPlanSetup.ensurePlanSetup(empty);
  await window.ToolboxDB.saveCustomerFile(empty);

  // Stub-classification fixtures (not all need distinct Cabinet labels).
  const named = window.ToolboxApp.blankCustomerFile('trash-named');
  window.ToolboxPlanSetup.ensurePlanSetup(named);
  named.firstName = 'Name';
  named.lastName = 'Only';
  await window.ToolboxDB.saveCustomerFile(named);

  const addressed = window.ToolboxApp.blankCustomerFile('trash-address');
  window.ToolboxPlanSetup.ensurePlanSetup(addressed);
  addressed.propertyAddress = '9 Address Lane';
  await window.ToolboxDB.saveCustomerFile(addressed);

  const planned = window.ToolboxApp.blankCustomerFile('trash-plan');
  window.ToolboxPlanSetup.ensurePlanSetup(planned);
  planned.planSetup.canvases[0].plan = { id: 'plan-only', width: 10, height: 10 };
  await window.ToolboxDB.putMedia('plan-only', 'data:image/png;base64,cGxhbg==');
  await window.ToolboxDB.saveCustomerFile(planned);

  const worked = makeFile('trash-worked', 'Worked', 'Survey', '2 Field Way', 'plan-worked');
  worked.distress.pins.push({
    id: 'pin-worked',
    canvasId: worked.planSetup.canvases[0].id,
    num: 1,
    x: 0.5,
    y: 0.5,
    photos: ['ph_worked'],
  });
  await window.ToolboxDB.putMedia('plan-worked', 'data:image/png;base64,d29ya2Vk');
  await window.ToolboxDB.saveCustomerFile(worked);

  const active = makeFile('trash-active', 'Keep', 'Active', '3 Active Way', 'plan-active');
  await window.ToolboxDB.putMedia('plan-active', 'data:image/png;base64,YWN0aXZl');
  await window.ToolboxDB.saveCustomerFile(active);

  const expired = makeFile('trash-expired', 'Expired', 'Survey', '4 Old Way', 'plan-expired');
  expired.distress.pins.push({ id: 'pin-expired', canvasId: expired.planSetup.canvases[0].id, photos: [] });
  expired.deletedAt = new Date(Date.now() - 121 * 86400000).toISOString();
  expired.purgeAfter = new Date(Date.now() - 86400000).toISOString();
  expired.trashUpdatedAt = expired.deletedAt;
  await window.ToolboxDB.putMedia('plan-expired', 'data:image/png;base64,b2xk');
  await window.ToolboxDB.saveCustomerFile(expired);
});

await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' });
// empty + named + addressed + planned + worked + active = 6 active (expired is trashed)
await page.waitForFunction(() => document.querySelectorAll('.cabinet-row').length === 6);

const initial = await page.evaluate(async () => ({
  rows: [...document.querySelectorAll('.cabinet-row__name')].map((node) => node.textContent),
  expiredRecord: await window.ToolboxDB.getCustomerFile('trash-expired'),
  expiredMedia: await window.ToolboxDB.getMedia('plan-expired'),
  emptyStub: window.ToolboxApp.isEmptyCustomerFileStub(await window.ToolboxDB.getCustomerFile('trash-empty')),
  namedStub: window.ToolboxApp.isEmptyCustomerFileStub(await window.ToolboxDB.getCustomerFile('trash-named')),
  addressStub: window.ToolboxApp.isEmptyCustomerFileStub(await window.ToolboxDB.getCustomerFile('trash-address')),
  planStub: window.ToolboxApp.isEmptyCustomerFileStub(await window.ToolboxDB.getCustomerFile('trash-plan')),
  workedClassifiedWorked: window.ToolboxApp.hasInvestigationData(await window.ToolboxDB.getCustomerFile('trash-worked')),
}));
check(
  'Expired Trash file remains recoverable (no silent auto-purge)',
  !!(initial.expiredRecord && initial.expiredMedia),
  JSON.stringify(initial),
);
check('Empty stub classified for hard delete', initial.emptyStub === true, JSON.stringify(initial));
check('Name-only Customer File cannot enter accidental permanent-delete path', initial.namedStub === false, JSON.stringify(initial));
check('Address-only Customer File cannot enter accidental permanent-delete path', initial.addressStub === false, JSON.stringify(initial));
check('Plan-only Customer File cannot enter accidental permanent-delete path', initial.planStub === false, JSON.stringify(initial));
check('Distress pin classifies file as investigation data', initial.workedClassifiedWorked === true, JSON.stringify(initial));
await page.screenshot({ path: `${OUT}/customer-file-cabinet-trash-phone.png`, fullPage: true });
for (const viewport of [
  { name: 'ipad', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 960 },
]) {
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
  const cabinetLayout = await page.evaluate(() => ({
    rows: document.querySelectorAll('.cabinet-row').length,
    trashButton: document.querySelector('#cabinet-trash')?.textContent?.trim() || '',
    trashCount: document.querySelector('#cabinet-trash-count')?.textContent?.trim() || '',
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  check(`${viewport.name}: Customer Files has no Trash badge and stays contained`, cabinetLayout.rows === 6 && !cabinetLayout.trashButton && !cabinetLayout.trashCount && !cabinetLayout.overflow, JSON.stringify(cabinetLayout));
  await page.screenshot({ path: `${OUT}/customer-file-cabinet-trash-${viewport.name}.png`, fullPage: true });
}
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

async function openRowMenu(name) {
  await page.evaluate((target) => {
    const shell = [...document.querySelectorAll('.cabinet-row-shell')].find(
      (node) => node.querySelector('.cabinet-row__name')?.textContent === target,
    );
    shell?.querySelector('.cabinet-row-menu__toggle')?.click();
  }, name);
}

async function openRowMenuById(id) {
  await page.evaluate((targetId) => {
    const shell = document.querySelector('.cabinet-row-shell[data-customer-file-id="' + targetId + '"]');
    shell?.querySelector('.cabinet-row-menu__toggle')?.click();
  }, id);
}

await openRowMenuById('trash-empty');
let emptyMenu = await page.evaluate(() => ({
  action: document.querySelector('.cabinet-row-menu.is-open .cabinet-row-menu__danger')?.textContent,
}));
check('Empty stub menu offers explicit permanent delete', /Delete empty file/.test(emptyMenu.action || ''), JSON.stringify(emptyMenu));
await page.click('.cabinet-row-menu.is-open .cabinet-row-menu__danger');
await page.waitForSelector('#toolbox-confirm:not([hidden])');
let emptyConfirm = await page.evaluate(() => ({
  title: document.querySelector('#confirm-title')?.textContent,
  message: document.querySelector('#confirm-message')?.textContent,
  no: document.querySelector('#confirm-no')?.textContent,
  yes: document.querySelector('#confirm-yes')?.textContent,
}));
check('Empty stub permanent delete has explicit yes/no confirmation', /Delete empty file/i.test(emptyConfirm.title || '') && /^No/.test(emptyConfirm.no || '') && /^Yes/.test(emptyConfirm.yes || ''), JSON.stringify(emptyConfirm));
await page.click('#confirm-no');
check('No keeps empty stub', !!(await page.evaluate(() => window.ToolboxDB.getCustomerFile('trash-empty'))));

await openRowMenuById('trash-empty');
await page.click('.cabinet-row-menu.is-open .cabinet-row-menu__danger');
await page.click('#confirm-yes');
await page.waitForFunction(() => document.querySelectorAll('.cabinet-row').length === 5);
const emptyDeleted = await page.evaluate(async () => ({
  record: await window.ToolboxDB.getCustomerFile('trash-empty'),
}));
check('Confirmed empty stub deletion removes record', !emptyDeleted.record, JSON.stringify(emptyDeleted));

await openRowMenu('Name Only');
const namedAction = await page.evaluate(() => document.querySelector('.cabinet-row-menu.is-open .cabinet-row-menu__danger')?.textContent);
check('Name-only file asks before a local delete', namedAction === 'Delete', namedAction);
await page.evaluate(() => document.querySelector('.cabinet-row-menu.is-open')?.classList.remove('is-open'));

await openRowMenuById('trash-address');
const addressAction = await page.evaluate(() => document.querySelector('.cabinet-row-menu.is-open .cabinet-row-menu__danger')?.textContent);
check('Address-only file asks before a local delete', addressAction === 'Delete', addressAction);
await page.evaluate(() => document.querySelector('.cabinet-row-menu.is-open')?.classList.remove('is-open'));

await openRowMenuById('trash-plan');
const planAction = await page.evaluate(() => document.querySelector('.cabinet-row-menu.is-open .cabinet-row-menu__danger')?.textContent);
check('Plan-only file asks before a local delete', planAction === 'Delete', planAction);
await page.evaluate(() => document.querySelector('.cabinet-row-menu.is-open')?.classList.remove('is-open'));

await openRowMenu('Worked Survey');
const workedAction = await page.evaluate(() => document.querySelector('.cabinet-row-menu.is-open .cabinet-row-menu__danger')?.textContent);
check('Meaningful file menu asks before deleting', workedAction === 'Delete', workedAction);
await page.click('.cabinet-row-menu.is-open .cabinet-row-menu__danger');
await page.waitForSelector('#toolbox-confirm:not([hidden])');
const workedConfirm = await page.evaluate(() => ({
  title: document.querySelector('#confirm-title')?.textContent,
  message: document.querySelector('#confirm-message')?.textContent,
}));
check(
  'Meaningful delete says the file contains information and does not use a 120-day trash',
  /Delete this Customer File/i.test(workedConfirm.title || '') &&
    /contains customer or survey information/i.test(workedConfirm.message || '') &&
    !/120 days/i.test(workedConfirm.message || ''),
  JSON.stringify(workedConfirm),
);
await page.click('#confirm-no');
check('No keeps the meaningful file', !!(await page.evaluate(() => window.ToolboxDB.getCustomerFile('trash-worked'))));

await openRowMenu('Worked Survey');
await page.click('.cabinet-row-menu.is-open .cabinet-row-menu__danger');
await page.click('#confirm-yes');
await page.waitForFunction(() => ![...document.querySelectorAll('.cabinet-row__name')].some((node) => node.textContent === 'Worked Survey'));

const deletedWorked = await page.evaluate(async () => ({
  record: await window.ToolboxDB.getCustomerFile('trash-worked'),
  plan: await window.ToolboxDB.getMedia('plan-worked'),
  photoDb: await new Promise((resolve) => {
    const request = indexedDB.open('pgg_photos_v1');
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('photos', 'readonly');
      const get = tx.objectStore('photos').get('ph_worked');
      get.onsuccess = () => resolve(get.result || null);
      get.onerror = () => resolve('error');
    };
    request.onerror = () => resolve('error');
  }),
}));
check(
  'Confirmed meaningful delete removes the local file, plan, and photo',
  !deletedWorked.record && !deletedWorked.plan && !deletedWorked.photoDb,
  JSON.stringify(deletedWorked),
);

await page.waitForFunction(() => {
  const link = document.querySelector('#local-trash-recovery');
  return link && !link.hidden;
});
const recoveryLink = await page.evaluate(() => ({
  text: document.querySelector('#local-trash-recovery')?.textContent?.trim() || '',
  badge: !!document.querySelector('#cabinet-trash-count'),
}));
check(
  'Older on-device files use a quiet recovery link with no count',
  recoveryLink.text === 'Recover files saved only on this device' && !/\d/.test(recoveryLink.text) && !recoveryLink.badge,
  JSON.stringify(recoveryLink),
);
await page.click('#local-trash-recovery');
await page.waitForFunction(() => document.querySelectorAll('.trash-row').length >= 1);
const trashView = await page.evaluate(() => ({
  title: document.querySelector('.trash-head h1')?.textContent,
  names: [...document.querySelectorAll('.trash-row__main strong')].map((n) => n.textContent),
  restore: document.querySelector('.trash-row .btn')?.textContent,
  emptyTrash: !!document.querySelector('#trash-empty'),
  hash: window.location.hash,
}));
check(
  'Local recovery shows only the older file and has no Empty Trash',
  trashView.hash === '#/trash' &&
    trashView.title === 'Recover files' &&
    !trashView.names.includes('Worked Survey') &&
    trashView.names.includes('Expired Survey') &&
    trashView.restore === 'Restore' &&
    trashView.emptyTrash === false,
  JSON.stringify(trashView),
);
await page.screenshot({ path: `${OUT}/customer-file-trash-phone.png`, fullPage: true });

for (const viewport of [
  { name: 'ipad', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 960 },
]) {
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
  const layout = await page.evaluate(() => ({
    rows: document.querySelectorAll('.trash-row').length,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  check(`${viewport.name}: recovery remains contained`, layout.rows === 1 && !layout.overflow, JSON.stringify(layout));
  await page.screenshot({ path: `${OUT}/customer-file-trash-${viewport.name}.png`, fullPage: true });
}
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

await page.evaluate(() => {
  const row = [...document.querySelectorAll('.trash-row')].find(
    (node) => node.querySelector('strong')?.textContent === 'Expired Survey',
  );
  row?.querySelector('.btn')?.click();
});
await page.waitForFunction(() => document.querySelectorAll('.trash-row').length === 0);
const restored = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('trash-expired');
  return {
    exists: !!record,
    deletedAt: record?.deletedAt,
    plan: await window.ToolboxDB.getMedia('plan-expired'),
    active: await window.ToolboxDB.getCustomerFile('trash-active'),
  };
});
check(
  'Restore returns the older file and does not touch other files',
  restored.exists && !restored.deletedAt && !!restored.plan && !!restored.active,
  JSON.stringify(restored),
);

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
