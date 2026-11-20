/**
 * Diagnostics opens on a page of tools (Tim, Nov 20, 2026): 3D, Epoch, Remove High/Low, Tilt & Deflection.
 * 3D and Epoch are live; the other two are marked as coming.
 *
 * Run: node tests/diagnostics-tiles.mjs   (static server on 8765)
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'dx-tiles';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.setViewport({ width: 1400, height: 900 });
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(async (id) => {
  const c = document.createElement('canvas'); c.width = 800; c.height = 600;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 600); x.strokeStyle = '#111'; x.strokeRect(20, 20, 760, 560);
  await ToolboxDB.putMedia('plan-dx', c.toDataURL('image/jpeg', 0.9));
  const rec = ToolboxApp.blankCustomerFile(id); ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Tile'; rec.lastName = 'Test'; rec.propertyAddress = '1 Test Way';
  const cv = rec.planSetup.canvases[0]; cv.name = 'Main Level'; cv.plan = { id: 'plan-dx', width: 800, height: 600 };
  await ToolboxDB.saveCustomerFile(rec);
}, FILE);

// From the Customer File, the Diagnostics tile opens the page of tools.
await page.goto(`${BASE}#/file/${FILE}`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.cf-app-btn[data-app="diagnostics"]', { timeout: 20000 });
await wait(1200);
await page.click('.cf-app-btn[data-app="diagnostics"]'); await wait(900);
check('The Diagnostics tile opens the page of tools', /\/diagnostics$/.test(page.url()) && !!(await page.$('#dx-apps')), page.url());
const tiles = await page.evaluate(() => [...document.querySelectorAll('[data-dx-tool]')].map((b) => ({
  key: b.getAttribute('data-dx-tool'),
  name: b.querySelector('.cf-app-btn__name').textContent.trim(),
  state: b.querySelector('.cf-app-btn__state').textContent.trim(),
  art: !!b.querySelector('svg'),
  w: Math.round(b.getBoundingClientRect().width),
})));
check('There are four tools: 3D, Epoch, Remove High/Low, Tilt & Deflection', tiles.map((t) => t.name).join('|') === '3D|Epoch|Remove High/Low|Tilt & Deflection', JSON.stringify(tiles.map((t) => t.name)));
check('Each has its own picture', tiles.every((t) => t.art));
check('3D and Epoch are live; the other two say Coming', tiles[0].state === '' && tiles[1].state === '' && tiles[2].state === 'Coming' && tiles[3].state === 'Coming', JSON.stringify(tiles.map((t) => t.state)));
// two columns, like the Customer File
const grid = await page.evaluate(() => { const r = [...document.querySelectorAll('[data-dx-tool]')].map((b) => b.getBoundingClientRect()); return { sameRow: Math.abs(r[0].top - r[1].top) < 4, secondRowBelow: r[2].top > r[0].bottom - 2, noOverlap: r[1].left >= r[0].right - 1 }; });
check('The tiles sit in a grid without overlapping', grid.sameRow && grid.secondRowBelow && grid.noOverlap, JSON.stringify(grid));
await page.screenshot({ path: new URL('./review-artifacts/diagnostics-tiles.png', import.meta.url).pathname }).catch(() => {});

// A coming tile does nothing.
await page.click('[data-dx-tool="tilt"]'); await wait(400);
check('A "coming" tile opens nothing', /\/diagnostics$/.test(page.url()) && !(await page.$('.sc')));

// Epoch opens the compare tool.
await page.click('[data-dx-tool="epoch"]'); await wait(500);
check('Epoch opens the compare tool', !!(await page.$('.sc')));
await page.keyboard.press('Escape'); await wait(300);
check('and closing it returns to the tiles', !(await page.$('.sc')) && !!(await page.$('#dx-apps')));

// 3D opens the existing workspace, and Back returns to the tiles.
await page.click('[data-dx-tool="3d"]'); await wait(2500);
check('3D opens the 3D workspace', /\/diagnostics\/3d$/.test(page.url()) && (await page.evaluate(() => document.body.classList.contains('diagnostics-open'))), page.url());
await page.click('.dx-ribbon__back');
await wait(1500);
check('Back from 3D returns to the page of tools', /\/diagnostics$/.test(page.url()) && !!(await page.$('#dx-apps')), page.url());

// Back from the tiles returns to the Customer File.
await page.click('#dx-home-back'); await wait(900);
check('Back from the tools returns to the Customer File', page.url().endsWith(`#/file/${FILE}`) && !!(await page.$('.cf-app-btn[data-app="diagnostics"]')), page.url());

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
