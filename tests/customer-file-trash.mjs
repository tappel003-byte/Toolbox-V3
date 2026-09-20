/**
 * Customer File setup-only deletion + 120-day worked-file Trash.
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

  const setup = makeFile('trash-setup', 'Setup', 'Only', '1 Draft Way', 'plan-setup');
  await window.ToolboxDB.putMedia('plan-setup', 'data:image/png;base64,c2V0dXA=');
  await window.ToolboxDB.saveCustomerFile(setup);

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
  await window.ToolboxDB.putMedia('plan-expired', 'data:image/png;base64,b2xk');
  await window.ToolboxDB.saveCustomerFile(expired);
});

await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelectorAll('.cabinet-row').length === 3);

const initial = await page.evaluate(async () => ({
  rows: [...document.querySelectorAll('.cabinet-row__name')].map((node) => node.textContent),
  expiredRecord: await window.ToolboxDB.getCustomerFile('trash-expired'),
  expiredMedia: await window.ToolboxDB.getMedia('plan-expired'),
  setupClassifiedWorked: window.ToolboxApp.hasInvestigationData(await window.ToolboxDB.getCustomerFile('trash-setup')),
  workedClassifiedWorked: window.ToolboxApp.hasInvestigationData(await window.ToolboxDB.getCustomerFile('trash-worked')),
}));
check('Expired Trash file auto-purges after 120 days', !initial.expiredRecord && !initial.expiredMedia, JSON.stringify(initial));
check('Setup-only file is not classified as investigation data', initial.setupClassifiedWorked === false, JSON.stringify(initial));
check('Distress pin classifies file as investigation data', initial.workedClassifiedWorked === true, JSON.stringify(initial));

async function openRowMenu(name) {
  await page.evaluate((target) => {
    const shell = [...document.querySelectorAll('.cabinet-row-shell')].find(
      (node) => node.querySelector('.cabinet-row__name')?.textContent === target,
    );
    shell?.querySelector('.cabinet-row-menu__toggle')?.click();
  }, name);
}

await openRowMenu('Setup Only');
let setupMenu = await page.evaluate(() => ({
  action: document.querySelector('.cabinet-row-menu.is-open .cabinet-row-menu__danger')?.textContent,
}));
check('Setup-only menu offers immediate deletion', /Delete setup-only file/.test(setupMenu.action || ''), JSON.stringify(setupMenu));
await page.click('.cabinet-row-menu.is-open .cabinet-row-menu__danger');
await page.waitForSelector('#toolbox-confirm:not([hidden])');
let setupConfirm = await page.evaluate(() => ({
  title: document.querySelector('#confirm-title')?.textContent,
  message: document.querySelector('#confirm-message')?.textContent,
  no: document.querySelector('#confirm-no')?.textContent,
  yes: document.querySelector('#confirm-yes')?.textContent,
}));
check('Setup-only permanent delete has explicit yes/no confirmation', /setup-only/i.test(setupConfirm.title || '') && /^No/.test(setupConfirm.no || '') && /^Yes/.test(setupConfirm.yes || ''), JSON.stringify(setupConfirm));
await page.click('#confirm-no');
check('No keeps setup-only file', !!(await page.evaluate(() => window.ToolboxDB.getCustomerFile('trash-setup'))));

await openRowMenu('Setup Only');
await page.click('.cabinet-row-menu.is-open .cabinet-row-menu__danger');
await page.click('#confirm-yes');
await page.waitForFunction(() => ![...document.querySelectorAll('.cabinet-row__name')].some((node) => node.textContent === 'Setup Only'));
const setupDeleted = await page.evaluate(async () => ({
  record: await window.ToolboxDB.getCustomerFile('trash-setup'),
  plan: await window.ToolboxDB.getMedia('plan-setup'),
}));
check('Confirmed setup-only deletion removes record and plan media', !setupDeleted.record && !setupDeleted.plan, JSON.stringify(setupDeleted));

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
await page.waitForFunction(() => document.querySelectorAll('.trash-row').length === 1);
const trashView = await page.evaluate(() => ({
  title: document.querySelector('.trash-head h1')?.textContent,
  row: document.querySelector('.trash-row__main strong')?.textContent,
  retention: document.querySelector('.trash-row__main small')?.textContent,
  restore: document.querySelector('.trash-row .btn')?.textContent,
}));
check('Trash shows retention and Restore action', trashView.title === 'Trash' && trashView.row === 'Worked Survey' && /120 days/.test(trashView.retention || '') && trashView.restore === 'Restore', JSON.stringify(trashView));
await page.screenshot({ path: `${OUT}/customer-file-trash-phone.png`, fullPage: true });

await page.click('.trash-row .btn');
await page.waitForFunction(() => document.querySelector('.trash-empty-state'));
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
await page.waitForFunction(() => document.querySelectorAll('.trash-row').length === 1);

await page.click('#trash-empty');
await page.waitForSelector('#toolbox-confirm:not([hidden])');
const emptyConfirm = await page.evaluate(() => ({
  title: document.querySelector('#confirm-title')?.textContent,
  message: document.querySelector('#confirm-message')?.textContent,
  no: document.querySelector('#confirm-no')?.textContent,
  yes: document.querySelector('#confirm-yes')?.textContent,
}));
check('Empty Trash warns permanent deletion with explicit yes/no', /Permanently empty Trash/.test(emptyConfirm.title || '') && /cannot be undone/i.test(emptyConfirm.message || '') && /^No/.test(emptyConfirm.no || '') && /^Yes/.test(emptyConfirm.yes || ''), JSON.stringify(emptyConfirm));
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
    active: await window.ToolboxDB.getCustomerFile('trash-active'),
  };
});
check('Empty Trash removes record, plan, and Distress photo bytes', !permanentlyDeleted.record && !permanentlyDeleted.plan && !permanentlyDeleted.photo, JSON.stringify(permanentlyDeleted));
check('Empty Trash does not touch active Customer Files', !!permanentlyDeleted.active, JSON.stringify(permanentlyDeleted));

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
