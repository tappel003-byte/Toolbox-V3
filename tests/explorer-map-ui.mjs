/**
 * File Explorer's map: List | Map, pins only where a job carries a place,
 * the jobs in view listed under the map, a year filter, and the jobs with no
 * location counted rather than guessed. Tiles are intercepted -- no request
 * reaches Geoapify -- and the sync server is a mock.
 * Run: node tests/explorer-map-ui.mjs
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import net from 'net';
import { join } from 'path';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function findChrome() {
  for (const candidate of [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (!candidate) continue;
    try { require('fs').accessSync(candidate); return candidate; } catch (_) {}
  }
  return '/usr/bin/google-chrome';
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const JOBS = [
  { id: 'job-abq1', displayName: 'Rhonda Sorenson', propertyAddress: '4925 Edwards Dr NE, Albuquerque', fieldWorkDate: '2026-10-07', lat: 35.135, lon: -106.53 },
  { id: 'job-abq2', displayName: 'Chalmers Ford', propertyAddress: '3777 American Rd NW, Albuquerque', fieldWorkDate: '2025-09-11', lat: 35.19, lon: -106.68 },
  { id: 'job-gallup', displayName: 'Marcus Yazzie', propertyAddress: '812 Hilltop Ave, Gallup', fieldWorkDate: '2026-10-02', lat: 35.528, lon: -108.742 },
  { id: 'job-none', displayName: 'Ada Mitchell', propertyAddress: '10 Oak Street', fieldWorkDate: '2026-03-01' },
];

const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'ignore',
});
for (let i = 0; i < 100; i += 1) {
  try {
    const probe = await fetch(`http://127.0.0.1:${port}/index.html`);
    if (probe.ok) break;
  } catch (_) { /* not listening yet */ }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const shotDir = join(new URL('..', import.meta.url).pathname, 'tests', 'review-artifacts');
mkdirSync(shotDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US'],
});

async function setup(page, mapRoute) {
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.ToolboxSync && window.ToolboxFileExplorer && window.ToolboxExplorerMap);
  await page.evaluate((jobs, withRoute) => {
    const base = 'http://mock-sync.local';
    window.ToolboxConfig.syncApiBase = base;
    window.__log = [];
    const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    window.__geocodeAsked = [];
    window.fetch = async function (url, opts) {
      const href = String(url);
      // The typed-address lookup. One page answers with only the town, which
      // must be refused; the other with the house.
      if (href.startsWith('https://api.geoapify.com/v1/geocode/search')) {
        const text = new URL(href).searchParams.get('text');
        window.__geocodeAsked.push(text);
        const house = window.__geocodeHouse;
        return json({ results: [house
          ? { lat: 35.084, lon: -106.65, result_type: 'building', rank: { confidence: 0.95 }, formatted: text }
          : { lat: 35.11, lon: -106.62, result_type: 'city', rank: { confidence: 0.4 }, formatted: 'Albuquerque' }] });
      }
      const path = href.slice(base.length).replace(/^\//, '');
      window.__log.push(((opts && opts.method) || 'GET') + ' ' + path);
      if (path === 'explore/files') {
        return json({ files: jobs.map((job) => {
          const row = { key: `cf/${job.id}/index.json`, id: job.id, displayName: job.displayName, propertyAddress: job.propertyAddress, fieldWorkDate: job.fieldWorkDate };
          // An older Worker's listing carries coordinates only for jobs synced since.
          if (job.id === 'job-abq1') { row.propertyAddressLat = job.lat; row.propertyAddressLon = job.lon; }
          return row;
        }) });
      }
      if (path === 'explore/map' && withRoute) return json({ jobs, readFromCustomer: 2 });
      // An older Worker: the browser reads the customer, then the floor.
      const object = /^explore\/files\/([^/]+)\/object\?key=(.+)$/.exec(path);
      if (object) {
        const key = decodeURIComponent(object[2]);
        if (key === 'cf/job-gallup/customer.json') return json({ propertyAddressLat: 35.528, propertyAddressLon: -108.742 });
        if (key === 'cf/job-abq2/customer.json') return json({ propertyAddress: '3777 American Rd NW' });
        if (key === 'cf/job-abq2/floor.json') {
          return json({ byCanvasId: { main: { bp1Gps: { latitude: 35.19, longitude: -106.68, accuracyMeters: 5, capturedAt: 1 } } } });
        }
      }
      return new Response('Not found', { status: 404 });
    };
    window.location.hash = '#/explore';
  }, JOBS, mapRoute);
  await page.waitForFunction(() => document.querySelectorAll('.explorer-row[data-id]').length === 4);
}

const pins = (page) => page.evaluate(() => [...document.querySelectorAll('.explorer-map__pin')].map((p) => ({
  ids: p.dataset.ids, text: p.textContent,
})));
const below = (page) => page.evaluate(() => ({
  title: (document.querySelector('.explorer-mapbelow__title') || {}).textContent || '',
  ids: [...document.querySelectorAll('#explorer-mapbelow > .explorer-row[data-id]')].map((r) => r.dataset.id),
  unplaced: (document.querySelector('.explorer-mapbelow__unplaced summary') || {}).textContent || '',
  partial: !!document.querySelector('.explorer-mapbelow__unplaced .explorer-mapbelow__note'),
  sources: (document.querySelector('.explorer-mapbelow__sources') || {}).textContent || '',
}));

try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
  const tiles = [];
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('https://maps.geoapify.com/')) {
      tiles.push(url);
      request.respond({ status: 200, contentType: 'image/png', body: PNG });
      return;
    }
    if (!url.startsWith(`http://127.0.0.1:${port}/`)) { request.abort(); return; }
    request.continue();
  });
  await page.setViewport({ width: 390, height: 844 });
  await setup(page, true);

  const listFirst = await page.evaluate(() => ({
    list: !document.getElementById('explorer-list').hidden,
    map: document.getElementById('explorer-mapview').hidden,
    asked: window.__log.some((p) => p.indexOf('explore/map') !== -1),
  }));
  check('List is the default and the map is not loaded until asked', listFirst.list && listFirst.map && !listFirst.asked);

  await page.click('.explorer-mode__btn[data-mode="map"]');
  await page.waitForFunction(() => document.querySelector('.explorer-mapbelow__title'));
  await new Promise((r) => setTimeout(r, 300));
  const first = { pins: await pins(page), below: await below(page) };
  const pinned = first.pins.map((p) => p.ids).join(' ').split(' ').filter(Boolean).sort();
  check('every located job is on the map, framed to fit',
    JSON.stringify(pinned) === JSON.stringify(['job-abq1', 'job-abq2', 'job-gallup']), JSON.stringify(first.pins));
  check('a job with no location is not on the map', !pinned.includes('job-none'));
  check('the jobs in view are listed under the map',
    first.below.title === '3 jobs in this view' && first.below.ids.length === 3, JSON.stringify(first.below));
  check('the job with no location is counted, not guessed',
    first.below.unplaced === '1 job has no location that could be found and is not on the map', first.below.unplaced);
  check('its typed address was looked up, and a town-only answer was refused',
    (await page.evaluate(() => window.__geocodeAsked)).join() === '10 Oak Street');
  check('the map says where its pins came from',
    first.below.sources === 'Placed 3 from the picked address.', first.below.sources);
  check('tiles come from Geoapify with the configured key',
    tiles.length > 0 && tiles.every((u) => /maps\.geoapify\.com\/v1\/tile\/osm-bright\/\d+\/\d+\/\d+(@2x)?\.png\?apiKey=c77231dd/.test(u)),
    tiles[0] || 'none');
  check('the map credits Geoapify and OpenStreetMap',
    await page.evaluate(() => /Geoapify/.test(document.querySelector('.explorer-map__credit').textContent) &&
      /OpenStreetMap/.test(document.querySelector('.explorer-map__credit').textContent)));
  check('nothing scrolls sideways on a phone',
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await page.screenshot({ path: join(shotDir, 'file-explorer-map-phone.png'), fullPage: true });

  // The year filter narrows by the filing date.
  await page.click('.explorer-mapyears__chip[data-year="2025"]');
  await new Promise((r) => setTimeout(r, 300));
  const y2025 = { pins: await pins(page), below: await below(page) };
  check('the year filter keeps only that year\'s jobs',
    y2025.pins.map((p) => p.ids).join(' ') === 'job-abq2' && y2025.below.ids.join() === 'job-abq2', JSON.stringify(y2025));
  const chips = await page.evaluate(() => [...document.querySelectorAll('.explorer-mapyears__chip')].map((c) => c.textContent));
  check('the years offered are the ones the jobs were filed in, newest first',
    JSON.stringify(chips) === JSON.stringify(['All years', '2026', '2025']), JSON.stringify(chips));
  await page.click('.explorer-mapyears__chip[data-year="all"]');
  await new Promise((r) => setTimeout(r, 300));

  // Pan away: the list follows what is in view.
  await page.evaluate(() => {
    const view = document.querySelector('.explorer-map');
    view.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, clientX: 200, clientY: 300, bubbles: true }));
    view.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 200 + 4000, clientY: 300, bubbles: true }));
    view.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: 200 + 4000, clientY: 300, bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  const away = await below(page);
  check('panning away from the jobs lists none in view', away.title === '0 jobs in this view', away.title);

  // Back, then zoom in on Albuquerque until Gallup leaves the view.
  await page.evaluate(() => {
    const view = document.querySelector('.explorer-map');
    view.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, clientX: 4200, clientY: 300, bubbles: true }));
    view.dispatchEvent(new PointerEvent('pointermove', { pointerId: 8, clientX: 200, clientY: 300, bubbles: true }));
    view.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8, clientX: 200, clientY: 300, bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  for (let i = 0; i < 6; i += 1) {
    const ids = await page.evaluate(() => [...document.querySelectorAll('#explorer-mapbelow > .explorer-row[data-id]')].map((r) => r.dataset.id));
    if (!ids.includes('job-gallup')) break;
    await page.evaluate(() => {
      const map = document.querySelector('.explorer-map');
      const box = map.getBoundingClientRect();
      const pin = [...document.querySelectorAll('.explorer-map__pin')].find((p) => /job-abq/.test(p.dataset.ids));
      const at = pin.getBoundingClientRect();
      map.dispatchEvent(new MouseEvent('dblclick', { clientX: at.left + at.width / 2, clientY: at.top + at.height / 2, bubbles: true }));
      void box;
    });
    await new Promise((r) => setTimeout(r, 250));
  }
  const zoomed = await below(page);
  check('zooming in on an area lists only the jobs in it',
    zoomed.ids.length >= 1 && zoomed.ids.every((id) => /job-abq/.test(id)), JSON.stringify(zoomed));

  // A cluster that cannot part (zoomed out) opens to its jobs.
  await page.evaluate(() => { for (let i = 0; i < 20; i += 1) document.querySelector('.explorer-map__zoom button:last-child').click(); });
  await new Promise((r) => setTimeout(r, 300));
  const many = await page.evaluate(() => {
    const pin = document.querySelector('.explorer-map__pin--many');
    return pin ? pin.textContent : '';
  });
  check('far out, nearby jobs gather into one numbered pin', many === '3' || many === '2', many);

  // Search narrows the map too.
  await page.evaluate(() => {
    const input = document.getElementById('explorer-search');
    input.value = 'gallup';
    input.dispatchEvent(new Event('input'));
  });
  await new Promise((r) => setTimeout(r, 300));
  const searched = await pins(page);
  check('the search box narrows the map', searched.length === 1 && searched[0].ids === 'job-gallup', JSON.stringify(searched));
  check('the map only reads', await page.evaluate(() => window.__log.every((p) => p.startsWith('GET '))));

  // Desktop: the map sits in the middle pane with the tree beside it.
  await page.setViewport({ width: 1280, height: 860 });
  await page.evaluate(() => {
    const input = document.getElementById('explorer-search');
    input.value = '';
    input.dispatchEvent(new Event('input'));
  });
  await new Promise((r) => setTimeout(r, 400));
  const desk = await page.evaluate(() => {
    const map = document.querySelector('.explorer-map').getBoundingClientRect();
    const tree = document.getElementById('explorer-tree').getBoundingClientRect();
    return { mapW: map.width, overlap: map.left < tree.right, treeShown: !document.getElementById('explorer-tree').hidden };
  });
  check('on a desktop the map sits beside the tree, not under it', desk.treeShown && !desk.overlap && desk.mapW > 500, JSON.stringify(desk));
  await page.screenshot({ path: join(shotDir, 'file-explorer-map-desktop.png'), fullPage: true });

  // An older Worker without the map route: the listing's coordinates only, said so.
  const old = await browser.newPage();
  await old.setRequestInterception(true);
  old.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('https://maps.geoapify.com/')) { request.respond({ status: 200, contentType: 'image/png', body: PNG }); return; }
    if (!url.startsWith(`http://127.0.0.1:${port}/`)) { request.abort(); return; }
    request.continue();
  });
  await old.setViewport({ width: 390, height: 844 });
  await setup(old, false);
  // The first page's refused town-only answer is kept for this address;
  // start this one clean.
  await old.evaluate(() => {
    Object.keys(localStorage).filter((k) => k.indexOf('toolboxAddressLookup:') === 0).forEach((k) => localStorage.removeItem(k));
    window.__geocodeHouse = true;
  });
  await old.click('.explorer-mode__btn[data-mode="map"]');
  await old.waitForFunction(() => document.querySelectorAll('.explorer-map__pin').length > 0 &&
    /looked up/.test((document.querySelector('.explorer-mapbelow__sources') || {}).textContent || ''));
  await new Promise((r) => setTimeout(r, 300));
  await old.evaluate(() => { for (let i = 0; i < 12; i += 1) document.querySelector('.explorer-map__zoom button:last-child').click(); });
  await new Promise((r) => setTimeout(r, 300));
  const oldPins = await pins(old);
  const oldBelow = await below(old);
  const placed = oldPins.map((p) => p.ids).join(' ').split(' ').filter(Boolean).sort();
  check('without the map route, the browser places every job in the same order',
    JSON.stringify(placed) === JSON.stringify(['job-abq1', 'job-abq2', 'job-gallup', 'job-none']), JSON.stringify(oldPins));
  check('picked address, then base point, then the typed address looked up',
    oldBelow.sources === 'Placed 2 from the picked address, 1 from the base point GPS, 1 looked up from the typed address.',
    oldBelow.sources);
  check('nothing is left unplaced when all three found it', oldBelow.unplaced === '', oldBelow.unplaced);
  check('a job placed by its address or base point is not looked up',
    (await old.evaluate(() => window.__geocodeAsked)).join() === '10 Oak Street');
  check('the lookup is kept on this device, not written to the job',
    await old.evaluate(() => Object.keys(localStorage).some((k) => k.indexOf('toolboxAddressLookup:v1:10 oak street') === 0) &&
      window.__log.every((p) => p.startsWith('GET '))));

  // It opens on New Mexico (Tim, Oct 29, 2026), and widens only for a job
  // that lies outside the state.
  const home = await old.evaluate(() => {
    const host = document.createElement('div');
    host.style.cssText = 'width:366px;height:520px;position:fixed;left:0;top:0';
    document.body.appendChild(host);
    const map = window.ToolboxExplorerMap.create(host, {});
    map.setJobs([], true);
    const empty = map.view();
    map.setJobs([{ id: 'abq', lat: 35.1, lon: -106.6 }], true);
    const inState = map.view();
    map.setJobs([{ id: 'abq', lat: 35.1, lon: -106.6 }, { id: 'phoenix', lat: 33.45, lon: -112.07 }], true);
    const wider = map.view();
    const seesPhoenix = map.jobsInView().some((j) => j.id === 'phoenix');
    map.destroy();
    host.remove();
    return { empty, inState, wider, seesPhoenix };
  });
  const inNM = (v) => v.center.lat > 31.3 && v.center.lat < 37 && v.center.lon > -109.1 && v.center.lon < -103;
  check('with no jobs placed, the map opens on New Mexico', inNM(home.empty) && home.empty.zoom === 6, JSON.stringify(home.empty));
  check('a job in the state does not zoom the map away from the state',
    home.inState.zoom === home.empty.zoom && Math.abs(home.inState.center.lat - home.empty.center.lat) < 0.01, JSON.stringify(home.inState));
  check('a job outside the state widens the view to include it',
    home.wider.zoom < home.empty.zoom && home.seesPhoenix, JSON.stringify(home.wider));

  // buildIndex carries the place, and only a real one.
  const built = await old.evaluate(() => {
    const B = window.ToolboxSync.buildIndex;
    const base = { id: 'x', firstName: 'A', propertyAddress: '1 Main' };
    return {
      real: B(Object.assign({}, base, { propertyAddressLat: 35.1, propertyAddressLon: -106.5 })),
      none: B(Object.assign({}, base, { propertyAddressLat: null, propertyAddressLon: null })),
      zero: B(Object.assign({}, base, { propertyAddressLat: 0, propertyAddressLon: 0 })),
      text: B(Object.assign({}, base, { propertyAddressLat: '35', propertyAddressLon: '-106' })),
    };
  });
  check('buildIndex carries the property coordinates',
    built.real.propertyAddressLat === 35.1 && built.real.propertyAddressLon === -106.5);
  check('buildIndex leaves out a missing, zero or text place',
    !('propertyAddressLat' in built.none) && !('propertyAddressLat' in built.zero) && !('propertyAddressLat' in built.text));
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((row) => !row.ok);
if (failed.length) {
  console.error(`\n${failed.length} failed`);
  process.exit(1);
}
console.log(`\n${results.length} passed`);
