/**
 * TLS workspace smoke — shared job, TLS side, Job Walk without plan, POR pages.
 * Run with static server at http://127.0.0.1:8765
 *   python3 -m http.server 8765 --bind 127.0.0.1
 *   node tests/tls-workspace-smoke.mjs
 */
import { createRequire } from 'module';
import { mkdir, writeFile } from 'fs/promises';

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

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
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

  const rec = window.ToolboxApp.blankCustomerFile('tls-smoke-1');
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'TLS';
  rec.lastName = 'Smoke';
  rec.propertyAddress = '10904 Milky Way Street Northwest, Albuquerque, NM 87114';
  rec.distress = {
    id: 'd-tls',
    updatedAt: new Date().toISOString(),
    pins: [],
    quickCapture: [],
    jobWalk: { updatedAt: '', notes: [] },
  };
  await window.ToolboxDB.saveCustomerFile(rec);
});

await page.goto(BASE + '#/file/tls-smoke-1', { waitUntil: 'networkidle0' });
await page.waitForSelector('#home-card-name');

check(
  'normal open is Sandia Geo side',
  await page.$eval('#home-side-geo', (el) => el.classList.contains('is-active'))
);

await page.click('#home-side-tls');
await page.waitForSelector('.cf-home--tls');
check('TLS side class on body', await page.evaluate(() => document.body.classList.contains('tls-side')));
check('TLS Job Walk card', !!(await page.$('[data-tls-app="job-walk"]')));
check('TLS Plan of Repair card', !!(await page.$('[data-tls-app="repair"]')));
check('Directions visible with address', await page.$eval('#home-directions', (el) => !el.hidden));

await page.screenshot({ path: `${OUT}/tls-home.png`, fullPage: true });

await page.click('[data-tls-app="job-walk"]');
await page.waitForSelector('.jw-shell');
await page.type('#jw-note-text', 'Homeowner said the front door sticks.');
await page.select('#jw-speaker', 'homeowner');
await page.click('#jw-note-save');
await page.waitForFunction(() => document.querySelectorAll('.jw-note').length > 0);
check('Job Walk saves typed visit note', true);

await page.click('#jw-back');
await page.waitForSelector('.cf-home--tls');
await page.click('[data-tls-app="job-walk"]');
await page.waitForSelector('.jw-note__text');
const noteText = await page.$eval('.jw-note__text', (el) => el.textContent);
check('Job Walk note survives reopen', /front door sticks/.test(noteText));

const shared = await page.evaluate(async () => {
  const rec = await window.ToolboxDB.getCustomerFile('tls-smoke-1');
  const notes = rec && rec.distress && rec.distress.jobWalk && rec.distress.jobWalk.notes;
  return Array.isArray(notes) && notes.some((n) => /front door sticks/.test(n.text || ''));
});
check('Job Walk data lives on shared Customer File', shared);

await page.screenshot({ path: `${OUT}/tls-job-walk.png`, fullPage: true });

await page.click('#jw-back');
await page.waitForSelector('.cf-home--tls');
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
await page.click('[data-tls-app="repair"]');
await page.waitForSelector('#por-sheet');
check('POR opens without a plan', !!(await page.$('#por-sheet')));
check('POR import drawing control', !!(await page.$('#por-import-bg')));
await page.click('#por-add-page');
const pages = await page.$$eval('#por-page-list .rb-rail__page', (els) => els.length);
check('POR supports multiple sheets', pages >= 2, String(pages));

await page.screenshot({ path: `${OUT}/tls-por.png`, fullPage: true });

await page.click('#por-back');
await page.waitForSelector('.cf-home--tls');
await page.click('#home-side-geo');
await page.waitForFunction(() => /#\/file\/[^/]+$/.test(location.hash));
await page.waitForSelector('#home-side-geo.is-active');
const name = await page.$eval('#home-card-name', (el) => el.textContent.trim());
const onGeo = await page.evaluate(() =>
  document.querySelector('#home-side-geo')?.classList.contains('is-active') &&
  !document.body.classList.contains('tls-side')
);
check('Geo side shows same customer', /TLS Smoke/.test(name) && onGeo, name);

// Open in TLS from cabinet •••
await page.goto(BASE + '#/', { waitUntil: 'networkidle0' });
await page.waitForSelector('.cabinet-row-shell');
await page.click('.cabinet-row-menu__toggle');
await page.waitForSelector('.cabinet-row-menu__panel');
const hasOpenTls = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.cabinet-row-menu__action'))
    .some((btn) => btn.textContent.trim() === 'Open in TLS')
);
check('Cabinet ••• has Open in TLS', hasOpenTls);
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('.cabinet-row-menu__action'))
    .find((el) => el.textContent.trim() === 'Open in TLS');
  if (btn) btn.click();
});
await page.waitForSelector('.cf-home--tls');
check('Open in TLS lands on TLS home', await page.evaluate(() => location.hash.includes('/tls')));

await page.screenshot({ path: `${OUT}/tls-open-from-menu.png`, fullPage: true });

const failed = results.filter((r) => !r.ok);
await writeFile(`${OUT}/tls-workspace-smoke.json`, JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
