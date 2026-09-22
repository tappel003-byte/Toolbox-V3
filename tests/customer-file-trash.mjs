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
    trashButton: document.querySelector('#cabinet-trash')?.textContent?.trim(),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  check(`${viewport.name}: cabinet Trash controls remain contained`, cabinetLayout.rows === 6 && /Trash/.test(cabinetLayout.trashButton || '') && !cabinetLayout.overflow, JSON.stringify(cabinetLayout));
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
check('Name-only file menu offers Trash rather than immediate deletion', namedAction === 'Move to Trash', namedAction);
await page.evaluate(() => document.querySelector('.cabinet-row-menu.is-open')?.classList.remove('is-open'));

await openRowMenuById('trash-address');
const addressAction = await page.evaluate(() => document.querySelector('.cabinet-row-menu.is-open .cabinet-row-menu__danger')?.textContent);
check('Address-only file menu offers Trash rather than immediate deletion', addressAction === 'Move to Trash', addressAction);
await page.evaluate(() => document.querySelector('.cabinet-row-menu.is-open')?.classList.remove('is-open'));

await openRowMenuById('trash-plan');
const planAction = await page.evaluate(() => document.querySelector('.cabinet-row-menu.is-open .cabinet-row-menu__danger')?.textContent);
check('Plan-only file menu offers Trash rather than immediate deletion', planAction === 'Move to Trash', planAction);
await page.evaluate(() => document.querySelector('.cabinet-row-menu.is-open')?.classList.remove('is-open'));

await openRowMenu('Worked Survey');
const workedAction = await page.evaluate(() => document.querySelector('.cabinet-row-menu.is-open .cabinet-row-menu__danger')?.textContent);
check('Worked file menu offers Trash rather than immediate deletion', workedAction === 'Move to Trash', workedAction);
await page.click('.cabinet-row-menu.is-open .cabinet-row-menu__danger');
await page.waitForSelector('#toolbox-confirm:not([hidden])');
const workedConfirm = await page.evaluate(() => ({
  title: document.querySelector('#confirm-title')?.textContent,
  message: document.querySelector('#confirm-message')?.textContent,
}));
check('Worked file confirmation explains 120-day recovery', /Trash/.test(workedConfirm.title || '') && /120 days/.test(workedConfirm.message || ''), JSON.stringify(workedConfirm));
await page.click('#confirm-yes');
await page.waitForFunction(() => ![...document.querySelectorAll('.cabinet-row__name')].some((node) => node.textContent === 'Worked Survey'));

const trashedRecord = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('trash-worked');
  return {
    exists: !!record,
    deletedAt: record?.deletedAt,
    purgeAfter: record?.purgeAfter,
    days: record ? Math.round((Date.parse(record.purgeAfter) - Date.parse(record.deletedAt)) / 86400000) : 0,
    planExists: !!(await window.ToolboxDB.getMedia('plan-worked')),
  };
});
check('Worked file remains complete in Trash for 120 days', trashedRecord.exists && trashedRecord.days === 120 && trashedRecord.planExists, JSON.stringify(trashedRecord));

await page.click('#cabinet-trash');
await page.waitForFunction(() => document.querySelectorAll('.trash-row').length >= 2);
const trashView = await page.evaluate(() => ({
  title: document.querySelector('.trash-head h1')?.textContent,
  names: [...document.querySelectorAll('.trash-row__main strong')].map((n) => n.textContent),
  restore: document.querySelector('.trash-row .btn')?.textContent,
}));
check(
  'Trash shows worked + expired recoverable files',
  trashView.title === 'Trash' &&
    trashView.names.includes('Worked Survey') &&
    trashView.names.includes('Expired Survey') &&
    trashView.restore === 'Restore',
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
  check(`${viewport.name}: Trash remains contained`, layout.rows >= 2 && !layout.overflow, JSON.stringify(layout));
  await page.screenshot({ path: `${OUT}/customer-file-trash-${viewport.name}.png`, fullPage: true });
}
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

await page.evaluate(() => {
  const row = [...document.querySelectorAll('.trash-row')].find(
    (node) => node.querySelector('strong')?.textContent === 'Worked Survey',
  );
  row?.querySelector('.btn')?.click();
});
await page.waitForFunction(() =>
  ![...document.querySelectorAll('.trash-row__main strong')].some((n) => n.textContent === 'Worked Survey'),
);
const restored = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('trash-worked');
  return { exists: !!record, deletedAt: record?.deletedAt, purgeAfter: record?.purgeAfter };
});
check('Restore returns complete file and clears Trash metadata', restored.exists && !restored.deletedAt && !restored.purgeAfter, JSON.stringify(restored));

await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => [...document.querySelectorAll('.cabinet-row__name')].some((node) => node.textContent === 'Worked Survey'));
await openRowMenu('Worked Survey');
await page.click('.cabinet-row-menu.is-open .cabinet-row-menu__danger');
await page.click('#confirm-yes');
await page.waitForFunction(() => ![...document.querySelectorAll('.cabinet-row__name')].some((node) => node.textContent === 'Worked Survey'));
await page.click('#cabinet-trash');
await page.waitForFunction(() =>
  [...document.querySelectorAll('.trash-row__main strong')].some((n) => n.textContent === 'Worked Survey'),
);

await page.click('#trash-empty');
await page.waitForSelector('#toolbox-confirm:not([hidden])');
const emptyTrashConfirm = await page.evaluate(() => ({
  title: document.querySelector('#confirm-title')?.textContent,
  message: document.querySelector('#confirm-message')?.textContent,
  no: document.querySelector('#confirm-no')?.textContent,
  yes: document.querySelector('#confirm-yes')?.textContent,
}));
check('Empty Trash warns permanent deletion with explicit yes/no', /Permanently empty Trash/.test(emptyTrashConfirm.title || '') && /cannot be undone/i.test(emptyTrashConfirm.message || '') && /^No/.test(emptyTrashConfirm.no || '') && /^Yes/.test(emptyTrashConfirm.yes || ''), JSON.stringify(emptyTrashConfirm));
await page.click('#confirm-no');
check('No keeps worked file in Trash', !!(await page.evaluate(() => window.ToolboxDB.getCustomerFile('trash-worked'))));

await page.click('#trash-empty');
await page.click('#confirm-yes');
await page.waitForFunction(() => document.querySelector('.trash-empty-state'));
const permanentlyDeleted = await page.evaluate(async () => {
  const photoDb = await new Promise((resolve, reject) => {
    const request = indexedDB.open('pgg_photos_v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  const photo = await new Promise((resolve, reject) => {
    const tx = photoDb.transaction('photos', 'readonly');
    const request = tx.objectStore('photos').get('ph_worked');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  photoDb.close();
  return {
    record: await window.ToolboxDB.getCustomerFile('trash-worked'),
    plan: await window.ToolboxDB.getMedia('plan-worked'),
    photo,
    expired: await window.ToolboxDB.getCustomerFile('trash-expired'),
    active: await window.ToolboxDB.getCustomerFile('trash-active'),
  };
});
check('Empty Trash removes record, plan, and Distress photo bytes', !permanentlyDeleted.record && !permanentlyDeleted.plan && !permanentlyDeleted.photo, JSON.stringify(permanentlyDeleted));
check('Empty Trash also clears other trashed files', !permanentlyDeleted.expired, JSON.stringify(permanentlyDeleted));
check('Empty Trash does not touch active Customer Files', !!permanentlyDeleted.active, JSON.stringify(permanentlyDeleted));

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
