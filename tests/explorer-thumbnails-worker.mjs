/**
 * File Explorer tiles: the Worker shrinks a stored photograph with the
 * Cloudflare Images binding, keeps the small copy in the Workers Cache, and
 * falls back to the original when it cannot. Synthetic bucket, fake binding,
 * fake cache. No production storage and no real Cloudflare Images.
 * Run: node tests/explorer-thumbnails-worker.mjs
 */
import worker from '../sync-worker/src/index.js';
import { thumbEdge } from '../sync-worker/src/explore.js';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const BIG = new Uint8Array(4096).fill(7);
const SMALL = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
const PDF = new TextEncoder().encode('%PDF-1.1\n%%EOF\n');

function createCabinet(seed) {
  const objects = new Map(seed.map((row) => [row.key, row]));
  const ops = [];
  const meta = (row) => ({
    key: row.key,
    size: row.bytes.byteLength,
    etag: row.etag || 'etag-' + row.key,
    httpEtag: '"' + (row.etag || 'etag-' + row.key) + '"',
    uploaded: new Date('2026-03-04T00:00:00Z'),
    httpMetadata: row.contentType ? { contentType: row.contentType } : {},
  });
  return {
    ops,
    objects,
    async head(key) {
      ops.push('head ' + key);
      const row = objects.get(key);
      return row ? meta(row) : null;
    },
    async get(key) {
      ops.push('get ' + key);
      const row = objects.get(key);
      if (!row) return null;
      const copy = new Uint8Array(row.bytes);
      return Object.assign(meta(row), {
        body: new ReadableStream({ start(c) { c.enqueue(copy); c.close(); } }),
        async arrayBuffer() { return copy.buffer; },
      });
    },
    async list() { return { objects: [], truncated: false }; },
    async put(key) { ops.push('put ' + key); throw new Error('must not put ' + key); },
    async delete(key) { ops.push('delete ' + key); throw new Error('must not delete ' + key); },
  };
}

function seed() {
  return createCabinet([
    { key: 'media/ph_one', bytes: BIG, contentType: 'image/jpeg' },
    { key: 'media/ph_untyped', bytes: BIG },
    { key: 'media/fsrec_main', bytes: PDF, contentType: 'application/pdf' },
  ]);
}

function fakeImages(options) {
  const opts = options || {};
  const calls = [];
  return {
    calls,
    input(stream) {
      const call = { stream };
      calls.push(call);
      return {
        transform(t) {
          call.transform = t;
          return {
            async output(o) {
              call.output = o;
              // Prove the original was actually streamed in.
              const reader = stream.getReader();
              let size = 0;
              for (;;) {
                const step = await reader.read();
                if (step.done) break;
                size += step.value.byteLength;
              }
              call.inputBytes = size;
              if (opts.fail) throw new Error('unsupported image');
              return { response: () => new Response(SMALL, { headers: { 'content-type': 'image/jpeg' } }) };
            },
          };
        },
      };
    },
  };
}

function fakeCache() {
  const store = new Map();
  const log = [];
  return {
    store,
    log,
    async match(request) {
      log.push('match ' + request.url);
      const hit = store.get(request.url);
      return hit ? new Response(hit.bytes, { headers: hit.headers }) : undefined;
    },
    async put(request, response) {
      log.push('put ' + request.url);
      store.set(request.url, {
        bytes: new Uint8Array(await response.arrayBuffer()),
        headers: Object.fromEntries(response.headers.entries()),
      });
    },
  };
}

// Access: the explore routes require a verified identity. Sign a real JWT
// against a throwaway key, exactly as tests/file-explorer-worker.mjs does.
const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
);
const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
Object.assign(publicJwk, { kid: 'thumb-test', alg: 'RS256', use: 'sig' });
const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
async function signJwt() {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid: 'thumb-test', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    iss: 'https://toolbox-test.cloudflareaccess.com', aud: 'aud-thumb-test',
    exp: now + 600, nbf: now - 10, email: 'tim@example.com', sub: 'sub-tim',
  })));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(header + '.' + payload));
  return header + '.' + payload + '.' + b64url(new Uint8Array(sig));
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/cdn-cgi/access/certs')) {
    return new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { 'content-type': 'application/json' } });
  }
  return realFetch(url);
};
const token = await signJwt();
const accessEnv = { CF_ACCESS_TEAM_DOMAIN: 'toolbox-test.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-thumb-test' };

async function call(path, env, options) {
  const opts = options || {};
  const headers = new Headers();
  if (opts.auth !== false) headers.set('Cf-Access-Jwt-Assertion', token);
  return worker.fetch(
    new Request('https://sync.example/' + path, { method: opts.method || 'GET', headers }),
    Object.assign({}, accessEnv, env),
  );
}

async function bytesOf(response) {
  return new Uint8Array(await response.arrayBuffer());
}

// ---- edge sizes
check('tile edge rounds up to a known size', thumbEdge('300') === 320 && thumbEdge('100') === 160);
check('tile edge never exceeds the largest size', thumbEdge('5000') === 640);
check('tile edge defaults to 320', thumbEdge(null) === 320 && thumbEdge('abc') === 320);

// ---- identity is required, and the route only reads
{
  const res = await call('explore/thumbs/ph_one', { CABINET: seed() }, { auth: false });
  check('a thumbnail needs a signed-in identity', res.status === 401, String(res.status));
  const cabinet = seed();
  const post = await call('explore/thumbs/ph_one', { CABINET: cabinet }, { method: 'POST' });
  check('a thumbnail route refuses anything but GET', post.status === 405, String(post.status));
}

// ---- with the Images binding: small copy, cached, original never sent
{
  const cabinet = seed();
  const images = fakeImages();
  const cache = fakeCache();
  globalThis.caches = { default: cache };
  const res = await call('explore/thumbs/ph_one?w=320', { CABINET: cabinet, IMAGES: images });
  const body = await bytesOf(res);
  check('with Images the answer is the small copy', res.status === 200 &&
    body.byteLength === SMALL.byteLength && res.headers.get('x-toolbox-thumb') === 'resized',
    `${res.status} ${body.byteLength} ${res.headers.get('x-toolbox-thumb')}`);
  check('the small copy is a JPEG', res.headers.get('content-type') === 'image/jpeg');
  check('the original was streamed into the transform, not to the browser',
    images.calls.length === 1 && images.calls[0].inputBytes === BIG.byteLength);
  check('the transform fits inside the asked edge without growing a small picture',
    images.calls[0].transform.width === 320 && images.calls[0].transform.height === 320 &&
    images.calls[0].transform.fit === 'scale-down');
  check('the header the browser reads is exposed across origins',
    /x-toolbox-thumb/.test(res.headers.get('access-control-expose-headers') || ''));
  check('the small copy is put in the Workers Cache', cache.log.some((line) => line.startsWith('put ')));
  check('the cache key carries the object version',
    [...cache.store.keys()].every((url) => /[?&]v=/.test(url) && /w=320/.test(url)));

  const again = await call('explore/thumbs/ph_one?w=320', { CABINET: cabinet, IMAGES: images });
  const againBody = await bytesOf(again);
  check('a second look is answered from the cache, with no transform',
    images.calls.length === 1 && againBody.byteLength === SMALL.byteLength &&
    again.headers.get('x-toolbox-thumb') === 'resized');
  check('a cache hit reads no object bytes',
    cabinet.ops.filter((op) => op === 'get media/ph_one').length === 1, cabinet.ops.join(', '));

  // A plan replaced under the same id must not be answered with the old one.
  cabinet.objects.get('media/ph_one').etag = 'etag-replaced';
  await call('explore/thumbs/ph_one?w=320', { CABINET: cabinet, IMAGES: images });
  check('a replaced object is transformed again, not served from the old cache entry',
    images.calls.length === 2);

  check('nothing was written to the bucket', !cabinet.ops.some((op) => /^(put|delete) /.test(op)));
  delete globalThis.caches;
}

// ---- an untyped stored photo is still tried; a PDF is not
{
  const cabinet = seed();
  const images = fakeImages();
  const res = await call('explore/thumbs/ph_untyped', { CABINET: cabinet, IMAGES: images });
  await bytesOf(res);
  check('a photo stored with no content type is still shrunk',
    images.calls.length === 1 && res.headers.get('x-toolbox-thumb') === 'resized');
  const pdf = await call('explore/thumbs/fsrec_main', { CABINET: cabinet, IMAGES: images });
  const pdfBody = await bytesOf(pdf);
  check('a PDF is not sent to Images; its original comes back as stored',
    images.calls.length === 1 && pdf.headers.get('x-toolbox-thumb') === 'original' &&
    pdfBody.byteLength === PDF.byteLength && pdf.headers.get('content-type') === 'application/pdf');
}

// ---- no binding: the original, said so
{
  const cabinet = seed();
  const res = await call('explore/thumbs/ph_one', { CABINET: cabinet });
  const body = await bytesOf(res);
  check('without Images the original comes back whole', res.status === 200 && body.byteLength === BIG.byteLength);
  check('without Images the answer says it is the original', res.headers.get('x-toolbox-thumb') === 'original');
  check('an original is not cached by the browser', res.headers.get('cache-control') === 'no-store');
}

// ---- a transform that fails: the original, not an error
{
  const cabinet = seed();
  const images = fakeImages({ fail: true });
  const cache = fakeCache();
  globalThis.caches = { default: cache };
  const res = await call('explore/thumbs/ph_one', { CABINET: cabinet, IMAGES: images });
  const body = await bytesOf(res);
  check('a failed transform falls back to the original', res.status === 200 &&
    body.byteLength === BIG.byteLength && res.headers.get('x-toolbox-thumb') === 'original');
  check('a failed transform caches nothing', !cache.log.some((line) => line.startsWith('put ')));
  delete globalThis.caches;
}

// ---- refusals
{
  const cabinet = seed();
  const missing = await call('explore/thumbs/ph_nowhere', { CABINET: cabinet, IMAGES: fakeImages() });
  check('a photo the Cabinet does not hold is 404', missing.status === 404, String(missing.status));
  const unsafe = await call('explore/thumbs/' + encodeURIComponent('../cf/x/index.json'), { CABINET: cabinet });
  check('a key that is not a media id is refused', unsafe.status === 400 || unsafe.status === 404, String(unsafe.status));
  check('a refused key reads nothing', !cabinet.ops.some((op) => op.indexOf('cf/') !== -1));
}

// ---- health says whether the binding is there
{
  const without = await (await call('health', { CABINET: seed() })).json();
  const withIt = await (await call('health', { CABINET: seed(), IMAGES: fakeImages() })).json();
  check('health reports the Images binding truthfully', without.imagesBinding === false && withIt.imagesBinding === true);
}

const failed = results.filter((row) => !row.ok);
if (failed.length) {
  console.error(`\n${failed.length} failed`);
  process.exit(1);
}
console.log(`\n${results.length} passed`);
