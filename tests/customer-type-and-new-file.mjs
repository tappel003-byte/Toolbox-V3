/**
 * New Customer File saves only once it has something that names the job, and a Customer File can be
 * Personal or Business (Tim, Nov 13, 2026). Real mouse and keyboard throughout.
 *
 * - Tapping + New Customer File and walking away leaves nothing behind (no file, so nothing syncs).
 * - A name, a company, an address or a floor plan creates the file; autosave then works as before.
 * - Personal | Business switch: same record, different fields shown; nothing typed is ever cleared.
 * - A business file is titled by its company, with the contact person underneath.
 * - The report titles a business by its company, not "<Word> Residence".
 *
 * Run: node tests/customer-type-and-new-file.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('dialog', async (d) => { await d.accept(); });
await page.setViewport({ width: 1440, height: 900 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

const files = () => page.evaluate(async () => (await ToolboxDB.getAllCustomerFiles()).map((r) => ({
  id: r.id, first: r.firstName, last: r.lastName, company: r.companyName, title: r.contactTitle,
  type: r.customerType || '', addr: r.propertyAddress, phone: r.cellPhone, email: r.email,
  plans: (r.planSetup && r.planSetup.canvases || []).filter((c) => c.plan && c.plan.id).length,
})));
async function clearAll() {
  // Empty the device's Customer Files the way the other suites do, so each case starts clean.
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
    db.close();
  });
}
async function realClick(sel) {
  const el = await page.$(sel);
  if (!el) throw new Error('missing ' + sel);
  const bb = await el.boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await wait(500);
}
async function openNew() {
  await page.goto(BASE + '#/', { waitUntil: 'networkidle0' });
  await wait(900);
  await realClick('#cabinet-new');
  await page.waitForSelector('#field-firstName');
  await wait(900);
}
const status = () => page.$eval('#file-status', (el) => el.textContent.trim()).catch(() => '');

await clearAll();

// ===== 1. Tap New, type nothing, leave: nothing is created
await openNew();
await wait(2500);
check('Tapping New Customer File and typing nothing creates no file', (await files()).length === 0, JSON.stringify(await files()));
check('The screen says it is not saved yet', /not saved yet/i.test(await status()), await status());
await realClick('#file-back');
await wait(1500);
check('Backing out of an empty new file leaves no file', (await files()).length === 0);

// ===== 2. Done on an empty new file returns to the list and creates nothing
await openNew();
await realClick('#file-done');
await wait(2000);
check('Done on an empty new file creates nothing and returns to the list',
  (await files()).length === 0 && (await page.evaluate(() => location.hash)) === '#/', await page.evaluate(() => location.hash));

// ===== 3. Notes alone do not name a job
await openNew();
await page.click('#field-notes'); await page.keyboard.type('just a note');
await wait(2500);
check('A note with no name, company or address does not create a file', (await files()).length === 0);

// ===== 4. One letter of a name creates the file; autosave then carries on
await openNew();
await page.click('#field-firstName'); await page.keyboard.type('J');
await wait(2500);
check('One letter in the first name creates the file', (await files()).length === 1, JSON.stringify(await files()));
await page.keyboard.type('im');
await wait(2000);
check('and autosave carries on from there', (await files())[0].first === 'Jim', JSON.stringify(await files()));

// ===== 5. An address alone creates it (phone is not required)
await clearAll();
await openNew();
await page.click('#field-propertyAddress'); await page.keyboard.type('8414 4th Street Northwest', { delay: 10 });
await wait(2500);
const addrOnly = await files();
check('An address alone creates the file (no phone needed)', addrOnly.length === 1 && addrOnly[0].addr === '8414 4th Street Northwest' && !addrOnly[0].phone, JSON.stringify(addrOnly));

// ===== 6. A floor plan alone creates it
await clearAll();
await openNew();
await realClick('[data-edit-section="plans"]');
const png = '/tmp/claude-0/-home-user-Toolbox-V3/b91acc57-0ca1-5d82-985d-4d5639fa54e5/scratchpad/qa204/plan-test.png';
await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 600; c.height = 400; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 400); x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(30, 30, 540, 340);
  window.__png = c.toDataURL('image/png').split(',')[1];
});
fs.writeFileSync(png, Buffer.from(await page.evaluate(() => window.__png), 'base64'));
const planInput = await page.$('#cf-plans-panel input[type="file"]');
check('The Plans & levels tab offers a file input on a brand-new file', !!planInput);
if (planInput) { await planInput.uploadFile(png); await wait(4500); }
const planOnly = await files();
check('Adding only a floor plan creates the file', planOnly.length === 1 && planOnly[0].plans >= 1, JSON.stringify(planOnly));

// ===== 7. Business: company alone creates it; the switch changes the fields, never the data
await clearAll();
await openNew();
await realClick('button[data-customer-type="business"]');
const bizFields = await page.evaluate(() => {
  const vis = (id) => { const el = document.querySelector('#field-' + id); const row = el && el.closest('.field'); return !!(el && row && !row.hidden && row.offsetParent !== null); };
  const lab = (id) => (document.querySelector('#field-' + id)?.closest('.field')?.querySelector('label')?.textContent || '').trim();
  return {
    company: vis('companyName'), title: vis('contactTitle'), first: lab('firstName'), last: lab('lastName'), phone: lab('cellPhone'),
    homePhone: vis('homePhone'), spouse: vis('spouseName'),
    companyFirst: (() => { const f = document.querySelector('#customer-form'); const first = f && f.querySelector('.field'); return !!(first && first.querySelector('#field-companyName')); })(),
  };
});
check('Business: Company is the first field on the form', bizFields.company && bizFields.companyFirst, JSON.stringify(bizFields));
check('Business: contact first / last name, title and phone are labelled as the contact',
  bizFields.title && bizFields.first === 'Contact first name' && bizFields.last === 'Contact last name' && bizFields.phone === 'Contact phone', JSON.stringify(bizFields));
check('Business: no home phone or spouse / partner fields', !bizFields.homePhone && !bizFields.spouse, JSON.stringify(bizFields));
await page.click('#field-companyName'); await page.keyboard.type('VCA Town and Country Animal Hospital #832', { delay: 8 });
await wait(2500);
const bizOnly = await files();
check('A company alone creates the file, saved as a business',
  bizOnly.length === 1 && bizOnly[0].company === 'VCA Town and Country Animal Hospital #832' && bizOnly[0].type === 'business', JSON.stringify(bizOnly));
await page.click('#field-firstName'); await page.keyboard.type('Dana');
await page.click('#field-lastName'); await page.keyboard.type('Reyes');
await page.click('#field-contactTitle'); await page.keyboard.type('Hospital manager');
await page.click('#field-propertyAddress'); await page.keyboard.type('8414 4th Street Northwest');
await realClick('[data-edit-section="contacts"]');
await page.click('#field-cellPhone'); await page.keyboard.type('505-555-0832');
await page.click('#field-email'); await page.keyboard.type('dana@vca.example');
await wait(2500);
const biz = (await files())[0];
check('Business contact, title, phone, email and address are saved',
  biz.first === 'Dana' && biz.last === 'Reyes' && biz.title === 'Hospital manager' && biz.phone === '505-555-0832' && biz.email === 'dana@vca.example' && biz.addr === '8414 4th Street Northwest', JSON.stringify(biz));

// switching to Personal and back clears nothing
await realClick('[data-edit-section="customer"]');
await realClick('button[data-customer-type="personal"]');
await wait(1500);
const afterPersonal = (await files())[0];
check('Switching to Personal keeps every business value', afterPersonal.company === biz.company && afterPersonal.title === 'Hospital manager' && afterPersonal.first === 'Dana' && afterPersonal.type === '', JSON.stringify(afterPersonal));
const personalLabels = await page.evaluate(() => ({
  first: document.querySelector('#field-firstName').closest('.field').querySelector('label').textContent.trim(),
  titleHidden: document.querySelector('#field-contactTitle').closest('.field').hidden,
}));
check('Personal view: plain labels, no title field', personalLabels.first === 'First name' && personalLabels.titleHidden, JSON.stringify(personalLabels));
await realClick('button[data-customer-type="business"]');
await wait(1500);
const backToBiz = (await files())[0];
check('Switching back to Business restores everything', backToBiz.type === 'business' && backToBiz.company === biz.company && backToBiz.title === 'Hospital manager', JSON.stringify(backToBiz));

// reopening the saved file shows the Business view
await page.goto(BASE + '#/', { waitUntil: 'networkidle0' });
await wait(1200);
const list = await page.evaluate(() => [...document.querySelectorAll('.cabinet-row')].map((r) => ({
  name: r.querySelector('.cabinet-row__name')?.textContent.trim(), contact: r.querySelector('.cabinet-row__contact')?.textContent.trim() || '',
})));
check('The Customer Files list titles the business by its company, contact underneath',
  list.length === 1 && list[0].name === 'VCA Town and Country Animal Hospital #832' && list[0].contact === 'Dana Reyes · Hospital manager', JSON.stringify(list));
await page.goto(BASE + '#/file/' + biz.id + '/edit', { waitUntil: 'networkidle0' });
await wait(1500);
const reopened = await page.evaluate(() => ({ biz: document.querySelector('button[data-customer-type="business"]').getAttribute('aria-pressed'), company: document.querySelector('#field-companyName').value }));
check('Reopening a business file opens in the Business view with its company', reopened.biz === 'true' && /VCA/.test(reopened.company), JSON.stringify(reopened));

// ===== 8. A personal file still behaves as before
await clearAll();
await openNew();
await page.click('#field-firstName'); await page.keyboard.type('Martin');
await page.click('#field-lastName'); await page.keyboard.type('Gobel');
await page.click('#field-propertyAddress'); await page.keyboard.type('5220 Chapel NW');
await wait(2500);
await page.goto(BASE + '#/', { waitUntil: 'networkidle0' });
await wait(1200);
const personalList = await page.evaluate(() => [...document.querySelectorAll('.cabinet-row')].map((r) => ({ name: r.querySelector('.cabinet-row__name')?.textContent.trim(), contact: !!r.querySelector('.cabinet-row__contact') })));
check('A personal file is still titled by the person, with no contact line', personalList.length === 1 && personalList[0].name === 'Martin Gobel' && !personalList[0].contact, JSON.stringify(personalList));

// ===== 9. The report titles a business by its company
await clearAll();
await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 800; c.height = 600; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 600); x.strokeStyle = '#111'; x.strokeRect(20, 20, 760, 560);
  await ToolboxDB.putMedia('plan-biz', c.toDataURL('image/jpeg', 0.9));
  const rec = ToolboxApp.blankCustomerFile('biz-report'); ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Dana'; rec.lastName = 'Reyes'; rec.companyName = 'VCA Hospital 832'; rec.customerType = 'business'; rec.contactTitle = 'Manager';
  rec.propertyAddress = '8414 4th Street Northwest, Albuquerque, NM 87114';
  const cv = rec.planSetup.canvases[0]; cv.name = 'Main Level'; cv.plan = { id: 'plan-biz', width: 800, height: 600 };
  const poly = [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 }];
  rec.floorSurvey = { id: 'fs-b', inspectionDate: '2026-11-13', byCanvasId: { [cv.id]: { canvasId: cv.id, points: [1, 2, 3, 4, 5, 6].map((n) => ({ id: 'p' + n, floorId: cv.id, index: n, x: 100 + n * 90, y: 200, value: 5 + n * 0.3 })), areas: [{ id: 'a1', name: 'Main Level', polygon: poly, createdAt: 1 }], boundary: poly } } };
  await ToolboxDB.saveCustomerFile(rec);
});
await page.goto(BASE + '#/file/biz-report/report', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await wait(4500);
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')].find((el) => !/reserved/i.test(el.getAttribute('data-page-id') || '')) || document.querySelector('.rb-thumb[data-page-id^="floor-"]');
  t?.click();
});
await page.waitForFunction(() => !!document.querySelector('[data-rb-floor-import]') || !!document.querySelector('[data-rb-floor-box^="topo"]'), { timeout: 25000 });
await page.evaluate(() => document.querySelector('[data-rb-floor-import]')?.click());
await wait(3500);
const sheetText = (await page.evaluate(() => document.querySelector('.rb-sheet:not(.rb-sheet--thumb)')?.innerText || '')).replace(/\s+/g, ' ');
check('The report sheet titles the business by its company, not "<Word> Residence"',
  /VCA Hospital 832/i.test(sheetText) && !/832\s+Residence/i.test(sheetText) && !/Reyes\s+Residence/i.test(sheetText),
  JSON.stringify(sheetText.replace(/\s+/g, ' ').slice(0, 400)));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
