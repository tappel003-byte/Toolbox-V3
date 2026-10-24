/**
 * Warm Distress cache must open while the origin accepts TCP but never
 * answers (phone-hotspot / airplane). Before GPT-020 this waited the full
 * ~3s navigate timeout; after, cached open stays well under that.
 * Run: node tests/distress-startup-hang.mjs
 */
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import net from 'net';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.webmanifest')) return 'application/manifest+json';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

async function main() {
  const port = await freePort();
  const host = 'toolbox-offline.test';
  let hangSurvey = false;
  let hungCount = 0;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';

    if (hangSurvey && pathname === '/distress-survey/survey.html') {
      hungCount += 1;
      // Accept the socket and never answer — matches dead-link / bad hotspot.
      return;
    }

    const filePath = path.join(ROOT, pathname.slice(1));
    if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('missing');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    fs.createReadStream(filePath).pipe(res);
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/usr/bin/google-chrome-stable',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      `--host-resolver-rules=MAP ${host} 127.0.0.1`,
      `--unsafely-treat-insecure-origin-as-secure=http://${host}:${port}`,
    ],
  });
  const page = await browser.newPage();
  // Block CDN so export libs cannot mask SW timing.
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.url().startsWith('https://cdn.jsdelivr.net/')) request.abort();
    else request.continue();
  });

  const base = `http://${host}:${port}/index.html`;
  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload({ waitUntil: 'networkidle0' });

  await page.evaluate(async () => {
    const planCanvas = document.createElement('canvas');
    planCanvas.width = 200;
    planCanvas.height = 150;
    planCanvas.getContext('2d').fillRect(0, 0, 200, 150);
    const plan = planCanvas.toDataURL('image/png');
    await ToolboxDB.putMedia('hang-plan', plan);
    const record = ToolboxApp.blankCustomerFile('hang-distress');
    ToolboxPlanSetup.ensurePlanSetup(record);
    record.propertyAddress = 'Hang Lane';
    const canvas = record.planSetup.canvases[0];
    canvas.plan = { id: 'hang-plan', width: 200, height: 150 };
    record.distress.activeCanvasId = canvas.id;
    record.distress.pins = [{
      id: 'p1', num: 1, x: 40, y: 40, photos: [], description: 'a',
      location: '', category: null, extPhotoCount: 0, isExterior: false, canvasId: canvas.id,
    }];
    record.distress.nextNum = 2;
    await ToolboxDB.saveCustomerFile(record);
  });

  // Warm path once while network answers.
  await page.goto(`${base}#/file/hang-distress`, { waitUntil: 'domcontentloaded' });
  await page.click('[data-app="distress"]');
  await page.waitForFunction(() => {
    const doc = document.querySelector('iframe')?.contentDocument;
    return !!(doc && doc.querySelector('#screenWork.active'));
  }, { timeout: 30000 });
  console.log('warm open ok; distress cached');

  await page.goto(`${base}#/file/hang-distress`, { waitUntil: 'domcontentloaded' });

  hangSurvey = true;
  const t0 = Date.now();
  await page.click('[data-app="distress"]');
  await page.waitForFunction(() => {
    const doc = document.querySelector('iframe')?.contentDocument;
    return !!(doc && doc.querySelector('#screenWork.active'));
  }, { timeout: 30000 });
  const ms = Date.now() - t0;
  console.log(JSON.stringify({ hangOpenMs: ms, hungCount }));

  await browser.close();
  server.close();
  // After GPT-020: warm Distress cache must open without awaiting the hung network.
  if (ms >= 1500) {
    console.error('EXPECTED cached Distress open well under the old 3s navigate timeout; got', ms);
    process.exit(2);
  }
  if (hungCount < 1) {
    console.error('EXPECTED the hung origin to still receive a background/navigation attempt');
  }
  console.log('PASS: hung origin opens cached Distress without the ~3s navigate wait');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
