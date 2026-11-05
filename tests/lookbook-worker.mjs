/**
 * Engineer lookbook Worker routes — create, upload, finalize, public GET, expiry.
 * Run: node tests/lookbook-worker.mjs
 */
import worker from '../sync-worker/src/index.js';
import {
  LOOKBOOK_TTL_MS,
  buildManifest,
  isExpired,
  lookbookIndexHtml,
  sanitizeLookbookRelativePath,
} from '../sync-worker/src/lookbook.js';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
);
const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
publicJwk.kid = 'lookbook-test';
publicJwk.alg = 'RS256';
publicJwk.use = 'sig';
const b64url = (bytes) => Buffer.from(bytes).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
async function signJwt(email, sub) {
  const header = b64url(new TextEncoder().encode(
    JSON.stringify({ alg: 'RS256', kid: 'lookbook-test', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    iss: 'https://toolbox-test.cloudflareaccess.com',
    aud: 'aud-lookbook-test', exp: now + 600, nbf: now - 10,
    email: email, sub: sub,
  })));
  const input = new TextEncoder().encode(header + '.' + payload);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, input);
  return header + '.' + payload + '.' + b64url(new Uint8Array(sig));
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/cdn-cgi/access/certs')) {
    return new Response(JSON.stringify({ keys: [publicJwk] }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(url);
};

const accessEnv = {
  CF_ACCESS_TEAM_DOMAIN: 'toolbox-test.cloudflareaccess.com',
  CF_ACCESS_AUD: 'aud-lookbook-test',
};
const timToken = await signJwt('tim@example.com', 'sub-tim');

function cabinet() {
  const store = new Map();
  return {
    store,
    async get(key) {
      const row = store.get(key);
      if (!row) return null;
      return {
        key,
        httpMetadata: row.contentType ? { contentType: row.contentType } : {},
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(row.bytes);
            controller.close();
          },
        }),
        async text() { return new TextDecoder().decode(row.bytes); },
        async json() { return JSON.parse(new TextDecoder().decode(row.bytes)); },
        async arrayBuffer() { return row.bytes.buffer.slice(
          row.bytes.byteOffset, row.bytes.byteOffset + row.bytes.byteLength); },
      };
    },
    async head(key) {
      return store.has(key) ? { key } : null;
    },
    async put(key, value, opts) {
      let bytes;
      if (typeof value === 'string') bytes = new TextEncoder().encode(value);
      else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
      else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      else bytes = new TextEncoder().encode(String(value));
      store.set(key, {
        bytes: bytes,
        contentType: opts && opts.httpMetadata && opts.httpMetadata.contentType,
      });
      return { key };
    },
    async delete() {},
    async list() { return { objects: [], truncated: false }; },
  };
}

async function call(path, bucket, opts = {}) {
  const headers = new Headers(opts.headers || {});
  if (opts.auth !== false) headers.set('Cf-Access-Jwt-Assertion', opts.token || timToken);
  return worker.fetch(new Request('https://sync.example/' + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body,
  }), Object.assign({ CABINET: bucket }, accessEnv));
}

// ---- pure helpers ----
check('TTL is 30 days', LOOKBOOK_TTL_MS === 30 * 24 * 60 * 60 * 1000);
check('path sanitizer blocks traversal',
  sanitizeLookbookRelativePath('../secret') === null &&
  sanitizeLookbookRelativePath('sheets/../x') === null);
check('path sanitizer allows sheets and photos',
  sanitizeLookbookRelativePath('sheets/sheet-01.jpg') === 'sheets/sheet-01.jpg' &&
  sanitizeLookbookRelativePath('photos/photo-02.jpg') === 'photos/photo-02.jpg');
const draft = buildManifest({ token: 'a'.repeat(36), title: 'Test', status: 'draft' });
check('manifest carries 30-day expiry and draft status',
  draft.status === 'draft' && draft.ttlDays === 30 && !isExpired(draft));
check('expired when expiresAt is in the past',
  isExpired({ expiresAt: '2020-01-01T00:00:00.000Z' }, Date.parse('2026-11-05T00:00:00.000Z')));
const html = lookbookIndexHtml(Object.assign({}, draft, {
  pages: [{ title: 'Cover', still: 'sheets/sheet-01.jpg' }],
  photos: [{ title: 'Photo 1', src: 'photos/photo-01.jpg' }],
}));
check('index HTML has Save as PDF and tabs',
  html.includes('Save as PDF') && html.includes('data-lb-tab="photos"') &&
  html.includes('lookbook.css') && html.includes('lookbook.js'));

// ---- route flow ----
{
  const bucket = cabinet();
  const unauth = await call('lookbook', bucket, {
    auth: false, method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'No auth' }),
  });
  check('create without Access token is unauthorized', unauth.status === 401, String(unauth.status));

  const created = await call('lookbook', bucket, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Mitchell lookbook',
      residence: 'Mitchell',
      address: '59 Lodge Trail',
      customerFileId: 'cf-test',
    }),
  });
  check('create returns 200', created.status === 200, String(created.status));
  const createdBody = await created.json();
  check('create returns token, url, expiresAt',
    !!(createdBody.token && createdBody.url && createdBody.expiresAt && createdBody.ttlDays === 30),
    JSON.stringify(createdBody));
  const token = createdBody.token;

  const publicDraft = await call('lookbook/' + token + '/', bucket, { auth: false });
  check('public GET rejects draft (not finalized)', publicDraft.status === 404, String(publicDraft.status));

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const upSheet = await call('lookbook/' + token + '/files/sheets/sheet-01.jpg', bucket, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: jpeg,
  });
  check('upload sheet still is 200', upSheet.status === 200, String(upSheet.status));
  const upPhoto = await call('lookbook/' + token + '/files/photos/photo-01.jpg', bucket, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body: jpeg,
  });
  check('upload photograph is 200', upPhoto.status === 200, String(upPhoto.status));

  const reserved = await call('lookbook/' + token + '/files/index.html', bucket, {
    method: 'PUT',
    headers: { 'content-type': 'text/html' },
    body: '<html></html>',
  });
  check('reserved viewer filenames cannot be uploaded', reserved.status === 400, String(reserved.status));

  const finalized = await call('lookbook/' + token + '/finalize', bucket, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Mitchell lookbook',
      residence: 'Mitchell',
      address: '59 Lodge Trail',
      pages: [{ title: 'Cover', still: 'sheets/sheet-01.jpg' }],
      photos: [{ title: 'Photo 1', src: 'photos/photo-01.jpg' }],
    }),
  });
  check('finalize returns 200', finalized.status === 200, String(finalized.status));
  const finBody = await finalized.json();
  check('finalize returns live url and counts',
    finBody.ok && finBody.url && finBody.pageCount === 1 && finBody.photoCount === 1,
    JSON.stringify(finBody));

  const indexRes = await call('lookbook/' + token + '/', bucket, { auth: false });
  check('public index is 200 without Access token', indexRes.status === 200, String(indexRes.status));
  const indexHtml = await indexRes.text();
  check('public index is the lookbook viewer',
    indexHtml.includes('Save as PDF') && indexHtml.includes('Mitchell'));

  const cssRes = await call('lookbook/' + token + '/lookbook.css', bucket, { auth: false });
  check('public CSS is served', cssRes.status === 200 &&
    (cssRes.headers.get('content-type') || '').includes('text/css'));

  const stillRes = await call('lookbook/' + token + '/sheets/sheet-01.jpg', bucket, { auth: false });
  check('public sheet still is served', stillRes.status === 200, String(stillRes.status));

  const photoRes = await call('lookbook/' + token + '/photos/photo-01.jpg', bucket, { auth: false });
  check('public photograph is served', photoRes.status === 200, String(photoRes.status));

  const manifestLeak = await call('lookbook/' + token + '/manifest.json', bucket, { auth: false });
  check('manifest.json is not publicly listed', manifestLeak.status === 404, String(manifestLeak.status));

  // Force expiry and confirm 410.
  const manifestKey = 'lookbooks/' + token + '/manifest.json';
  const row = bucket.store.get(manifestKey);
  const manifest = JSON.parse(new TextDecoder().decode(row.bytes));
  manifest.expiresAt = '2020-01-01T00:00:00.000Z';
  bucket.store.set(manifestKey, {
    bytes: new TextEncoder().encode(JSON.stringify(manifest)),
    contentType: 'application/json; charset=utf-8',
  });
  const expired = await call('lookbook/' + token + '/', bucket, { auth: false });
  check('expired lookbook returns 410', expired.status === 410, String(expired.status));
}

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) process.exit(1);
