/**
 * Explorer map: Satellite look, search for a place, continuous zoom, zoom cap, labels, phone layout.
 * (Tim, Nov 13, 2026: the map was glitchy and zoomed on forever with no house to see; add satellite and
 * a search box, and make it look good on a phone.)
 *
 * The map module is mounted on its own page; tiles and the search are answered locally, so the test
 * reads what the map ASKS for. Real mouse and keyboard; pinch uses real multi-touch from the browser.
 * Run: node tests/explorer-map-places.mjs
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import net from 'net';
import { join } from 'path';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function findChrome() {
  for (const c of [process.env.CHROME_PATH, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium']) {
    if (!c) continue;
    try { require('fs').accessSync(c); return c; } catch (_) {}
  }
  return '/usr/bin/google-chrome';
}
const port = await new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => resolve(p)); });
  s.on('error', reject);
});
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore',
});
for (let i = 0; i < 100; i += 1) {
  try { if ((await fetch(`http://127.0.0.1:${port}/index.html`)).ok) break; } catch (_) {}
  await wait(100);
}
const shotDir = join(new URL('..', import.meta.url).pathname, 'tests', 'review-artifacts');
mkdirSync(shotDir, { recursive: true });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const GALLUP = { formatted: 'Gallup, NM, United States of America', lat: 35.528, lon: -108.742, result_type: 'city' };
const STREET = { formatted: '812 Hilltop Ave, Gallup, NM 87301', lat: 35.5281, lon: -108.7432, result_type: 'building' };

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
const asked = [];
let tileDelay = 0;
await page.setRequestInterception(true);
page.on('request', async (request) => {
  const url = request.url();
  if (/^https:\/\/(maps\.geoapify\.com|server\.arcgisonline\.com|ibasemaps-api\.arcgis\.com)\//.test(url)) {
    asked.push(url);
    if (tileDelay) await wait(tileDelay);
    request.respond({ status: 200, contentType: 'image/png', body: PNG }).catch(() => {});
    return;
  }
  if (url.startsWith('https://api.geoapify.com/v1/geocode/autocomplete')) {
    asked.push(url);
    const text = (new URL(url).searchParams.get('text') || '').toLowerCase();
    const results2 = /hilltop/.test(text) ? [STREET] : /gallup/.test(text) ? [GALLUP, STREET] : [];
    request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: results2 }), headers: { 'access-control-allow-origin': '*' } }).catch(() => {});
    return;
  }
  request.continue().catch(() => {});
});

const JOBS = [
  { id: 'j1', displayName: 'Marcus Yazzie', lat: 35.528, lon: -108.742 },
  { id: 'j2', displayName: 'Chalmers Ford', lat: 35.19, lon: -106.68 },
];

async function mount(viewport) {
  await page.setViewport(viewport);
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.ToolboxExplorerMap);
  await page.evaluate((jobs) => {
    document.body.innerHTML = '<div id="h" style="position:relative;height:520px;width:100%;margin:0"></div>';
    window.__picked = [];
    window.__m = window.ToolboxExplorerMap.create(document.getElementById('h'), { onPick: (p) => window.__picked.push(p.map((j) => j.id)) });
    window.__m.setJobs(jobs, true);
  }, JOBS);
  await wait(500);
}
const rect = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s); if (!el || el.hidden) return null;
  const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
}, sel);
const view = () => page.evaluate(() => window.__m.view());
const overlap = (a, b) => a && b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
const tilesAsked = (re) => asked.filter((u) => re.test(u)).length;

// ================= desktop
await mount({ width: 1280, height: 860, deviceScaleFactor: 1 });
await page.evaluate(() => { try { localStorage.removeItem('toolbox.explorerMapStyle'); } catch (_) {} });
check('Opens on the street map by default', await page.evaluate(() => window.__m.style() === 'street'));

// ---- Satellite
asked.length = 0;
await page.click('.explorer-map__style button[data-style="satellite"]');
await wait(500);
const sat = asked.filter((u) => /arcgisonline/.test(u));
check('Satellite asks Esri World Imagery for tiles, rows before columns',
  sat.some((u) => /World_Imagery\/MapServer\/tile\/\d+\/\d+\/\d+$/.test(u)), sat[0] || 'none');
check('Satellite also lays place names over the photographs', sat.some((u) => /World_Boundaries_and_Places\/MapServer\/tile\//.test(u)));
check('The credit changes to Esri', await page.evaluate(() => /Esri/.test(document.querySelector('.explorer-map__credit').textContent)));
check('The Satellite button shows it is on', await page.evaluate(() => document.querySelector('.explorer-map__style [data-style="satellite"]').getAttribute('aria-pressed') === 'true'));
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.ToolboxExplorerMap);
await page.evaluate((jobs) => {
  document.body.innerHTML = '<div id="h" style="position:relative;height:520px"></div>';
  window.__picked = [];
  window.__m = window.ToolboxExplorerMap.create(document.getElementById('h'), { onPick: (p) => window.__picked.push(p.map((j) => j.id)) }); window.__m.setJobs(jobs, true);
}, JOBS);
check('The look chosen is remembered on this device', await page.evaluate(() => window.__m.style() === 'satellite'));
asked.length = 0;
await page.click('.explorer-map__style button[data-style="street"]');
await wait(400);
check('Back to Map asks Geoapify street tiles again', tilesAsked(/maps\.geoapify\.com\/v1\/tile\/osm-bright\//) > 0 && tilesAsked(/arcgisonline/) === 0);

// ---- Search (real keyboard)
await page.click('.explorer-map__findinput');
await page.keyboard.type('gallup', { delay: 40 });
await page.waitForSelector('.explorer-map__found button', { timeout: 4000 });
const hits = await page.evaluate(() => [...document.querySelectorAll('.explorer-map__found button')].map((b) => b.textContent));
check('Typing a place name lists matching places', hits.length === 2 && /Gallup/.test(hits[0]), JSON.stringify(hits));
check('The search is limited to the US and leans on New Mexico',
  asked.some((u) => /autocomplete/.test(u) && /filter=countrycode:us/.test(u) && /bias=proximity:-106/.test(u)));
await page.click('.explorer-map__found li:first-child button');
await wait(400);
let v = await view();
check('Picking a town moves the map there, at town zoom', Math.abs(v.center.lat - 35.528) < 0.02 && Math.abs(v.center.lon + 108.742) < 0.02 && v.zoom === 12, JSON.stringify(v));
check('A marker shows where the search landed', !!(await rect('.explorer-map__foundpin')));
check('The list closes after a pick', !(await rect('.explorer-map__found')));
// street by Enter
await page.click('.explorer-map__findinput'); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
await page.keyboard.type('hilltop', { delay: 40 });
await page.keyboard.press('Enter');
await wait(800);
v = await view();
check('Enter takes the best match; an address zooms in to the house', v.zoom >= 16 && Math.abs(v.center.lon + 108.7432) < 0.005, JSON.stringify(v));
check('Searching never changes the jobs', await page.evaluate(() => window.__picked.length === 0));
// nothing found
await page.click('.explorer-map__findinput'); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
await page.keyboard.type('qqqqqq', { delay: 30 });
await page.waitForSelector('.explorer-map__found-none', { timeout: 4000 }).catch(() => {});
check('A search with no answer says so', await page.evaluate(() => /No place found/.test((document.querySelector('.explorer-map__found') || {}).textContent || '')));
await page.click('.explorer-map__findinput'); await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
await page.keyboard.press('Backspace');
await wait(300);
check('Clearing the box clears the marker and list', !(await rect('.explorer-map__foundpin')) && !(await rect('.explorer-map__found')));

// ---- Labels
await page.evaluate(() => window.__m.goTo(35.528, -108.742, 15));
await wait(300);
const label = await page.evaluate(() => [...document.querySelectorAll('.explorer-map__label')].map((l) => l.textContent));
check('Close in, a lone pin carries its job name', label.includes('Marcus Yazzie'), JSON.stringify(label));
await page.evaluate(() => window.__m.goTo(35.528, -108.742, 9));
await wait(300);
check('Far out there are no name labels', (await page.evaluate(() => document.querySelectorAll('.explorer-map__label').length)) === 0);

// ---- Zoom stops
await page.evaluate(() => window.__m.goTo(35.528, -108.742, 14));
for (let i = 0; i < 12; i += 1) { await page.click('.explorer-map__zoom button:first-child').catch(() => {}); }
await wait(300);
v = await view();
check('Zoom stops at level 18 and the + button goes grey', v.zoom === 18 && await page.evaluate(() => document.querySelector('.explorer-map__zoom button:first-child').disabled), JSON.stringify(v));
const zoomedAsk = asked.filter((u) => /osm-bright\/(\d+)\//.test(u)).map((u) => +/osm-bright\/(\d+)\//.exec(u)[1]);
check('No tile deeper than level 18 is ever requested', Math.max(...zoomedAsk) <= 18, String(Math.max(...zoomedAsk)));

// ---- Wheel: continuous, point under the cursor holds still
await page.evaluate(() => window.__m.goTo(35.528, -108.742, 12));
await wait(300);
const box = await rect('.explorer-map');
const px = box.l + box.w * 0.7; const py = box.t + box.h * 0.4;
const under = () => page.evaluate((x, y) => {
  const b = document.querySelector('.explorer-map').getBoundingClientRect();
  const w = window.__m.view(); const P = window.ToolboxExplorerMap.project;
  const c = P(w.center.lat, w.center.lon, w.zoom);
  const wx = c.x - b.width / 2 + (x - b.left); const wy = c.y - b.height / 2 + (y - b.top);
  const size = 256 * Math.pow(2, w.zoom);
  const lon = wx / size * 360 - 180; const n = Math.PI - 2 * Math.PI * wy / size;
  return { lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lon };
}, px, py);
const before = await under();
await page.mouse.move(px, py);
await page.mouse.wheel({ deltaY: -60 });
await wait(200);
v = await view();
const afterW = await under();
check('A wheel turn zooms in part of a level, not a whole jump', v.zoom > 12 && v.zoom < 13, JSON.stringify(v));
check('and the spot under the cursor stays under it', Math.abs(afterW.lat - before.lat) < 1e-4 && Math.abs(afterW.lon - before.lon) < 1e-4, JSON.stringify({ before, afterW }));

// ---- No blank flash: slow tiles, zoom, the old picture stays until the sharp one is in
await page.evaluate(() => window.__m.goTo(35.528, -108.742, 12));
await wait(500);
const had = await page.evaluate(() => document.querySelectorAll('.explorer-map__tile').length);
tileDelay = 1200;
await page.click('.explorer-map__zoom button:first-child');
await wait(150);
const during = await page.evaluate(() => [...document.querySelectorAll('.explorer-map__tile')].filter((t) => t.complete && t.naturalWidth > 0).length);
check('Zooming with slow tiles keeps the previous picture on screen meanwhile', during >= 1 && had >= 1, `before ${had}, loaded during ${during}`);
tileDelay = 0;
await wait(1800);
const after = await page.evaluate(() => document.querySelectorAll('.explorer-map__tile').length);
check('Once the sharp tiles are in, the old ones are cleared away', after <= had * 3 + 12, `${had} -> ${after}`);

// ---- Mouse drag still pans
await page.evaluate(() => window.__m.goTo(35.2, -106.6, 10));
await wait(300);
const c0 = (await view()).center;
await page.mouse.move(640, 400); await page.mouse.down(); await page.mouse.move(540, 400, { steps: 8 }); await page.mouse.up();
await wait(200);
const c1 = (await view()).center;
check('Dragging with the mouse pans the map', c1.lon > c0.lon + 0.05, JSON.stringify({ c0, c1 }));
await page.screenshot({ path: join(shotDir, 'explorer-map-desktop-satellite.png') });

// ================= phone (touch)
await mount({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluate(() => { try { localStorage.setItem('toolbox.explorerMapStyle', 'satellite'); } catch (_) {} window.__m.setStyle('satellite'); window.__m.goTo(35.528, -108.742, 15); });
await wait(600);
const find = await rect('.explorer-map__find'); const zoomR = await rect('.explorer-map__zoom'); const styleR = await rect('.explorer-map__style');
const credit = await rect('.explorer-map__credit'); const mapR = await rect('.explorer-map');
check('Phone: search, zoom and look controls all sit inside the map', [find, zoomR, styleR, credit].every((r) => r && r.l >= mapR.l - 1 && r.r <= mapR.r + 1 && r.t >= mapR.t - 1 && r.b <= mapR.b + 1), JSON.stringify({ find, zoomR, styleR }));
check('Phone: search does not run under the zoom buttons', !overlap(find, zoomR));
check('Phone: the look buttons clear the zoom buttons and the credit line', !overlap(styleR, zoomR) && !overlap(styleR, credit));
check('Phone: tap targets are finger-sized', zoomR.w >= 44 && (await rect('.explorer-map__zoom button')).h >= 44 && (await rect('.explorer-map__findinput')).h >= 40 && (await rect('.explorer-map__style button')).h >= 36);
check('Phone: the search text is 16px so iPhone does not zoom the page',
  (await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.explorer-map__findinput')).fontSize))) >= 16);
check('Phone: nothing scrolls sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await page.screenshot({ path: join(shotDir, 'explorer-map-phone-satellite.png') });

// search list on the phone
await page.tap('.explorer-map__findinput');
await page.keyboard.type('gallup', { delay: 40 });
await page.waitForSelector('.explorer-map__found button', { timeout: 4000 });
const list = await rect('.explorer-map__found');
check('Phone: the results list stays inside the map', list && list.r <= mapR.r + 1 && list.l >= mapR.l - 1, JSON.stringify(list));
await page.screenshot({ path: join(shotDir, 'explorer-map-phone-search.png') });
await page.tap('.explorer-map__found li:first-child button');
await wait(400);

// two-finger pinch with real touches: follows the fingers (fractional zoom), the point between them holds
await page.evaluate(() => window.__m.setStyle('street'));
await page.evaluate(() => window.__m.goTo(35.3, -107, 9));
await wait(400);
const cdp = await page.createCDPSession();
const mb = await rect('.explorer-map');
const cx = mb.l + mb.w / 2; const cy = mb.t + mb.h / 2;
const holdBefore = await page.evaluate((x, y) => {
  const b = document.querySelector('.explorer-map').getBoundingClientRect();
  const w = window.__m.view(); const P = window.ToolboxExplorerMap.project; const c = P(w.center.lat, w.center.lon, w.zoom);
  return { wx: c.x - b.width / 2 + (x - b.left), wy: c.y - b.height / 2 + (y - b.top), z: w.zoom };
}, cx, cy);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
for (let s = 1; s <= 8; s += 1) { await touch('touchMove', [[cx - 40 - s * 9, cy], [cx + 40 + s * 9, cy]]); await wait(30); }
await touch('touchEnd', []);
await wait(300);
v = await view();
check('Pinching out zooms in by the amount the fingers moved (not a whole step)', v.zoom > 9.5 && v.zoom < 11.5 && Math.abs(v.zoom - Math.round(v.zoom)) > 0.05, JSON.stringify(v));
const holdAfter = await page.evaluate((x, y) => {
  const b = document.querySelector('.explorer-map').getBoundingClientRect();
  const w = window.__m.view(); const P = window.ToolboxExplorerMap.project; const c = P(w.center.lat, w.center.lon, w.zoom);
  return { wx: c.x - b.width / 2 + (x - b.left), wy: c.y - b.height / 2 + (y - b.top), z: w.zoom };
}, cx, cy);
const k = Math.pow(2, holdAfter.z - holdBefore.z);
check('and the ground between the fingers stays between them', Math.abs(holdAfter.wx - holdBefore.wx * k) < 3 && Math.abs(holdAfter.wy - holdBefore.wy * k) < 3,
  JSON.stringify({ holdBefore, holdAfter }));
await touch('touchStart', [[cx - 80, cy], [cx + 80, cy]]);
for (let s = 1; s <= 10; s += 1) { await touch('touchMove', [[cx - 80 + s * 7, cy], [cx + 80 - s * 7, cy]]); await wait(30); }
await touch('touchEnd', []);
await wait(300);
const v2 = await view();
check('Pinching in zooms out', v2.zoom < v.zoom - 0.3, `${v.zoom.toFixed(2)} -> ${v2.zoom.toFixed(2)}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
server.kill();
if (failed.length) process.exit(1);
