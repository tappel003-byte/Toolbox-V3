/**
 * Sandia Geo Drop Box -- the Worker side: create, multipart upload of a big file, finalize, the public
 * download page, the download itself, 14-day expiry (and cleanup), Remove now, and Access gating.
 * Run: node tests/drop-box-worker.mjs
 *
 * The bucket here is a mock that follows R2's contract (list with prefix and delimiter, batch delete,
 * multipart with fixed-size parts). It has not met a real R2 bucket.
 */
import worker from '../sync-worker/src/index.js';
import {
  DROP_PART_BYTES,
  DROP_TTL_DAYS,
  buildDropManifest,
  dropIndexHtml,
  humanBytes,
  sanitizeDropFileName,
} from '../sync-worker/src/drop.js';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
);
const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
publicJwk.kid = 'drop-test'; publicJwk.alg = 'RS256'; publicJwk.use = 'sig';
const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
async function signJwt(email, sub) {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid: 'drop-test', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    iss: 'https://toolbox-test.cloudflareaccess.com', aud: 'aud-drop-test', exp: now + 600, nbf: now - 10, email, sub,
  })));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(header + '.' + payload));
  return header + '.' + payload + '.' + b64url(new Uint8Array(sig));
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/cdn-cgi/access/certs')) {
    return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(url);
};
const accessEnv = { CF_ACCESS_TEAM_DOMAIN: 'toolbox-test.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-drop-test' };
const timToken = await signJwt('tim@example.com', 'sub-tim');

/** An R2 bucket mock with the parts of the contract the drop box uses. */
function bucketMock() {
  const store = new Map();
  const uploads = new Map();
  const toBytes = (value) => {
    if (typeof value === 'string') return new TextEncoder().encode(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    return new TextEncoder().encode(String(value));
  };
  const object = (key, row) => ({
    key,
    size: row.bytes.byteLength,
    httpMetadata: row.contentType ? { contentType: row.contentType } : {},
    body: new ReadableStream({ start(c) { c.enqueue(row.bytes); c.close(); } }),
    async text() { return new TextDecoder().decode(row.bytes); },
    async json() { return JSON.parse(new TextDecoder().decode(row.bytes)); },
    async arrayBuffer() { return row.bytes.buffer.slice(row.bytes.byteOffset, row.bytes.byteOffset + row.bytes.byteLength); },
  });
  return {
    store,
    async get(key) { const row = store.get(key); return row ? object(key, row) : null; },
    async head(key) { const row = store.get(key); return row ? { key, size: row.bytes.byteLength } : null; },
    async put(key, value, opts) {
      store.set(key, { bytes: toBytes(value), contentType: opts && opts.httpMetadata && opts.httpMetadata.contentType });
      return { key };
    },
    async delete(keys) { (Array.isArray(keys) ? keys : [keys]).forEach((k) => store.delete(k)); },
    async list(opts = {}) {
      const prefix = opts.prefix || '';
      const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      if (opts.delimiter) {
        const prefixes = new Set();
        const objects = [];
        all.forEach((k) => {
          const rest = k.slice(prefix.length);
          const at = rest.indexOf(opts.delimiter);
          if (at === -1) objects.push({ key: k });
          else prefixes.add(prefix + rest.slice(0, at + 1));
        });
        return { objects, delimitedPrefixes: [...prefixes], truncated: false };
      }
      const start = opts.cursor ? Number(opts.cursor) : 0;
      const limit = opts.limit || 1000;
      const slice = all.slice(start, start + limit);
      const truncated = start + limit < all.length;
      return { objects: slice.map((k) => ({ key: k })), truncated, cursor: truncated ? String(start + limit) : undefined };
    },
    async createMultipartUpload(key, opts) {
      const uploadId = 'up-' + uploads.size;
      uploads.set(uploadId, { key, parts: new Map(), contentType: opts && opts.httpMetadata && opts.httpMetadata.contentType });
      return { uploadId, key };
    },
    resumeMultipartUpload(key, uploadId) {
      const up = uploads.get(uploadId);
      return {
        async uploadPart(partNumber, value) {
          if (!up || up.key !== key) throw new Error('no such upload');
          const bytes = toBytes(value);
          const etag = 'etag-' + partNumber + '-' + bytes.byteLength;
          up.parts.set(partNumber, { bytes, etag });
          return { partNumber, etag };
        },
        async complete(parts) {
          if (!up || up.key !== key) throw new Error('no such upload');
          const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
          const sizes = ordered.map((p) => {
            const got = up.parts.get(p.partNumber);
            if (!got || got.etag !== p.etag) throw new Error('part mismatch');
            return got.bytes.byteLength;
          });
          // R2 rule: every part but the last is the same size.
          sizes.slice(0, -1).forEach((n) => { if (n !== sizes[0]) throw new Error('uneven parts'); });
          const total = sizes.reduce((a, b) => a + b, 0);
          const joined = new Uint8Array(total);
          let at = 0;
          ordered.forEach((p) => { const b = up.parts.get(p.partNumber).bytes; joined.set(b, at); at += b.byteLength; });
          store.set(key, { bytes: joined, contentType: up.contentType });
          uploads.delete(uploadId);
          return { key, size: total };
        },
      };
    },
  };
}

async function call(path, bucket, opts = {}) {
  const headers = new Headers(opts.headers || {});
  if (opts.auth !== false) headers.set('Cf-Access-Jwt-Assertion', opts.token || timToken);
  return worker.fetch(new Request('https://sync.example/' + path, { method: opts.method || 'GET', headers, body: opts.body }),
    Object.assign({ CABINET: bucket }, accessEnv));
}
const jsonBody = (o) => JSON.stringify(o);
const JSONH = { 'content-type': 'application/json' };

/** Upload one file the way the client does: start, parts, complete. */
async function uploadFile(bucket, token, name, bytes, contentType) {
  const start = await call(`lookbook/${token}/uploads/${encodeURIComponent(name)}`, bucket, { method: 'POST', headers: { 'content-type': contentType } });
  const started = await start.json();
  const parts = [];
  for (let at = 0, n = 1; at < bytes.byteLength; at += DROP_PART_BYTES, n += 1) {
    const chunk = bytes.subarray(at, Math.min(bytes.byteLength, at + DROP_PART_BYTES));
    const res = await call(`lookbook/${token}/uploads/${encodeURIComponent(name)}?uploadId=${started.uploadId}&part=${n}`, bucket, { method: 'PUT', body: chunk });
    const part = await res.json();
    parts.push({ partNumber: part.partNumber, etag: part.etag });
  }
  const done = await call(`lookbook/${token}/uploads/${encodeURIComponent(name)}/complete`, bucket,
    { method: 'POST', headers: JSONH, body: jsonBody({ uploadId: started.uploadId, parts }) });
  return { started, parts, done };
}

// ---- pure helpers ----
check('A drop is good for 14 days', DROP_TTL_DAYS === 14 && buildDropManifest({ token: 't' }).ttlDays === 14);
check('The manifest says it is a drop and carries its files', buildDropManifest({ token: 't', files: [{ name: 'a.pdf' }] }).kind === 'drop');
check('File names are made safe: spaces, symbols and paths are removed',
  sanitizeDropFileName('My Report (final) v2.PDF') === 'My-Report-final-v2.PDF' && sanitizeDropFileName('../../etc/passwd') === 'passwd' &&
  sanitizeDropFileName('   ') === null && sanitizeDropFileName('index.html') === null && sanitizeDropFileName('manifest.json') === null);
check('Sizes read plainly', humanBytes(8.1 * 1024 * 1024) === '8.1 MB' && humanBytes(512) === '512 B' && humanBytes(1536) === '2 KB');
const html0 = dropIndexHtml(buildDropManifest({ token: 't', title: '15 Rabbitbrush <b>', residence: 'Fensterer', address: '15 Rabbitbrush, Santa Fe', files: [{ name: 'Report.pdf', label: 'Report (PDF)', size: 8.1 * 1024 * 1024 }] }));
check('The page is escaped, branded and has no script', !html0.includes('<b>') && html0.includes('alt="Sandia Geo"') && !/<script/i.test(html0), '');

// ---- the whole flow ----
const bucket = bucketMock();
const unauth = await call('lookbook', bucket, { auth: false, method: 'POST', headers: JSONH, body: jsonBody({ kind: 'drop' }) });
check('Creating a drop without Access is unauthorized', unauth.status === 401, String(unauth.status));

const createdRes = await call('lookbook', bucket, { method: 'POST', headers: JSONH, body: jsonBody({ kind: 'drop', title: '15 Rabbitbrush', residence: 'Fensterer', address: '15 Rabbitbrush', customerFileId: 'cf-1' }) });
const created = await createdRes.json();
const token = created.token;
check('A drop is created: token, public link under lookbook/, 14 days, the part size',
  createdRes.status === 200 && /^[a-f0-9]{36}$/.test(token) && created.url === `https://sync.example/lookbook/${token}/` && created.ttlDays === 14 && created.partBytes === DROP_PART_BYTES, JSON.stringify(created));
check('Until it is finalized the link is not public', (await call(`lookbook/${token}/`, bucket, { auth: false })).status === 404);

// a 40 MB report: five 8 MiB parts, with a pattern that proves the order
const big = new Uint8Array(40 * 1024 * 1024);
for (let i = 0; i < big.length; i += 4099) big[i] = (i / 4099) & 255;
const first = await uploadFile(bucket, token, 'Report.pdf', big, 'application/pdf');
check('A 40 MB file uploads in five parts and completes', first.parts.length === 5 && first.done.status === 200 && (await first.done.json()).bytes === big.length, `${first.parts.length} parts`);
const stored = bucket.store.get(`lookbooks/${token}/files/Report.pdf`);
check('The stored file is byte-for-byte the file sent', !!stored && stored.bytes.byteLength === big.length && Buffer.compare(Buffer.from(stored.bytes), Buffer.from(big)) === 0);
const zipBytes = new Uint8Array(1234).map((_, i) => i & 255);
await uploadFile(bucket, token, 'Photos zip.zip', zipBytes, 'application/zip');
check('A second, small file uploads as one part under a safe name', bucket.store.has(`lookbooks/${token}/files/Photos-zip.zip`));
const traversal = await uploadFile(bucket, token, '../../secret.txt', new Uint8Array([1, 2, 3]), 'text/plain');
check('A path in a file name cannot climb out of files/', traversal.done.status === 200 && bucket.store.has(`lookbooks/${token}/files/secret.txt`) && ![...bucket.store.keys()].some((k) => k.includes('..')));

const tooBig = await call(`lookbook/${token}/uploads/Report.pdf?uploadId=${first.started.uploadId}&part=9`, bucket, { method: 'PUT', body: new Uint8Array(DROP_PART_BYTES + 1) });
check('A part bigger than the part size is refused', tooBig.status === 400, String(tooBig.status));
check('A part without an upload id is refused', (await call(`lookbook/${token}/uploads/Report.pdf?part=1`, bucket, { method: 'PUT', body: new Uint8Array(5) })).status === 400);
check('Uploading without Access is unauthorized', (await call(`lookbook/${token}/uploads/Report.pdf`, bucket, { auth: false, method: 'POST' })).status === 401);

const noFiles = await call(`lookbook/${token}/finalize`, bucket, { method: 'POST', headers: JSONH, body: jsonBody({ files: [] }) });
check('A drop with no files cannot be finalized', noFiles.status === 400, String(noFiles.status));
const missing = await call(`lookbook/${token}/finalize`, bucket, { method: 'POST', headers: JSONH, body: jsonBody({ files: [{ name: 'Nope.pdf' }] }) });
check('A file that was never uploaded cannot be listed', missing.status === 400, String(missing.status));

const fin = await call(`lookbook/${token}/finalize`, bucket, { method: 'POST', headers: JSONH, body: jsonBody({ files: [
  { name: 'Report.pdf', label: 'Report (PDF)', size: 1 }, { name: 'Photos zip.zip', label: 'Photographs in the report (ZIP)' } ] }) });
const finBody = await fin.json();
check('Finalizing makes it live with two files', fin.status === 200 && finBody.fileCount === 2 && finBody.ttlDays === 14, JSON.stringify(finBody));

const page = await call(`lookbook/${token}/`, bucket, { auth: false });
const pageHtml = await page.text();
check('The public page needs no sign-in and says it is not to be indexed', page.status === 200 && page.headers.get('x-robots-tag') === 'noindex, nofollow' && /text\/html/.test(page.headers.get('content-type')));
check('The page lists both files with their real sizes and Download buttons',
  pageHtml.includes('Report (PDF)') && pageHtml.includes('Photographs in the report (ZIP)') && pageHtml.includes('40 MB') && pageHtml.includes('1 KB') &&
  (pageHtml.match(/class="btn"/g) || []).length === 2 && pageHtml.includes('href="files/Report.pdf"'), '');
check('The page names the job, the date it expires and carries the Sandia Geo logo', pageHtml.includes('15 Rabbitbrush') && /Available until [A-Z][a-z]+ \d+, \d{4}/.test(pageHtml) && pageHtml.includes('data:image/png;base64,'));

const dl = await call(`lookbook/${token}/files/Report.pdf`, bucket, { auth: false });
const dlBytes = new Uint8Array(await dl.arrayBuffer());
check('A download is the exact file, saved under its own name',
  dl.status === 200 && dlBytes.byteLength === big.length && Buffer.compare(Buffer.from(dlBytes), Buffer.from(big)) === 0 &&
  /attachment; filename="Report\.pdf"/.test(dl.headers.get('content-disposition')) && dl.headers.get('content-type') === 'application/pdf' && dl.headers.get('content-length') === String(big.length));
check('Downloads are not cached', /no-store/.test(dl.headers.get('cache-control')));
check('manifest.json is not public', (await call(`lookbook/${token}/manifest.json`, bucket, { auth: false })).status === 404);
check('Nothing outside the page and files/ is served', (await call(`lookbook/${token}/zzz.txt`, bucket, { auth: false })).status === 404);
check('A made-up token is not found', (await call(`lookbook/${'0'.repeat(36)}/`, bucket, { auth: false })).status === 404);

// ---- Remove now ----
const rm401 = await call(`lookbook/${token}`, bucket, { auth: false, method: 'DELETE' });
check('Removing without Access is unauthorized', rm401.status === 401, String(rm401.status));
const rm = await call(`lookbook/${token}`, bucket, { method: 'DELETE' });
check('Remove now deletes every file under the token', rm.status === 200 && ![...bucket.store.keys()].some((k) => k.startsWith(`lookbooks/${token}/`)));
check('After Remove now the link is gone', (await call(`lookbook/${token}/`, bucket, { auth: false })).status === 404);
check('Removing twice is harmless', (await call(`lookbook/${token}`, bucket, { method: 'DELETE' })).status === 200);

// ---- an engineer lookbook is not a drop ----
const lbRes = await call('lookbook', bucket, { method: 'POST', headers: JSONH, body: jsonBody({ title: 'Engineer lookbook' }) });
const lb = await lbRes.json();
check('A lookbook is still created the old way (30 days)', lbRes.status === 200 && lb.ttlDays === 30 && !lb.kind);
check('Remove now refuses to delete an engineer lookbook', (await call(`lookbook/${lb.token}`, bucket, { method: 'DELETE' })).status === 409);
check('and its files are still there', bucket.store.has(`lookbooks/${lb.token}/manifest.json`));

// ---- 14 days, then it is deleted ----
const forceExpiry = (tok) => {
  const key = `lookbooks/${tok}/manifest.json`;
  const m = JSON.parse(new TextDecoder().decode(bucket.store.get(key).bytes));
  m.expiresAt = '2020-01-01T00:00:00.000Z';
  bucket.store.set(key, { bytes: new TextEncoder().encode(JSON.stringify(m)), contentType: 'application/json' });
};
async function liveDrop(name) {
  const t = (await (await call('lookbook', bucket, { method: 'POST', headers: JSONH, body: jsonBody({ kind: 'drop', title: name }) })).json()).token;
  await uploadFile(bucket, t, 'a.pdf', new Uint8Array(100), 'application/pdf');
  await call(`lookbook/${t}/finalize`, bucket, { method: 'POST', headers: JSONH, body: jsonBody({ files: [{ name: 'a.pdf' }] }) });
  return t;
}
const old1 = await liveDrop('old one');
forceExpiry(old1);
const expired = await call(`lookbook/${old1}/`, bucket, { auth: false });
check('An expired drop says so (410)', expired.status === 410, String(expired.status));
check('and its files are deleted when someone asks for it', ![...bucket.store.keys()].some((k) => k.startsWith(`lookbooks/${old1}/`)));

const old2 = await liveDrop('old two');
const fresh = await liveDrop('fresh');
forceExpiry(old2);
forceExpiry(lb.token);   // an expired engineer lookbook must be left alone by the drop clean-up
await call('lookbook', bucket, { method: 'POST', headers: JSONH, body: jsonBody({ kind: 'drop', title: 'trigger sweep' }) });
check('Making a new drop clears out an expired one', ![...bucket.store.keys()].some((k) => k.startsWith(`lookbooks/${old2}/`)));
check('and leaves a live drop alone', bucket.store.has(`lookbooks/${fresh}/files/a.pdf`) && bucket.store.has(`lookbooks/${fresh}/index.html`));
check('and leaves an expired engineer lookbook alone (its own rules)', bucket.store.has(`lookbooks/${lb.token}/manifest.json`));

// a draft that was never finished also runs out
const abandoned = (await (await call('lookbook', bucket, { method: 'POST', headers: JSONH, body: jsonBody({ kind: 'drop', title: 'never finished' }) })).json()).token;
await uploadFile(bucket, abandoned, 'a.pdf', new Uint8Array(50), 'application/pdf');
forceExpiry(abandoned);
await call('lookbook', bucket, { method: 'POST', headers: JSONH, body: jsonBody({ kind: 'drop', title: 'sweep again' }) });
check('An unfinished drop that has run out is cleared too', ![...bucket.store.keys()].some((k) => k.startsWith(`lookbooks/${abandoned}/`)));

// ---- a finalized drop cannot be added to or finalized again ----
const done = await liveDrop('done');
const again = await call(`lookbook/${done}/uploads/b.pdf`, bucket, { method: 'POST' });
check('A finished drop takes no more uploads', again.status === 409, String(again.status));

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) process.exit(1);
