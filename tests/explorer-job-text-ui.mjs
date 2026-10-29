/**
 * File Explorer searches the words inside the jobs and says where each hit
 * came from; inside a job, the job text opens and downloads. Synthetic
 * server, no production Customer Files.
 * Run: node tests/explorer-job-text-ui.mjs
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

const JOB_TEXT = 'Toolbox job text — Rhonda Sorenson\nBuilt from the stored job for searching.\n\n== Customer ==\nName: Rhonda Sorenson\n\n== Field observation · Distress pins ==\nPin 4 · Main Level · Hall: Half inch drywall crack over the door [2 photographs]\n';

try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.ToolboxSync && window.ToolboxFileExplorer);

  const root = await page.evaluate(async (jobText) => {
    const base = 'http://mock-sync.local';
    window.ToolboxConfig.syncApiBase = base;
    window.__log = [];
    window.__picked = [];
    window.showSaveFilePicker = async function (options) {
      const entry = { name: options.suggestedName, chunks: [] };
      window.__picked.push(entry);
      return { name: entry.name, createWritable: async () => new WritableStream({ write(c) { entry.chunks.push(c); } }) };
    };
    const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    window.fetch = async function (url, opts) {
      const path = String(url).slice(base.length).replace(/^\//, '');
      window.__log.push(((opts && opts.method) || 'GET') + ' ' + path);
      if (path === 'explore/files') {
        return json({ files: [
          { key: 'cf/job-s/index.json', id: 'job-s', displayName: 'Rhonda Sorenson', propertyAddress: '4925 Edwards Dr NE', fieldWorkDate: '2026-10-07' },
          { key: 'cf/job-y/index.json', id: 'job-y', displayName: 'Marcus Yazzie', fieldWorkDate: '2026-10-02' },
        ] });
      }
      if (path.startsWith('explore/search?q=')) {
        const q = decodeURIComponent(path.slice('explore/search?q='.length));
        return json({
          query: q, words: q.toLowerCase().split(/\s+/), searched: 2, total: 3, notYetRead: 1, built: 2,
          incomplete: [{ id: 'job-y', displayName: 'Marcus Yazzie', components: ['distress'] }],
          results: [{
            id: 'job-s', displayName: 'Rhonda Sorenson', propertyAddress: '4925 Edwards Dr NE', fieldWorkDate: '2026-10-07',
            hits: [
              { section: 'Field observation · Distress pins', text: 'Pin 4 · Main Level · Hall: Half inch drywall crack over the door <b>', all: true },
              { section: 'Conclusion · Report discussion', text: 'The drywall crack is consistent with settlement.', all: false },
            ],
          }],
        });
      }
      if (path === 'explore/files/job-s') {
        return json({ id: 'job-s', displayName: 'Rhonda Sorenson', referenceNotes: [], objects: [
          { key: 'cf/job-s/index.json', contentType: 'application/json', purpose: 'technical', label: 'Cabinet index' },
          { key: 'cf/job-s/customer.json', contentType: 'application/json', purpose: 'customer', label: 'Customer information' },
          { key: 'cf/job-s/search.txt', contentType: 'text/plain', purpose: 'job-text', label: 'Job text' },
        ] });
      }
      if (path === 'explore/files/job-s/text') return new Response(jobText, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
      if (path.startsWith('explore/files/job-s/object?key=')) return json({ firstName: 'Rhonda' });
      return new Response('Not found', { status: 404 });
    };
    window.location.hash = '#/explore';
    const wait = async (test) => {
      for (let i = 0; i < 200; i += 1) { if (test()) return true; await new Promise((r) => setTimeout(r, 25)); }
      return false;
    };
    await wait(() => document.querySelectorAll('.explorer-row[data-id]').length === 2);
    const input = document.getElementById('explorer-search');
    input.value = 'ha';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 800));
    const shortAsked = window.__log.some((p) => p.indexOf('explore/search') !== -1);
    input.value = 'half inch drywall crack';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await wait(() => document.querySelector('.explorer-hit'));
    const panel = document.getElementById('explorer-textsearch');
    const hit = document.querySelector('.explorer-hit');
    return {
      shortAsked,
      searches: window.__log.filter((p) => p.indexOf('explore/search') !== -1).length,
      listEmpty: document.getElementById('explorer-list').innerText,
      status: panel.querySelector('.explorer-textsearch__status').textContent,
      notYet: panel.innerText.includes('1 job has not been read into the search yet'),
      partial: (panel.querySelector('.explorer-textsearch__partial') || {}).textContent || '',
      from: [...hit.querySelectorAll('.explorer-hit__from')].map((el) => el.textContent),
      marks: [...hit.querySelectorAll('mark')].map((el) => el.textContent.toLowerCase()),
      injected: !!hit.querySelector('b'),
      name: hit.querySelector('.explorer-row__key').textContent,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  }, JOB_TEXT);

  check('a short query does not search the server', !root.shortAsked);
  check('the words are searched once, not once per keystroke', root.searches === 1, String(root.searches));
  check('the card list says no card matches', /No Customer Files match/.test(root.listEmpty));
  check('the text search says how many jobs it read',
    root.status === '1 job says this · searched 2 of 3.', root.status);
  check('jobs not yet read are said, not hidden', root.notYet);
  check('a job only partly read is named, with what could not be read',
    root.partial === '1 job could only be partly read: Marcus Yazzie (distress). They are read again on the next search.',
    root.partial);
  check('each hit says whether it is an observation or a conclusion',
    JSON.stringify(root.from) === JSON.stringify(['Field observation · Distress pins', 'Conclusion · Report discussion']),
    JSON.stringify(root.from));
  check('the searched words are marked', ['half', 'inch', 'drywall', 'crack'].every((w) => root.marks.includes(w)),
    JSON.stringify(root.marks));
  check('stored text is shown as text, never as markup', !root.injected);
  check('nothing scrolls sideways on a phone', !root.overflow);
  await page.screenshot({ path: join(shotDir, 'file-explorer-text-search-phone.png'), fullPage: true });

  const inside = await page.evaluate(async () => {
    document.querySelector('.explorer-hit .explorer-row__key').click();
    const wait = async (test) => {
      for (let i = 0; i < 200; i += 1) { if (test()) return true; await new Promise((r) => setTimeout(r, 25)); }
      return false;
    };
    await wait(() => document.querySelector('.explorer-row--text'));
    const row = document.querySelector('.explorer-row--text');
    const otherFolder = !!document.querySelector('.explorer-folder[data-group="other"]');
    [...row.querySelectorAll('button')].find((b) => b.textContent === 'Open').click();
    await wait(() => document.querySelector('#explorer-preview .explorer-preview__text'));
    const shown = document.querySelector('#explorer-preview .explorer-preview__text').textContent;
    const download = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Download');
    download.click();
    await wait(() => window.__picked.length && !download.disabled);
    const entry = window.__picked[0];
    const saved = entry ? await new Blob(entry.chunks).text() : '';
    return {
      hash: window.location.hash,
      otherFolder,
      shown,
      name: entry && entry.name,
      saved,
      writes: window.__log.filter((p) => !p.startsWith('GET ')),
    };
  });
  check('a hit opens its job', inside.hash === '#/explore/job-s');
  check('the stored job text is not listed as a loose file', !inside.otherFolder);
  check('Open shows the job text', inside.shown.includes('== Field observation · Distress pins =='));
  check('Download saves it as a named text file',
    inside.name === 'rhonda-sorenson-job-text.txt' && inside.saved.includes('Half inch drywall crack'),
    inside.name);
  check('nothing was written', inside.writes.length === 0, JSON.stringify(inside.writes));
  await page.screenshot({ path: join(shotDir, 'file-explorer-job-text-phone.png'), fullPage: true });
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
