/**
 * Distress iframe offline navigation + native persistence.
 * Run: node tests/distress-survey-offline.mjs
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import net from 'net';

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

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(port) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/index.html`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start.');
}

function startServer(port) {
  return spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
    cwd: process.cwd(),
    stdio: 'ignore',
  });
}

async function stopServer(server) {
  if (!server || server.exitCode != null) return;
  server.kill('SIGTERM');
  await new Promise((resolve) => {
    server.once('exit', resolve);
    setTimeout(resolve, 2000);
  });
}

const port = await freePort();
const host = 'toolbox-offline.test';
const base = `http://${host}:${port}/index.html`;
let server = startServer(port);
await waitForServer(port);

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--no-proxy-server',
    `--host-resolver-rules=MAP ${host} 127.0.0.1`,
    `--unsafely-treat-insecure-origin-as-secure=http://${host}:${port}`,
  ],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));

try {
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload({ waitUntil: 'networkidle0' });

  const cacheState = await page.evaluate(async () => {
    const names = await caches.keys();
    const cache = await caches.open(names.find((name) => name.startsWith('toolbox-shell-')));
    return {
      names,
      distressCached: !!(await cache.match('/distress-survey/survey.html')),
      queryMatchesExactly: !!(await cache.match('/distress-survey/survey.html?cf=test')),
    };
  });
  check('Offline shell contains canonical Distress document', cacheState.distressCached, JSON.stringify(cacheState));
  check('Query-bearing Distress URL requires explicit fallback', !cacheState.queryMatchesExactly, JSON.stringify(cacheState));

  await page.evaluate(async () => {
    const planCanvas = document.createElement('canvas');
    planCanvas.width = 400;
    planCanvas.height = 300;
    const context = planCanvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 400, 300);
    context.strokeStyle = '#082036';
    context.lineWidth = 4;
    context.strokeRect(20, 20, 360, 260);
    const plan = planCanvas.toDataURL('image/png');
    const photoCanvas = document.createElement('canvas');
    photoCanvas.width = 20;
    photoCanvas.height = 20;
    const photoContext = photoCanvas.getContext('2d');
    photoContext.fillStyle = '#c14a2b';
    photoContext.fillRect(0, 0, 20, 20);
    const photo = photoCanvas.toDataURL('image/jpeg');

    await ToolboxDB.putMedia('offline-plan', plan);
    const photoDb = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pgg_photos_v1', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('photos')) request.result.createObjectStore('photos');
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve, reject) => {
      const tx = photoDb.transaction('photos', 'readwrite');
      tx.objectStore('photos').put(photo, 'ph_offline_existing');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    photoDb.close();

    const record = ToolboxApp.blankCustomerFile('offline-distress');
    ToolboxPlanSetup.ensurePlanSetup(record);
    record.firstName = 'Offline';
    record.lastName = 'Distress';
    record.propertyAddress = '100 Offline Lane';
    const canvas = record.planSetup.canvases[0];
    canvas.name = 'Main Level';
    canvas.plan = { id: 'offline-plan', width: 400, height: 300 };
    record.distress.activeCanvasId = canvas.id;
    record.distress.pins = [{
      id: 'pin-existing',
      num: 1,
      x: 100,
      y: 90,
      photos: ['ph_offline_existing'],
      description: 'Existing offline observation',
      location: 'Living Room',
      category: null,
      extPhotoCount: 0,
      isExterior: false,
      canvasId: canvas.id,
    }];
    record.distress.nextNum = 2;
    await ToolboxDB.saveCustomerFile(record);
  });

  await page.goto(`${base}#/file/offline-distress`, { waitUntil: 'networkidle0' });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().startsWith('https://cdn.jsdelivr.net/')) request.abort();
    else request.continue();
  });
  await stopServer(server);
  server = null;

  await page.click('[data-app="distress"]');
  await page.waitForFunction(() => {
    const frame = document.querySelector('iframe');
    return frame?.contentDocument?.title === 'Distress Survey – Field Reporter' &&
      frame.contentDocument.querySelector('#screenWork.active');
  }, { timeout: 15000 });

  let frame = page.frames().find((item) => /distress-survey\/survey\.html/.test(item.url()));
  const launch = await frame.evaluate(() => ({
    title: document.title,
    work: !!document.querySelector('#screenWork.active'),
    plan: document.querySelector('#planSvg image')?.getAttribute('href') || '',
    pins: document.querySelectorAll('#gPins .pin').length,
  }));
  check('Offline iframe receives Distress document, never Toolbox index', launch.title === 'Distress Survey – Field Reporter' && launch.work, JSON.stringify(launch));
  check('Offline launch restores plan and existing pin', /^data:image\//.test(launch.plan) && launch.pins === 1, JSON.stringify(launch));

  const existingPin = await frame.$('#gPins .pin .pin-bg');
  await existingPin.click();
  await frame.waitForSelector('#pinSheet.open');
  const photoAvailable = await frame.evaluate(async () => {
    const image = document.querySelector('.photo-thumb img');
    if (!image) return false;
    if (image.complete && image.naturalWidth > 0) return true;
    return await new Promise((resolve) => {
      image.addEventListener('load', () => resolve(true), { once: true });
      image.addEventListener('error', () => resolve(false), { once: true });
      setTimeout(() => resolve(false), 3000);
    });
  });
  check('Previously stored attached photo remains available offline', photoAvailable);
  await frame.click('#pinSheet .ghost');

  async function tapPlan(nx, ny) {
    frame = page.frames().find((item) => /distress-survey\/survey\.html/.test(item.url()));
    const stageBox = await frame.evaluate(() => {
      const rect = document.getElementById('stage').getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const iframeBox = await page.$eval('iframe', (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y };
    });
    await page.mouse.click(
      iframeBox.x + stageBox.x + stageBox.width * nx,
      iframeBox.y + stageBox.y + stageBox.height * ny,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  await tapPlan(0.72, 0.68);
  await frame.waitForSelector('#pinSheet.open');
  await frame.evaluate(() => {
    const description = document.getElementById('pinDesc');
    description.value = 'Added and edited offline';
    description.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise((resolve) => setTimeout(resolve, 700));
  await frame.click('#pinSheet .ghost');

  const offlineSaved = await page.evaluate(async () => {
    const record = await ToolboxDB.getCustomerFile('offline-distress');
    return {
      pins: record.distress.pins.length,
      descriptions: record.distress.pins.map((pin) => pin.description),
      nextNum: record.distress.nextNum,
    };
  });
  check('New observation and edit persist while origin is unavailable', offlineSaved.pins === 2 && offlineSaved.descriptions.includes('Added and edited offline') && offlineSaved.nextNum === 3, JSON.stringify(offlineSaved));

  await frame.evaluate(() => document.querySelector('#screenWork .back-btn')?.click());
  await page.waitForFunction(() => location.hash === '#/file/offline-distress' && !document.querySelector('iframe'));
  await page.click('[data-app="distress"]');
  await page.waitForFunction(() => {
    const child = document.querySelector('iframe');
    return child?.contentDocument?.title === 'Distress Survey – Field Reporter' &&
      child.contentDocument.querySelectorAll('#gPins .pin').length === 2;
  }, { timeout: 15000 });
  check('Distress reopens offline with offline changes intact', true);

  server = startServer(port);
  await waitForServer(port);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const reconnected = await page.evaluate(async () => {
    const child = document.querySelector('iframe');
    const record = await ToolboxDB.getCustomerFile('offline-distress');
    return {
      title: child?.contentDocument?.title,
      work: !!child?.contentDocument?.querySelector('#screenWork.active'),
      pins: record.distress.pins.length,
      edited: record.distress.pins.some((pin) => pin.description === 'Added and edited offline'),
    };
  });
  check('Restoring connectivity requires no PWA restart and loses no data', reconnected.title === 'Distress Survey – Field Reporter' && reconnected.work && reconnected.pins === 2 && reconnected.edited, JSON.stringify(reconnected));
} finally {
  await browser.close();
  await stopServer(server);
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
