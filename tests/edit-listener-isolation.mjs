/**
 * The Customer File editor must never save into a file other than its own.
 *
 * Tim, Nov 12, 2026: after working in Jim Thomas 294's Edit customer screen, typing the contact
 * information of a NEW file renamed Jim 294 to the new file's name and address, and a stale copy
 * of the file was saved over newer pins and survey points. The earlier editor kept listening on the
 * shared container, read whichever form was on screen, and saved it into its own (older) record.
 *
 * Run: node tests/edit-listener-isolation.mjs  (static server on 8765)
 * Real mouse and keyboard throughout.
 */
import { createRequire } from 'module';
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

await page.evaluate(async () => {
  const mk = (id, first, last, addr, phone) => {
    const r = ToolboxApp.blankCustomerFile(id);
    ToolboxPlanSetup.ensurePlanSetup(r);
    r.firstName = first; r.lastName = last; r.propertyAddress = addr; r.cellPhone = phone;
    r.notes = 'original notes ' + id;
    return r;
  };
  const c = document.createElement('canvas'); c.width = 400; c.height = 300;
  await ToolboxDB.putMedia('plan-294', c.toDataURL('image/png'));
  const a = mk('jim-294', 'Jim', 'Thomas', '294 Broken Arrow Trail', '505-555-0294');
  a.planSetup.canvases[0].plan = { id: 'plan-294', width: 400, height: 300 };
  a.distress.pins = [1, 2, 3].map((n) => ({ id: 'pin' + n, canvasId: a.planSetup.canvases[0].id, x: 50 + n * 10, y: 100, num: n }));
  await ToolboxDB.saveCustomerFile(a);
  await ToolboxDB.saveCustomerFile(mk('jim-292', 'Jim', 'Thomas', '292 Broken Arrow Trail', '505-555-0292'));
});

const snap = (id) => page.evaluate(async (fid) => {
  const r = await ToolboxDB.getCustomerFile(fid);
  if (!r) return null;
  return {
    name: (r.firstName + ' ' + r.lastName).trim(), addr: r.propertyAddress, phone: r.cellPhone, notes: r.notes,
    pins: (r.distress.pins || []).length,
    floorPts: Object.values((r.floorSurvey && r.floorSurvey.byCanvasId) || {}).reduce((n, f) => n + (f.points || []).length, 0),
    plans: (r.planSetup.canvases || []).filter((c) => c.plan && c.plan.id).length,
  };
}, id);
const newFileIds = () => page.evaluate(async () => (await ToolboxDB.getAllCustomerFiles()).map((r) => r.id).filter((i) => i !== 'jim-294' && i !== 'jim-292'));
async function realClick(sel) {
  const el = await page.$(sel);
  if (!el) throw new Error('missing ' + sel);
  const bb = await el.boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await wait(500);
}

// ===== A. Tim's exact steps, with real work done on Jim 294 after its editor was opened
await page.goto(BASE + '#/file/jim-294/edit', { waitUntil: 'networkidle0' });
await wait(1500);
await page.click('#field-notes'); await page.keyboard.type(' walked the site'); await wait(1500);
const jimNotesAfterTyping = (await snap('jim-294')).notes;
check('Typing in Jim 294\'s own editor saves into Jim 294', /walked the site/.test(jimNotesAfterTyping), jimNotesAfterTyping);
// More work on that file from other screens (Distress pins, Floor Survey points)
await page.evaluate(async () => {
  const r = await ToolboxDB.getCustomerFile('jim-294'); const cv = r.planSetup.canvases[0].id;
  for (let n = 4; n <= 12; n += 1) r.distress.pins.push({ id: 'pin' + n, canvasId: cv, x: 50 + n * 10, y: 100, num: n });
  r.distress.updatedAt = new Date().toISOString();
  r.floorSurvey = { id: 'fs', inspectionDate: '2026-11-09', updatedAt: new Date().toISOString(), byCanvasId: { [cv]: { canvasId: cv, points: [1, 2, 3, 4, 5, 6].map((n) => ({ id: 'p' + n, index: n, x: n * 20, y: 50, value: 5 + n })) } } };
  r.updatedAt = new Date().toISOString();
  await ToolboxDB.saveCustomerFile(r);
});
// Leave without Done, start a new file, type its contact information
await page.goto(BASE + '#/', { waitUntil: 'networkidle0' });
await wait(1200);
await realClick('#cabinet-new');
await page.waitForSelector('#field-firstName');
await wait(800);
await page.click('#field-firstName'); await page.keyboard.type('VCA Town and Country Animal Hospital', { delay: 15 });
await page.click('#field-propertyAddress'); await page.keyboard.type('8414 4th Street Northwest', { delay: 15 });
await page.click('#field-cellPhone').catch(() => {});
await wait(3500);
const jim = await snap('jim-294');
check('Jim 294 keeps its name and address after a new file is typed in',
  jim.name === 'Jim Thomas' && jim.addr === '294 Broken Arrow Trail', JSON.stringify(jim));
check('Jim 294 keeps its phone and notes', jim.phone === '505-555-0294' && /walked the site/.test(jim.notes), JSON.stringify(jim));
check('Jim 294 keeps the newer work: 12 pins, 6 survey points, its plan',
  jim.pins === 12 && jim.floorPts === 6 && jim.plans === 1, JSON.stringify(jim));
const fresh = await newFileIds();
const vca = fresh.length === 1 ? await snap(fresh[0]) : null;
check('The new file got what was typed, and only the new file',
  fresh.length === 1 && vca && vca.name === 'VCA Town and Country Animal Hospital' && vca.addr === '8414 4th Street Northwest' && vca.plans === 0 && vca.pins === 0,
  JSON.stringify({ fresh: fresh.length, vca }));
const j292 = await snap('jim-292');
check('Jim 292 is untouched', j292.name === 'Jim Thomas' && j292.addr === '292 Broken Arrow Trail' && j292.phone === '505-555-0292', JSON.stringify(j292));

// ===== B. Three editors in a row (292, then 294 untouched, then a second new file)
await page.goto(BASE + '#/file/jim-292/edit', { waitUntil: 'networkidle0' });
await wait(1200);
await page.click('#field-notes'); await page.keyboard.type(' two'); await wait(1200);
await page.goto(BASE + '#/file/jim-294/edit', { waitUntil: 'networkidle0' });
await wait(1200);
await page.goto(BASE + '#/', { waitUntil: 'networkidle0' });
await wait(1000);
await realClick('#cabinet-new');
await page.waitForSelector('#field-firstName');
await wait(600);
await page.click('#field-firstName'); await page.keyboard.type('Second New File', { delay: 15 });
await page.click('#field-propertyAddress'); await page.keyboard.type('1 Second Street', { delay: 15 });
await wait(3500);
const a2 = await snap('jim-292'); const b2 = await snap('jim-294');
check('After three editors in a row, neither earlier file was renamed',
  a2.name === 'Jim Thomas' && a2.addr === '292 Broken Arrow Trail' && b2.name === 'Jim Thomas' && b2.addr === '294 Broken Arrow Trail', JSON.stringify({ a2, b2 }));
check('And Jim 294 still has its 12 pins and 6 survey points', b2.pins === 12 && b2.floorPts === 6, JSON.stringify(b2));

// ===== C. Leaving right after typing still saves into the file you were in (no Done button)
await page.goto(BASE + '#/file/jim-292/edit', { waitUntil: 'networkidle0' });
await wait(1200);
await page.click('#field-notes'); await page.keyboard.type(' KEEPME');
await page.evaluate(() => { window.location.hash = '#/'; });   // straight away, before any autosave delay
await wait(2500);
const kept = await snap('jim-292');
check('Leaving a form right after typing still saves what was typed, into that file', /KEEPME/.test(kept.notes), kept.notes);
const stillJim = await snap('jim-294');
check('and nothing leaked into another file when leaving that way', stillJim.name === 'Jim Thomas' && !/KEEPME/.test(stillJim.notes), JSON.stringify(stillJim));

// ===== D. The Done button still saves and leaves
await page.goto(BASE + '#/file/jim-292/edit', { waitUntil: 'networkidle0' });
await wait(1200);
await page.click('#field-notes'); await page.keyboard.type(' DONEOK');
await realClick('#file-done');
await wait(2000);
const done = await snap('jim-292');
check('The Done button still saves the typed text', /DONEOK/.test(done.notes), done.notes);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
