/**
 * An ordinary index write cannot erase a checkout acquired under it.
 *
 * Run: node tests/sync-index-put-conditional.mjs
 *
 * Checkout acquire and release have always used an ETag precondition --
 * only one writer can satisfy it, so two devices cannot both win a lease.
 * The ordinary Sync index PUT did not. It read the index, copied the lease
 * it found into its outgoing body, and wrote unconditionally. A lease taken
 * between that read and that write was overwritten by the stale copy, and
 * BOTH requests returned 200: the file ended up checked out to nobody,
 * with no error anywhere to say so.
 *
 * Client-side serialisation on one device cannot prevent this. The whole
 * point of the lease is to arbitrate BETWEEN devices, and device A cannot
 * order device B's acquire. Take Over is the same shape and matters more,
 * because it is used exactly when a device is already misbehaving.
 *
 * Exercises the real Worker handler through its fetch entry point, with a
 * mock R2 that enforces etagMatches and lets a read be paused mid-request.
 */
import worker from '../sync-worker/src/index.js';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const ID = '33333333-3333-4333-8333-333333333333';
const KEY = 'cf/' + ID + '/index.json';

// ---- Access identity, the same shape the other Worker suites use --------
const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
);
const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
publicJwk.kid = 'put-test';
publicJwk.alg = 'RS256';
publicJwk.use = 'sig';
const b64url = (bytes) => Buffer.from(bytes).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
async function signJwt(email, sub) {
  const header = b64url(new TextEncoder().encode(
    JSON.stringify({ alg: 'RS256', kid: 'put-test', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    iss: 'https://toolbox-test.cloudflareaccess.com',
    aud: 'aud-put-test', exp: now + 600, nbf: now - 10,
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
  CF_ACCESS_AUD: 'aud-put-test',
};
const timToken = await signJwt('tim@example.com', 'sub-tim');
const leeToken = await signJwt('lee@example.com', 'sub-lee');

/**
 * R2 that enforces etagMatches and can hold one named read open, so the
 * race is deterministic instead of hoped for.
 */
function cabinet(seed) {
  const store = new Map();
  let serial = 0;
  const nextEtag = () => 'etag-' + (serial += 1);
  for (const [k, v] of Object.entries(seed || {})) {
    store.set(k, { body: typeof v === 'string' ? v : JSON.stringify(v), etag: nextEtag() });
  }
  const gate = { pause: null, release: null };
  return {
    store,
    holdNextGet(key) {
      gate.pause = key;
      gate.promise = new Promise((resolve) => { gate.release = resolve; });
    },
    let_go() { if (gate.release) { gate.release(); gate.release = null; gate.pause = null; } },
    async get(key) {
      const row = store.get(key);
      if (gate.pause === key) { gate.pause = null; await gate.promise; }
      if (!row) return null;
      return {
        etag: row.etag,
        httpEtag: '"' + row.etag + '"',
        async json() { return JSON.parse(row.body); },
        async text() { return row.body; },
      };
    },
    async head(key) { return store.has(key) ? { key } : null; },
    async put(key, value, opts) {
      const row = store.get(key);
      const want = opts && opts.onlyIf && opts.onlyIf.etagMatches;
      if (want && (!row || row.etag !== want)) return null;   // precondition failed
      const saved = { body: String(value), etag: nextEtag() };
      store.set(key, saved);
      return { key, etag: saved.etag };
    },
    async delete() {},
    async list() { return { objects: [], truncated: false }; },
  };
}

const call = (path, bucket, opts = {}) => worker.fetch(new Request(
  'https://sync.example/' + path,
  {
    method: opts.method || 'GET',
    headers: new Headers(Object.assign(
      { 'Cf-Access-Jwt-Assertion': opts.token || timToken },
      opts.headers || {},
    )),
    body: opts.body,
  },
), Object.assign({ CABINET: bucket }, accessEnv));

const freshIndex = () => ({
  id: ID,
  displayName: 'Race Subject',
  propertyAddress: '15 Rabbitbrush',
  updatedAt: '2026-10-23T00:00:00.000Z',
});

const leaseOf = async (bucket) => {
  const row = bucket.store.get(KEY);
  return row ? (JSON.parse(row.body).checkout || null) : null;
};

// ---------------------------------------------------------------- the race
// An ordinary PUT reads an index with no lease and is held there. Device B
// acquires checkout. The PUT resumes and tries to write its stale copy.
{
  const bucket = cabinet({ [KEY]: freshIndex() });
  bucket.holdNextGet(KEY);
  const stale = call('files/' + ID + '/index', bucket, {
    method: 'PUT',
    token: timToken,
    headers: { 'x-toolbox-device-id': 'device-a', 'content-type': 'application/json' },
    body: JSON.stringify(Object.assign(freshIndex(), { displayName: 'Stale write' })),
  });
  await new Promise((r) => setTimeout(r, 25));
  const acquire = await call('files/' + ID + '/checkout', bucket, {
    method: 'POST', token: leeToken,
    headers: { 'x-toolbox-device-id': 'device-b', 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: 'device-b' }),
  });
  check('device B acquires the checkout', acquire.status === 200, String(acquire.status));
  bucket.let_go();
  const staleRes = await stale;

  const lease = await leaseOf(bucket);
  check('the lease device B acquired is still there',
    !!(lease && lease.deviceId === 'device-b' && lease.email === 'lee@example.com'),
    JSON.stringify(lease));
  check('and the stale write did not return 200',
    staleRes.status !== 200, String(staleRes.status));
  check('it was refused as a checkout conflict, not silently dropped',
    staleRes.status === 403 || staleRes.status === 409,
    `${staleRes.status} ${await staleRes.clone().text()}`);
}

// ------------------------------------------------------- Take Over, same
{
  const seeded = Object.assign(freshIndex(), {
    checkout: { email: 'tim@example.com', deviceId: 'device-a',
      checkedOutAt: '2026-10-23T00:00:00.000Z' },
  });
  const bucket = cabinet({ [KEY]: seeded });
  bucket.holdNextGet(KEY);
  const stale = call('files/' + ID + '/index', bucket, {
    method: 'PUT', token: timToken,
    headers: { 'x-toolbox-device-id': 'device-a', 'content-type': 'application/json' },
    body: JSON.stringify(Object.assign(freshIndex(), { displayName: 'Stale over takeover' })),
  });
  await new Promise((r) => setTimeout(r, 25));
  const taken = await call('files/' + ID + '/checkout/takeover', bucket, {
    method: 'POST', token: leeToken,
    headers: { 'x-toolbox-device-id': 'device-b', 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: 'device-b' }),
  });
  check('device B takes the file over', taken.status === 200, String(taken.status));
  bucket.let_go();
  const staleRes = await stale;
  const lease = await leaseOf(bucket);
  check('the Take Over lease survives the stale write',
    !!(lease && lease.deviceId === 'device-b'), JSON.stringify(lease));
  check('and that write was refused too', staleRes.status !== 200, String(staleRes.status));
}

// ------------------------------------------------- the ordinary path still works
{
  const bucket = cabinet({ [KEY]: freshIndex() });
  const ok = await call('files/' + ID + '/index', bucket, {
    method: 'PUT', token: timToken,
    headers: { 'x-toolbox-device-id': 'device-a', 'content-type': 'application/json' },
    body: JSON.stringify(Object.assign(freshIndex(), { displayName: 'Ordinary' })),
  });
  check('an uncontended index write still succeeds', ok.status === 200, String(ok.status));
  const row = bucket.store.get(KEY);
  check('and it wrote what was sent',
    JSON.parse(row.body).displayName === 'Ordinary', row.body.slice(0, 60));
}

// The holder's own write still goes through while they hold the lease.
{
  const seeded = Object.assign(freshIndex(), {
    checkout: { email: 'tim@example.com', deviceId: 'device-a',
      checkedOutAt: '2026-10-23T00:00:00.000Z' },
  });
  const bucket = cabinet({ [KEY]: seeded });
  const ok = await call('files/' + ID + '/index', bucket, {
    method: 'PUT', token: timToken,
    headers: { 'x-toolbox-device-id': 'device-a', 'content-type': 'application/json' },
    body: JSON.stringify(Object.assign(freshIndex(), { displayName: 'Holder write' })),
  });
  check('the holder can still write while checked out to them',
    ok.status === 200, String(ok.status));
  const after = await leaseOf(bucket);
  check('and the write carries the server lease back untouched',
    !!(after && after.deviceId === 'device-a'), JSON.stringify(after));
}

// A client may not invent, change or drop a lease of its own.
{
  const bucket = cabinet({ [KEY]: freshIndex() });
  await call('files/' + ID + '/index', bucket, {
    method: 'PUT', token: timToken,
    headers: { 'x-toolbox-device-id': 'device-a', 'content-type': 'application/json' },
    body: JSON.stringify(Object.assign(freshIndex(), {
      checkout: { email: 'mallory@example.com', deviceId: 'device-m' },
    })),
  });
  const lease = await leaseOf(bucket);
  check('a lease sent by a client is ignored', lease === null, JSON.stringify(lease));
}

// A first write creates the index; there is no lease to lose on a file
// that does not exist yet.
{
  const bucket = cabinet({});
  const created = await call('files/' + ID + '/index', bucket, {
    method: 'PUT', token: timToken,
    headers: { 'x-toolbox-device-id': 'device-a', 'content-type': 'application/json' },
    body: JSON.stringify(freshIndex()),
  });
  check('the first write of a new index still creates it',
    created.status === 200 && bucket.store.has(KEY),
    `${created.status} stored:${bucket.store.has(KEY)}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
