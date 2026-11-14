/**
 * Sandia Geo Drop Box, end to end: the real "Share files" button in Report Builder, the real dialog, the
 * real js/sync.js, and the real Worker code -- only the R2 bucket is a mock. The page's fetch is handed to
 * the Worker running in this process, so a file really travels browser -> parts -> Worker -> bucket, and
 * the public page and the download are read back out of it.
 *
 * Run: node tests/drop-box-ui.mjs
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import net from 'net';
import { join } from 'path';
import { tmpdir } from 'os';
import worker from '../sync-worker/src/index.js';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }
const JSZip = require('../js/vendor/jszip.min.js');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Access (the Worker checks a signed token, as it does in production) and the bucket ----
const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
publicJwk.kid = 'drop-ui'; publicJwk.alg = 'RS256'; publicJwk.use = 'sig';
const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
async function signJwt() {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid: 'drop-ui', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ iss: 'https://toolbox-test.cloudflareaccess.com', aud: 'aud-drop-ui', exp: now + 3000, nbf: now - 10, email: 'tim@example.com', sub: 's' })));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(header + '.' + payload));
  return header + '.' + payload + '.' + b64url(new Uint8Array(sig));
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith('/cdn-cgi/access/certs')) return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
  return realFetch(url, init);
};
const jwt = await signJwt();
const env = { CF_ACCESS_TEAM_DOMAIN: 'toolbox-test.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-drop-ui' };

const store = new Map();
const uploads = new Map();
const toBytes = (v) => (typeof v === 'string' ? new TextEncoder().encode(v) : v instanceof ArrayBuffer ? new Uint8Array(v.slice(0))
  : ArrayBuffer.isView(v) ? new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)) : new TextEncoder().encode(String(v)));
const bucket = {
  async get(key) { const r = store.get(key); if (!r) return null; return { key, size: r.bytes.byteLength, httpMetadata: r.contentType ? { contentType: r.contentType } : {},
    body: new ReadableStream({ start(c) { c.enqueue(r.bytes); c.close(); } }), async json() { return JSON.parse(new TextDecoder().decode(r.bytes)); } }; },
  async head(key) { const r = store.get(key); return r ? { key, size: r.bytes.byteLength } : null; },
  async put(key, v, o) { store.set(key, { bytes: toBytes(v), contentType: o && o.httpMetadata && o.httpMetadata.contentType }); },
  async delete(keys) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => store.delete(k)); },
  async list(o = {}) {
    const prefix = o.prefix || ''; const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
    if (o.delimiter) { const ps = new Set(); all.forEach((k) => { const rest = k.slice(prefix.length); const at = rest.indexOf(o.delimiter); if (at !== -1) ps.add(prefix + rest.slice(0, at + 1)); }); return { objects: [], delimitedPrefixes: [...ps], truncated: false }; }
    return { objects: all.map((k) => ({ key: k })), truncated: false };
  },
  async createMultipartUpload(key, o) { const id = 'u' + uploads.size; uploads.set(id, { key, parts: new Map(), ct: o && o.httpMetadata && o.httpMetadata.contentType }); return { uploadId: id, key }; },
  resumeMultipartUpload(key, id) {
    const up = uploads.get(id);
    return {
      async uploadPart(n, v) { const b = toBytes(v); const etag = 'e' + n; up.parts.set(n, { b, etag }); return { partNumber: n, etag }; },
      async complete(parts) {
        const ord = [...parts].sort((a, b) => a.partNumber - b.partNumber); const sizes = ord.map((p) => up.parts.get(p.partNumber).b.byteLength);
        sizes.slice(0, -1).forEach((s) => { if (s !== sizes[0]) throw new Error('uneven parts'); });
        const out = new Uint8Array(sizes.reduce((a, b) => a + b, 0)); let at = 0;
        ord.forEach((p) => { const b = up.parts.get(p.partNumber).b; out.set(b, at); at += b.byteLength; });
        store.set(key, { bytes: out, contentType: up.ct }); return { key, size: out.byteLength };
      },
    };
  },
};

// ---- server + browser ----
const port = await new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => resolve(p)); }); s.on('error', reject); });
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}/index.html`;
for (let i = 0; i < 100; i += 1) { try { if ((await fetch(BASE)).ok) break; } catch (_) {} await wait(100); }

const dir = join(tmpdir(), 'drop-ui-' + Date.now());
mkdirSync(dir, { recursive: true });
const pdfBytes = Buffer.alloc(18 * 1024 * 1024 + 123);
for (let i = 0; i < pdfBytes.length; i += 7) pdfBytes[i] = (i * 31) & 255;
pdfBytes.write('%PDF-1.4\n', 0);
const pdfPath = join(dir, '15 Rabbitbrush Report (final).pdf');
writeFileSync(pdfPath, pdfBytes);
const planBytes = Buffer.from('AC1027 fake dwg ' + 'x'.repeat(5000));
const planPath = join(dir, 'floor plan.dwg');
writeFileSync(planPath, planBytes);

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('dialog', async (d) => { await d.accept(); });
await page.setViewport({ width: 1440, height: 900 });

// The page's fetch to the sync host is run by the Worker in this process.
const calls = [];
let failPart = { part: 0, times: 0 };
await page.exposeFunction('__worker', async (method, path, headers, bodyB64) => {
  calls.push(method + ' ' + path.split('?')[0].replace(/[a-f0-9]{36}/, '{token}') + (path.includes('part=') ? ' ' + /part=\d+/.exec(path)[0] : ''));
  if (failPart.times > 0 && method === 'PUT' && path.includes('part=' + failPart.part)) { failPart.times -= 1; return { status: 500, headers: {}, body: '' }; }
  const h = new Headers(headers || {});
  h.set('Cf-Access-Jwt-Assertion', jwt);
  const body = bodyB64 ? Buffer.from(bodyB64, 'base64') : undefined;
  const res = await worker.fetch(new Request('https://sync.example' + path, { method, headers: h, body: method === 'GET' || method === 'HEAD' ? undefined : body }), Object.assign({ CABINET: bucket }, env));
  const buf = Buffer.from(await res.arrayBuffer());
  const out = {}; res.headers.forEach((v, k) => { out[k] = v; });
  return { status: res.status, headers: out, body: buf.toString('base64') };
});
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(() => {
  window.ToolboxConfig.syncApiBase = 'http://mock-sync.local';
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (url, init) {
    const href = String(url);
    if (!href.startsWith('http://mock-sync.local')) return realFetch(url, init);
    init = init || {};
    let b64 = '';
    if (init.body != null) {
      const buf = init.body instanceof Blob ? await init.body.arrayBuffer() : new TextEncoder().encode(String(init.body)).buffer;
      let s = ''; const u = new Uint8Array(buf); const step = 0x8000;
      for (let i = 0; i < u.length; i += step) s += String.fromCharCode.apply(null, u.subarray(i, i + step));
      b64 = btoa(s);
    }
    const headers = {}; new Headers(init.headers || {}).forEach((v, k) => { headers[k] = v; });
    const r = await window.__worker((init.method || 'GET').toUpperCase(), href.slice('http://mock-sync.local'.length), headers, b64);
    const bytes = Uint8Array.from(atob(r.body), (c) => c.charCodeAt(0));
    return new Response([204, 304].includes(r.status) ? null : bytes, { status: r.status, headers: r.headers });
  };
  // Record what a "copy" puts on the clipboard.
  document.execCommand = function (cmd) { if (cmd === 'copy') { const tas = [...document.querySelectorAll('body > textarea')]; const ta = tas[tas.length - 1]; window.__copied = ta ? ta.value : ''; return true; } return false; };
});

// ---- a job with a report (no photographs yet) ----
const FILE = 'drop-ui-1';
await page.evaluate(async (id) => {
  const c = document.createElement('canvas'); c.width = 800; c.height = 600;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 600); x.strokeStyle = '#111'; x.strokeRect(20, 20, 760, 560);
  await ToolboxDB.putMedia('plan-drop', c.toDataURL('image/jpeg', 0.9));
  const rec = ToolboxApp.blankCustomerFile(id); ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Janis'; rec.lastName = 'Fensterer'; rec.propertyAddress = '15 Rabbitbrush, Santa Fe, NM';
  const cv = rec.planSetup.canvases[0]; cv.name = 'Main Level'; cv.plan = { id: 'plan-drop', width: 800, height: 600 };
  const poly = [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 }];
  const points = [1, 2, 3, 4, 5, 6].map((n) => ({ id: 'p' + n, floorId: cv.id, index: n, x: 100 + n * 90, y: 200 + (n % 2) * 60, value: 5 + n * 0.3, createdAt: n }));
  rec.floorSurvey = { id: 'fs-' + id, inspectionDate: '2026-11-10', byCanvasId: { [cv.id]: { canvasId: cv.id, points, areas: [{ id: 'a1', name: 'Main Level', polygon: poly, createdAt: 1 }], boundary: poly } } };
  await ToolboxDB.saveCustomerFile(rec);
}, FILE);
await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await wait(1500);

check('Report Builder has a "Share files" button', !!(await page.$('#rb-share-files')));
await page.click('#rb-share-files');
await page.waitForSelector('[data-drop-box]', { timeout: 8000 });
check('Clicking it opens the Sandia Geo Drop Box dialog', await page.evaluate(() => /Sandia Geo Drop Box/.test(document.querySelector('[data-drop-box]').innerText)));
check('The dialog says it works for 14 days and the originals stay put', await page.evaluate(() => /14 days/.test(document.querySelector('[data-drop-box]').innerText) && /originals stay in the Customer File/.test(document.querySelector('[data-drop-box]').innerText)));
check('With no photographs in the report, the photo choice is off and says why', await page.evaluate(() => {
  const box = document.querySelector('[data-db-photos]'); return box.disabled && !box.checked && /no photographs/i.test(box.closest('label').innerText);
}));

// nothing chosen
await page.click('[data-db-create]');
check('Creating with nothing chosen asks for a file', await page.evaluate(() => /Choose at least one file/.test(document.querySelector('[data-db-status]').textContent)));
check('and nothing was sent', calls.length === 0);

// choose a PDF (18 MB: three parts) and one other file, with real file inputs
const pdfInput = await page.$('[data-db-pdf]');
await pdfInput.uploadFile(pdfPath);
const extraInput = await page.$('[data-db-extra]');
await extraInput.uploadFile(planPath);
await wait(300);
check('The chosen files are listed by name and size', await page.evaluate(() => /15 Rabbitbrush Report \(final\)\.pdf · 18 MB/.test(document.querySelector('[data-drop-box]').innerText) && /floor plan\.dwg/.test(document.querySelector('[data-db-picked]').innerText)));

// one part fails once: the send retries it and carries on
failPart = { part: 2, times: 1 };
await page.click('[data-db-create]');
await page.waitForSelector('[data-db-url]', { timeout: 60000 });
const url = await page.$eval('[data-db-url]', (i) => i.value);
const token = /lookbook\/([a-f0-9]{36})\//.exec(url)[1];
check('A link is made: public, under lookbook/, with the token', url === `http://mock-sync.local/lookbook/${token}/`.replace('http://mock-sync.local', 'https://sync.example'), url);
check('The PDF went up in three parts and one failed part was retried',
  calls.filter((c) => /PUT .*uploads\/[^ ]+ part=\d/.test(c)).length === 3 + 1 + 1 /* pdf 3 + 1 retry, plan 1 */ - 0 &&
  calls.filter((c) => /part=2/.test(c)).length === 2, calls.filter((c) => /PUT/.test(c)).join(' | '));
check('The call order is create, uploads, finalize', calls[0] === 'POST /lookbook' && calls[calls.length - 1] === 'POST /lookbook/{token}/finalize', calls[0] + ' … ' + calls[calls.length - 1]);

const keys = [...store.keys()].filter((k) => k.startsWith(`lookbooks/${token}/`));
const pdfKey = `lookbooks/${token}/files/15-Rabbitbrush-Report-final.pdf`;
check('Both files are stored under safe names', keys.includes(pdfKey) && keys.includes(`lookbooks/${token}/files/floor-plan.dwg`), keys.join(', '));
check('The stored PDF is byte-for-byte the file chosen', Buffer.compare(Buffer.from(store.get(pdfKey).bytes), pdfBytes) === 0);
check('The stored plan file is byte-for-byte the file chosen', Buffer.compare(Buffer.from(store.get(`lookbooks/${token}/files/floor-plan.dwg`).bytes), planBytes) === 0);

// what the client opens
const pageRes = await worker.fetch(new Request(`https://sync.example/lookbook/${token}/`), Object.assign({ CABINET: bucket }, env));
const pageHtml = await pageRes.text();
check('The client page opens with no sign-in and lists the report and the plan with sizes',
  pageRes.status === 200 && pageHtml.includes('Report (PDF)') && pageHtml.includes('floor plan.dwg') && pageHtml.includes('18 MB') && pageHtml.includes('15 Rabbitbrush'), '');
check('The page says the date it is available until', /Available until [A-Z][a-z]+ \d+, \d{4}/.test(pageHtml));

// message and copy
await page.click('[data-db-copy-message]');
const copied = await page.evaluate(() => window.__copied);
check('"Copy message" puts a ready-to-send message on the clipboard',
  copied.startsWith('Your report is ready. Download it here: ' + url) && /The link works until [A-Z][a-z]+ \d+, \d{4}\.$/.test(copied), JSON.stringify(copied));

// the link is remembered for this job
await page.click('.db-actions .btn--secondary:last-child');   // Close
await page.click('#rb-share-files');
await page.waitForSelector('[data-db-old]');
check('Reopening the dialog lists the link already made, with Remove now', await page.evaluate((t) => !!document.querySelector(`[data-db-remove="${t}"]`), token));

// Remove now
await page.click(`[data-db-remove="${token}"]`);
await wait(800);
check('Remove now takes the link down and deletes its files', ![...store.keys()].some((k) => k.startsWith(`lookbooks/${token}/`)));
const gone = await worker.fetch(new Request(`https://sync.example/lookbook/${token}/`), Object.assign({ CABINET: bucket }, env));
check('and the client page no longer opens', gone.status === 404);
check('and the dialog forgets it', !(await page.$('[data-db-old]')));
await page.click('.db-actions .btn--secondary:last-child').catch(() => {});

// ---- photographs: built into one zip of the originals, numbered like the report ----
await page.evaluate(() => { document.querySelectorAll('[data-drop-box]').forEach((n) => n.remove()); });
const dlgPhotos = await page.evaluate(async () => {
  const mk = (color) => { const c = document.createElement('canvas'); c.width = 320; c.height = 240; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, 320, 240); return c.toDataURL('image/jpeg', 0.9); };
  const pages = [{ type: 'pictures', reportText: { captions: { k1: 'Foyer front door' } }, evidence: { photos: [
    { key: 'k1', id: 'k1', displayNumber: 1, dataUrl: mk('#c0392b') }, { key: 'k2', id: 'k2', displayNumber: 2, dataUrl: mk('#27ae60') }, { key: 'k3', id: 'k3', displayNumber: 3, dataUrl: mk('#2980b9') } ] } }];
  window.__dlg = await window.ToolboxDropBox.open({ record: { id: 'drop-ui-1', firstName: 'Janis', lastName: 'Fensterer' }, pages, residence: 'Janis Fensterer', address: '15 Rabbitbrush' });
  const box = document.querySelector('[data-db-photos]');
  return { checked: box.checked, disabled: box.disabled, text: box.closest('label').innerText };
});
check('With photographs in the report, the photo choice is on by default and counts them', dlgPhotos.checked && !dlgPhotos.disabled && /3 photographs/.test(dlgPhotos.text), JSON.stringify(dlgPhotos));
calls.length = 0;
await page.click('[data-db-create]');
await page.waitForSelector('[data-db-url]', { timeout: 60000 });
const url2 = await page.$eval('[data-db-url]', (i) => i.value);
const token2 = /lookbook\/([a-f0-9]{36})\//.exec(url2)[1];
const zipKey = [...store.keys()].find((k) => k.startsWith(`lookbooks/${token2}/files/Photos-`) && k.endsWith('.zip'));
check('Only the photographs were sent: one zip', !!zipKey && [...store.keys()].filter((k) => k.includes('/files/')).length === 2 - 1, zipKey || 'none');
const zip = await JSZip.loadAsync(store.get(zipKey).bytes);
const names = Object.keys(zip.files).sort();
check('The zip holds the three photographs, numbered', JSON.stringify(names) === JSON.stringify(['Photo-01.jpg', 'Photo-02.jpg', 'Photo-03.jpg']), JSON.stringify(names));
const first = await zip.file('Photo-01.jpg').async('uint8array');
check('Each photograph is a real JPEG', first[0] === 0xff && first[1] === 0xd8 && first.length > 500, String(first.length));
const page2 = await (await worker.fetch(new Request(`https://sync.example/lookbook/${token2}/`), Object.assign({ CABINET: bucket }, env))).text();
check('The page lists the photographs zip under its plain name', page2.includes('Photographs in the report (ZIP)') && /Photos-15-Rabbitbrush\.zip/.test(page2), '');

// ---- a failure takes the half-made drop down and says so ----
await page.evaluate(() => { document.querySelectorAll('[data-drop-box]').forEach((n) => n.remove()); });
await page.evaluate(() => window.ToolboxDropBox.open({ record: { id: 'drop-ui-2' }, pages: [], residence: 'X', address: 'Y' }));
await (await page.$('[data-db-pdf]')).uploadFile(pdfPath);
failPart = { part: 2, times: 9 };
calls.length = 0;
await page.click('[data-db-create]');
await page.waitForFunction(() => { const s = document.querySelector('[data-db-status]'); return s && s.hasAttribute('data-error'); }, { timeout: 60000 });
check('When a part keeps failing, the dialog says it could not finish', await page.evaluate(() => document.querySelector('[data-db-status]').textContent.length > 0));
check('and the half-made drop was removed (nothing is left behind)', calls.some((c) => /^DELETE /.test(c)) && ![...store.keys()].some((k) => k.includes('/files/') && !k.includes(token2) && !k.includes(token)),
  [...store.keys()].filter((k) => !k.includes(token2)).join(', '));
check('and the buttons work again', await page.evaluate(() => !document.querySelector('[data-db-create]').disabled));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
server.kill();
if (failed.length) process.exit(1);
