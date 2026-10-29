/**
 * File Explorer draws tiles from the server's small copy, and from the
 * original only when there is no small copy. Synthetic server, no production
 * Customer Files.
 * Run: node tests/explorer-thumbnails-ui.mjs
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

const ID = '11111111-1111-4111-8111-111111111111';
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US'],
});

try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.ToolboxSync && window.ToolboxFileExplorer);

  const flow = await page.evaluate(async (fixture) => {
    const base = 'http://mock-sync.local';
    window.ToolboxConfig.syncApiBase = base;
    const png = Uint8Array.from(atob(fixture.png), (c) => c.charCodeAt(0));
    const log = [];
    const objects = [
      { key: `cf/${fixture.id}/index.json`, contentType: 'application/json', purpose: 'technical', label: 'Cabinet index' },
      { key: 'media/ph_small', contentType: 'image/jpeg', purpose: 'distress-photo', label: 'Distress Survey photograph' },
      { key: 'media/ph_oldworker', contentType: 'image/jpeg', purpose: 'distress-photo', label: 'Distress Survey photograph' },
    ];
    window.fetch = async function (url, opts) {
      const href = String(url);
      const path = href.slice(base.length).replace(/^\//, '');
      log.push(path);
      const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
      if (path === 'explore/files') {
        return json({ files: [{ key: `cf/${fixture.id}/index.json`, id: fixture.id, displayName: 'Ada Mitchell' }] });
      }
      if (path === `explore/files/${fixture.id}`) {
        return json({ id: fixture.id, displayName: 'Ada Mitchell', objects, referenceNotes: [] });
      }
      if (path.startsWith('explore/thumbs/ph_small')) {
        return new Response(png, { headers: { 'content-type': 'image/jpeg', 'x-toolbox-thumb': 'resized' } });
      }
      // A Worker that predates the route answers every unknown path this way.
      if (path.startsWith('explore/thumbs/')) return new Response('Not found', { status: 404 });
      const object = /^explore\/files\/[^/]+\/object\?key=(.+)$/.exec(path);
      if (object) {
        const key = decodeURIComponent(object[1]);
        if (key.startsWith('media/')) return new Response(png, { headers: { 'content-type': 'image/png' } });
        return new Response('Not stored', { status: 404 });
      }
      return new Response('Not found', { status: 404 });
    };
    window.location.hash = `#/explore/${fixture.id}`;
    const wait = async (test) => {
      for (let i = 0; i < 100; i += 1) {
        if (test()) return true;
        await new Promise((r) => setTimeout(r, 50));
      }
      return false;
    };
    await wait(() => document.querySelector('.explorer-folder[data-group="distress"] .explorer-folder__open'));
    document.querySelector('.explorer-folder[data-group="distress"] .explorer-folder__open').click();
    const loaded = await wait(() => document.querySelectorAll('.explorer-tile.is-loaded').length === 2);
    return {
      loaded,
      failed: document.querySelectorAll('.explorer-tile.is-failed').length,
      log,
    };
  }, { id: ID, png: PNG_B64 });

  const asked = (fragment) => flow.log.filter((path) => path.indexOf(fragment) !== -1).length;
  check('both tiles are drawn', flow.loaded && flow.failed === 0, JSON.stringify(flow.log));
  check('a tile asks for the small copy first', asked('explore/thumbs/ph_small') === 1);
  check('a tile with a small copy never fetches the original',
    asked('key=' + encodeURIComponent('media/ph_small')) === 0);
  check('a tile whose Worker has no small copy falls back to the original',
    asked('explore/thumbs/ph_oldworker') === 1 && asked('key=' + encodeURIComponent('media/ph_oldworker')) === 1);
  check('the tile asks for a 320 pixel edge', flow.log.some((path) => /thumbs\/ph_small\?w=320$/.test(path)));
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
