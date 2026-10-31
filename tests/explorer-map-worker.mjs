/**
 * The map's data: every job with where it is. From the index when the index
 * carries it; for a job filed before that, READ from the customer component
 * the index names. Never written back, never guessed. Synthetic bucket only.
 * Run: node tests/explorer-map-worker.mjs
 */
import worker from '../sync-worker/src/index.js';
import { placeOf } from '../sync-worker/src/explore.js';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function createCabinet(seed) {
  const objects = new Map(seed.map((row) => [row.key, new TextEncoder().encode(row.body)]));
  const ops = [];
  const meta = (key) => ({ key, size: objects.get(key).byteLength, etag: 'e-' + key, uploaded: new Date('2026-10-01T00:00:00Z'), httpMetadata: { contentType: 'application/json' } });
  return {
    ops,
    objects,
    async list(opts) {
      ops.push('list ' + opts.prefix);
      return { truncated: false, objects: [...objects.keys()].filter((k) => k.startsWith(opts.prefix)).sort().map(meta) };
    },
    async head(key) { ops.push('head ' + key); return objects.has(key) ? meta(key) : null; },
    async get(key) {
      ops.push('get ' + key);
      if (!objects.has(key)) return null;
      const bytes = objects.get(key);
      return Object.assign(meta(key), { async json() { return JSON.parse(new TextDecoder().decode(bytes)); } });
    },
    async put(key) { ops.push('put ' + key); throw new Error('must not put ' + key); },
    async delete(key) { ops.push('delete ' + key); throw new Error('must not delete ' + key); },
  };
}

const seed = () => createCabinet([
  // Synced since the coordinates joined the index.
  { key: 'cf/job-new/index.json', body: JSON.stringify({ id: 'job-new', displayName: 'Rhonda Sorenson', fieldWorkDate: '2026-10-07', propertyAddressLat: 35.1, propertyAddressLon: -106.5, checkout: { email: 'tim@example.com', deviceId: 'd1' } }) },
  // Filed before: the index has no place; the published customer component does.
  { key: 'cf/job-old/index.json', body: JSON.stringify({ id: 'job-old', displayName: 'Marcus Yazzie', fieldWorkDate: '2025-05-14', components: { customer: { key: 'cf/job-old/c/customer/t1.json' } } }) },
  { key: 'cf/job-old/customer.json', body: JSON.stringify({ propertyAddressLat: 1, propertyAddressLon: 1 }) },
  { key: 'cf/job-old/c/customer/t1.json', body: JSON.stringify({ firstName: 'Marcus', propertyAddressLat: 35.53, propertyAddressLon: -108.74 }) },
  // No place anywhere.
  { key: 'cf/job-none/index.json', body: JSON.stringify({ id: 'job-none', displayName: 'Ada Mitchell', propertyAddress: '10 Oak Street' }) },
  { key: 'cf/job-none/customer.json', body: JSON.stringify({ propertyAddress: '10 Oak Street', propertyAddressLat: null, propertyAddressLon: null }) },
  // An empty field's 0,0 is not a house.
  { key: 'cf/job-zero/index.json', body: JSON.stringify({ id: 'job-zero', displayName: 'Zero', propertyAddressLat: 0, propertyAddressLon: 0 }) },
  { key: 'cf/job-zero/customer.json', body: JSON.stringify({ propertyAddressLat: 0, propertyAddressLon: 0 }) },
  // No picked address, but Floor Survey captured the base point on two
  // levels: the later capture wins.
  { key: 'cf/job-bp/index.json', body: JSON.stringify({ id: 'job-bp', displayName: 'Base Point', propertyAddress: 'Rural Route 2' }) },
  { key: 'cf/job-bp/customer.json', body: JSON.stringify({ propertyAddress: 'Rural Route 2' }) },
  { key: 'cf/job-bp/floor.json', body: JSON.stringify({ byCanvasId: {
    main: { bp1Gps: { latitude: 34.05, longitude: -106.89, accuracyMeters: 6, capturedAt: 2000 } },
    base: { bp1Gps: { latitude: 34.00, longitude: -106.80, accuracyMeters: 9, capturedAt: 1000 } },
    bad: { bp1Gps: { latitude: 0, longitude: 0, capturedAt: 3000 } },
  } }) },
  // A picked address and a base point: the picked address comes first.
  { key: 'cf/job-both/index.json', body: JSON.stringify({ id: 'job-both', displayName: 'Both' }) },
  { key: 'cf/job-both/customer.json', body: JSON.stringify({ propertyAddressLat: 35.68, propertyAddressLon: -105.94 }) },
  { key: 'cf/job-both/floor.json', body: JSON.stringify({ byCanvasId: { main: { bp1Gps: { latitude: 32.3, longitude: -106.7, capturedAt: 5 } } } }) },
  { key: 'cf/job-gone/index.json', body: JSON.stringify({ id: 'job-gone', purged: { at: '2026-10-01' }, propertyAddressLat: 35, propertyAddressLon: -106 }) },
]);

// Access, as the other explore tests sign it.
const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
Object.assign(publicJwk, { kid: 'map-test', alg: 'RS256', use: 'sig' });
const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const head = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid: 'map-test', typ: 'JWT' })));
const now = Math.floor(Date.now() / 1000);
const body = b64url(new TextEncoder().encode(JSON.stringify({ iss: 'https://toolbox-test.cloudflareaccess.com', aud: 'aud-map', exp: now + 600, nbf: now - 10, email: 'tim@example.com', sub: 's' })));
const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(head + '.' + body));
const token = head + '.' + body + '.' + b64url(new Uint8Array(sig));
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => String(url).endsWith('/cdn-cgi/access/certs')
  ? new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { 'content-type': 'application/json' } })
  : realFetch(url);
const call = (path, cabinet, opts = {}) => {
  const headers = new Headers();
  if (opts.auth !== false) headers.set('Cf-Access-Jwt-Assertion', token);
  return worker.fetch(new Request('https://sync.example/' + path, { method: opts.method || 'GET', headers }),
    { CABINET: cabinet, CF_ACCESS_TEAM_DOMAIN: 'toolbox-test.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-map' });
};

check('a real place is a place', JSON.stringify(placeOf(35.1, -106.5)) === '{"lat":35.1,"lon":-106.5}');
check('0,0 is not a place', placeOf(0, 0) === null);
check('missing, text and out-of-range are not places',
  placeOf(null, null) === null && placeOf('35', '-106') === null && placeOf(95, 10) === null && placeOf(35, 190) === null);

{
  const cabinet = seed();
  const res = await call('explore/map', cabinet);
  const data = await res.json();
  const by = Object.fromEntries(data.jobs.map((job) => [job.id, job]));
  check('the map answers', res.status === 200);
  check('a job synced since is placed from its index',
    by['job-new'].lat === 35.1 && by['job-new'].lon === -106.5 && by['job-new'].from === 'index');
  check('a job filed before is placed from the customer component the index names',
    by['job-old'].lat === 35.53 && by['job-old'].lon === -108.74 && by['job-old'].from === 'customer');
  check('the replaced customer component is not the one read',
    cabinet.ops.includes('get cf/job-old/c/customer/t1.json') && !cabinet.ops.includes('get cf/job-old/customer.json'));
  check('a job with no place anywhere comes back with none',
    by['job-none'] && !('lat' in by['job-none']) && by['job-none'].displayName === 'Ada Mitchell');
  check('a 0,0 comes back with no place', by['job-zero'] && !('lat' in by['job-zero']));
  check('a purged job is not on the map', !by['job-gone']);
  check('the count of jobs read from the customer is reported', data.readFromCustomer === 2);
  check('with no picked address, the Floor Survey base point places the job (latest capture)',
    by['job-bp'].lat === 34.05 && by['job-bp'].lon === -106.89 && by['job-bp'].from === 'base-point');
  check('the picked address comes before the base point',
    by['job-both'].lat === 35.68 && by['job-both'].from === 'customer');
  check('the base point count is reported', data.readFromBasePoint === 1);
  check('a job placed from its customer reads no floor', !cabinet.ops.includes('get cf/job-both/floor.json'));
  check('a job with no place anywhere is left for the browser to look up, not guessed here',
    !('lat' in by['job-none']) && by['job-none'].propertyAddress === '10 Oak Street');
  check('a job placed from its index reads no component', !cabinet.ops.some((op) => op.startsWith('get cf/job-new/') && !op.endsWith('index.json')));
  check('the map does not carry the lease', !('checkout' in by['job-new']));
  check('nothing is written', !cabinet.ops.some((op) => /^(put|delete) /.test(op)));
}

{
  const cabinet = seed();
  const listing = await (await call('explore/files', cabinet)).json();
  const row = listing.files.find((f) => f.id === 'job-new');
  const zero = listing.files.find((f) => f.id === 'job-zero');
  check('the Explorer listing carries the index coordinates',
    row.propertyAddressLat === 35.1 && row.propertyAddressLon === -106.5);
  check('the listing does not pass on a 0,0', !('propertyAddressLat' in zero));
}

{
  const cabinet = seed();
  check('the map needs a signed-in identity', (await call('explore/map', cabinet, { auth: false })).status === 401);
  check('the map is GET only', (await call('explore/map', cabinet, { method: 'POST' })).status === 405);
}

const failed = results.filter((row) => !row.ok);
if (failed.length) {
  console.error(`\n${failed.length} failed`);
  process.exit(1);
}
console.log(`\n${results.length} passed`);
