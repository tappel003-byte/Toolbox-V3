/**
 * Static publish set for the toolbox-v3 Worker.
 * Run: node tests/pwa-publish.mjs
 * Serves only the generated directory. No Cloudflare account.
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { publishFileSet, writePublish } from '../scripts/publish-pwa.mjs';

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

const entries = publishFileSet();
const again = publishFileSet();
check(
  'Publish set is deterministic',
  JSON.stringify(entries) === JSON.stringify(again) && entries.length === 36,
  String(entries.length),
);
const sources = entries.map(([, source]) => source);
check('Publish set excludes the sync Worker, tests, and docs', !sources.some((source) => /^(sync-worker|tests|docs|floor-survey|scripts)\//.test(source) || source.endsWith('.map') || source.endsWith('.md')));
check(
  'Apple touch icon is the Distress Survey file',
  entries.some(([url, source]) => url === '/icon-192.png' && source === 'distress-survey/icon-192.png'),
);

const outA = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-a-'));
const outB = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-b-'));
writePublish(outA);
writePublish(outB);
function filesOf(dir) {
  const found = [];
  const walk = (current) => {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else found.push(path.relative(dir, full));
    }
  };
  walk(dir);
  return found.sort();
}
const listA = filesOf(outA);
const listB = filesOf(outB);
check('Two publishes write the same paths', JSON.stringify(listA) === JSON.stringify(listB), String(listA.length));
check('Published tree has no internal files', !listA.some((rel) => rel.startsWith('sync-worker') || rel.startsWith('tests') || rel.endsWith('.md') || rel.endsWith('.map')));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: outA,
  stdio: 'ignore',
});
await new Promise((resolve) => setTimeout(resolve, 300));
const base = `http://127.0.0.1:${port}`;

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
try {
  const page = await browser.newPage();
  const required = ['/', '/sw.js', '/js/app.js', '/distress-survey/survey.html', '/icon-192.png', '/icons/icon-192.png', '/manifest.webmanifest'];
  for (const urlPath of required) {
    const response = await fetch(base + urlPath);
    check('serves ' + urlPath, response.status === 200, String(response.status));
  }
  const forbidden = ['/sync-worker/src/index.js', '/sync-worker/wrangler.toml', '/VISION.md', '/tests/customer-file-trash.mjs', '/js/distress.js', '/AGENTS.md'];
  for (const urlPath of forbidden) {
    const response = await fetch(base + urlPath);
    check('rejects ' + urlPath, response.status === 404, String(response.status));
  }

  await page.goto(base + '/', { waitUntil: 'networkidle0' });
  const heading = await page.evaluate(() => document.querySelector('h1')?.textContent || '');
  check('online home is Customer Files', heading === 'Customer Files', heading);
  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    const cache = await caches.open(keys[0]);
    const cached = (await cache.keys()).map((request) => new URL(request.url).pathname);
    return {
      scope: ready.scope,
      script: ready.active && ready.active.scriptURL,
      cacheName: keys[0],
      hasIndex: cached.includes('/index.html'),
      hasSurvey: cached.includes('/distress-survey/survey.html'),
      count: cached.length,
    };
  });
  check('service worker scope is the site root', registration.scope === base + '/', registration.scope);
  check('service worker script is /sw.js', registration.script === base + '/sw.js', registration.script);
  check('offline shell cached both documents', registration.hasIndex && registration.hasSurvey && registration.cacheName === 'toolbox-shell-v92', JSON.stringify(registration));

  await page.setOfflineMode(true);
  await page.goto(base + '/#/cabinet', { waitUntil: 'domcontentloaded' });
  const offlineCabinet = await page.evaluate(() => document.querySelector('h1')?.textContent || '');
  check('offline File Cabinet route renders', offlineCabinet === 'File Cabinet', offlineCabinet);
  await page.goto(base + '/distress-survey/survey.html', { waitUntil: 'domcontentloaded' });
  const offlineTitle = await page.evaluate(() => document.title);
  check('offline Distress document renders', /Distress Survey/.test(offlineTitle), offlineTitle);
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
