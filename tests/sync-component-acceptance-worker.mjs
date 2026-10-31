/**
 * Component acceptance, against the REAL Worker handler.
 *
 * Run: node tests/sync-component-acceptance-worker.mjs
 *
 * The protocol was modelled and attacked first, in
 * tests/sync-component-acceptance-model.mjs, and GPT/Codex got past three
 * earlier versions of it there. This suite ports those attacks onto
 * sync-worker/src/index.js itself, through its fetch entry point, so what is
 * proven is the handler and not a description of it.
 *
 * THE DEFECT
 *   Device A passes the ownership gate. Device B takes the file over. A's
 *   in-flight component PUT resumes, overwrites B's bytes, and answers 200 --
 *   while the index correctly names B. The write was never conditional on the
 *   ownership that authorized it.
 *
 * The R2 mock computes ETags as the MD5 OF THE BYTES, which is how Cloudflare
 * computes them. A design that needs "same bytes, new version" fails here
 * rather than in production -- and it is why every index write carries a
 * sequence that cannot repeat.
 */
import { createHash } from 'crypto';
import worker from '../sync-worker/src/index.js';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const ID = '44444444-4444-4444-8444-444444444444';
const IKEY = 'cf/' + ID + '/index.json';
const LEGACY = (name) => 'cf/' + ID + '/' + name + '.json';

// ---- Access identity, the shape the other Worker suites use --------------
const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
);
const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
publicJwk.kid = 'accept-test';
publicJwk.alg = 'RS256';
publicJwk.use = 'sig';
const b64url = (bytes) => Buffer.from(bytes).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
async function signJwt(email, sub) {
  const header = b64url(new TextEncoder().encode(
    JSON.stringify({ alg: 'RS256', kid: 'accept-test', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    iss: 'https://toolbox-test.cloudflareaccess.com',
    aud: 'aud-accept-test', exp: now + 600, nbf: now - 10,
    email: email, sub: sub,
  })));
  const input = new TextEncoder().encode(header + '.' + payload);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, input);
  return header + '.' + payload + '.' + b64url(new Uint8Array(sig));
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith('/cdn-cgi/access/certs')) {
    return new Response(JSON.stringify({ keys: [publicJwk] }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(url, init);
};
const accessEnv = {
  CF_ACCESS_TEAM_DOMAIN: 'toolbox-test.cloudflareaccess.com',
  CF_ACCESS_AUD: 'aud-accept-test',
  // Acceptance-write suites exercise the gated protocol. Production keeps
  // COMPONENT_ACCEPTANCE_WRITES unset (OFF) until Tim authorizes activation.
  COMPONENT_ACCEPTANCE_WRITES: '1',
};
const timToken = await signJwt('tim@example.com', 'sub-tim');
const leeToken = await signJwt('lee@example.com', 'sub-lee');

/**
 * R2 with CONTENT-ADDRESSED ETags, a real prefix list and delete, and one
 * named read that can be held open so a race is deterministic rather than
 * hoped for.
 */
function cabinet(seed) {
  const store = new Map();
  const etagOf = (body) => createHash('md5').update(String(body)).digest('hex');
  for (const [k, v] of Object.entries(seed || {})) {
    store.set(k, { body: typeof v === 'string' ? v : JSON.stringify(v) });
  }
  const gate = { pause: null, release: null, promise: null };
  const row = (key) => {
    const found = store.get(key);
    if (!found) return null;
    return {
      key,
      etag: etagOf(found.body),
      httpEtag: '"' + etagOf(found.body) + '"',
      size: found.body.length,
      async json() { return JSON.parse(found.body); },
      async text() { return found.body; },
      async arrayBuffer() { return new TextEncoder().encode(found.body).buffer; },
    };
  };
  return {
    store,
    holdNextGet(key) {
      gate.pause = key;
      gate.promise = new Promise((resolve) => { gate.release = resolve; });
    },
    letGo() { if (gate.release) { gate.release(); gate.release = null; gate.pause = null; } },
    async get(key) {
      // The row is read BEFORE the hold, so a held request resumes with the
      // version it actually read -- which is the whole point. Pausing first
      // and reading after would hand it fresh data and quietly test nothing:
      // its compare-and-swap would succeed on merit.
      const found = row(key);
      if (gate.pause === key) { gate.pause = null; await gate.promise; }
      return found;
    },
    async head(key) { return row(key); },
    async put(key, value, opts) {
      const found = store.get(key);
      const only = opts && opts.onlyIf;
      const want = only && only.etagMatches;
      if (want !== undefined) {
        if (!found || etagOf(found.body) !== want) return null;
      }
      const noneMatch = only && typeof only.get === 'function'
        ? only.get('If-None-Match') : null;
      if (noneMatch === '*' && found) return null;
      const body = typeof value === 'string' ? value
        : (value instanceof ArrayBuffer ? Buffer.from(value).toString('binary') : String(value));
      store.set(key, { body });
      return { key, etag: etagOf(body) };
    },
    async delete(key) { store.delete(key); },
    async list(options) {
      const prefix = (options && options.prefix) || '';
      const objects = [...store.keys()].filter((k) => k.startsWith(prefix))
        .sort().map((k) => ({ key: k, size: store.get(k).body.length }));
      return { objects, truncated: false };
    },
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

const asDevice = (deviceId, token) => ({
  token: token || timToken,
  headers: { 'x-toolbox-device-id': deviceId, 'content-type': 'application/json' },
});

const putFloor = (bucket, deviceId, body, token) => call(
  'files/' + ID + '/components/floor', bucket,
  Object.assign({ method: 'PUT', body: JSON.stringify(body) }, asDevice(deviceId, token)),
);

const readIndex = (bucket) => {
  const found = bucket.store.get(IKEY);
  return found ? JSON.parse(found.body) : null;
};

const acceptedFloor = (bucket) => {
  const index = readIndex(bucket);
  const ref = index && index.components && index.components.floor;
  if (!ref) return null;
  const found = bucket.store.get(ref.key);
  return found ? JSON.parse(found.body) : null;
};

const floorAt = (stamp, note) => ({ updatedAt: stamp, note, byCanvasId: {} });

const seedIndex = (extra) => Object.assign({
  id: ID,
  displayName: 'Acceptance Subject',
  propertyAddress: '15 Rabbitbrush',
  updatedAt: '2026-10-23T00:00:00.000Z',
  seq: 4,
  authoritySeq: 4,
  checkout: { deviceId: 'device-a', email: 'tim@example.com',
    checkedOutAt: '2026-10-23T01:00:00.000Z' },
}, extra || {});

// ====================================================== THE DEFECT ITSELF
//
// A is held inside its publication. B takes the file over. A resumes.
{
  const bucket = cabinet({ [IKEY]: seedIndex() });
  // B's work is already current.
  await putFloor(bucket, 'device-a', floorAt('2026-10-23T09:00:00Z', 'A work'));

  // A reads the index, is held, and will try to swap against that version.
  bucket.holdNextGet(IKEY);
  const stale = putFloor(bucket, 'device-a', floorAt('2026-10-23T10:00:00Z', 'A stale work'));
  await new Promise((r) => setTimeout(r, 25));
  const took = await call('files/' + ID + '/checkout/takeover', bucket,
    Object.assign({ method: 'POST', body: JSON.stringify({ deviceId: 'device-b' }) },
      asDevice('device-b', leeToken)));
  check('device B takes the Customer File over', took.status === 200,
    `${took.status} ${await took.clone().text()}`);
  const bWrote = await putFloor(bucket, 'device-b',
    floorAt('2026-10-23T11:00:00Z', 'B accepted'), leeToken);
  check('and B’s own Floor Survey is accepted', bWrote.status === 200,
    `${bWrote.status} ${await bWrote.clone().text()}`);

  bucket.letGo();
  const staleRes = await stale;
  const now = acceptedFloor(bucket);
  check('A’s in-flight publication does not return 200 after the takeover',
    staleRes.status !== 200, `${staleRes.status} ${await staleRes.clone().text()}`);
  check('it is refused as an ownership change, not dropped quietly',
    staleRes.status === 403 || staleRes.status === 409, String(staleRes.status));
  check('and the accepted Floor Survey is still B’s',
    !!now && now.note === 'B accepted', JSON.stringify(now));
  check('the legacy key is not where current bytes live any more',
    !bucket.store.has(LEGACY('floor')), 'no legacy write');
}

// ============================================ the candidate is immutable
{
  const bucket = cabinet({ [IKEY]: seedIndex() });
  await putFloor(bucket, 'device-a', floorAt('2026-10-23T09:00:00Z', 'first'));
  const firstKey = readIndex(bucket).components.floor.key;
  await putFloor(bucket, 'device-a', floorAt('2026-10-23T10:00:00Z', 'second'));
  const secondKey = readIndex(bucket).components.floor.key;
  check('each publication writes its own object', firstKey !== secondKey,
    `${firstKey} vs ${secondKey}`);
  check('and the earlier one still holds exactly the bytes it was accepted with',
    JSON.parse(bucket.store.get(firstKey).body).note === 'first', 'immutable');
  check('the index names the newer one',
    JSON.parse(bucket.store.get(secondKey).body).note === 'second' &&
    acceptedFloor(bucket).note === 'second', 'named');
}

// ===================================== no revision, no publication (GPT-010)
//
// The ordering check once read `revision && acceptedRev && ...`, so a request
// naming no revision skipped it and published over newer content with a 200,
// leaving the advertised field describing the bytes it had just replaced.
{
  const bucket = cabinet({ [IKEY]: seedIndex() });
  await putFloor(bucket, 'device-a', floorAt('2026-10-23T12:00:00Z', 'newer work'));
  const before = [...bucket.store.keys()].length;
  const naked = await putFloor(bucket, 'device-a', { note: 'old client stale', byCanvasId: {} });
  check('a component carrying no revision is refused',
    naked.status === 400, `${naked.status} ${await naked.clone().text()}`);
  check('and the newer accepted bytes are untouched',
    acceptedFloor(bucket).note === 'newer work' &&
    readIndex(bucket).floorUpdatedAt === '2026-10-23T12:00:00.000Z',
    JSON.stringify(readIndex(bucket).floorUpdatedAt));
  check('no candidate object is stored for a request that can never be accepted',
    [...bucket.store.keys()].length === before, 'nothing written');

  const junk = await putFloor(bucket, 'device-a',
    { updatedAt: 'yesterday', note: 'junk', byCanvasId: {} });
  check('an unparseable revision is refused the same way', junk.status === 400,
    String(junk.status));
  const numeric = await putFloor(bucket, 'device-a',
    { updatedAt: 1, note: 'integer', byCanvasId: {} });
  check('and so is a numeric one, which Date.parse would read as the year 2001',
    numeric.status === 400, String(numeric.status));
}

// ========================================= ordering, as instants not strings
{
  const bucket = cabinet({ [IKEY]: seedIndex() });
  await putFloor(bucket, 'device-a', floorAt('2026-10-23T18:00:00Z', 'six in the evening'));
  // 19:00+02:00 is 17:00Z -- OLDER -- but sorts after 18:00 as a string.
  const older = await putFloor(bucket, 'device-a',
    floorAt('2026-10-23T19:00:00+02:00', 'five in the evening'));
  check('an older instant in another offset is refused, not sorted as a string',
    '2026-10-23T19:00:00+02:00' > '2026-10-23T18:00:00.000Z' && older.status === 409,
    `${older.status} ${await older.clone().text()}`);
  check('and the Floor Survey is not rolled back an hour',
    acceptedFloor(bucket).note === 'six in the evening' &&
    readIndex(bucket).floorUpdatedAt === '2026-10-23T18:00:00.000Z',
    readIndex(bucket).floorUpdatedAt);
}

// ============================== the same instant, different bytes (GPT-010)
//
// The client cannot tell these apart: indexRev() and componentRevision() are
// one instant, newerIso() returns 0, chooseSide() says 'skip'. Accepting the
// new bytes would change the component into something nothing ever fetches.
{
  const bucket = cabinet({ [IKEY]: seedIndex() });
  await putFloor(bucket, 'device-a', floorAt('2026-10-23T10:00:00Z', 'first bytes'));
  const diverge = await putFloor(bucket, 'device-a', floorAt('2026-10-23T10:00:00Z', 'other bytes'));
  check('different bytes at the same revision are refused',
    diverge.status === 409, `${diverge.status} ${await diverge.clone().text()}`);
  check('so the advertised revision never describes bytes other than these',
    acceptedFloor(bucket).note === 'first bytes', JSON.stringify(acceptedFloor(bucket)));

  const retry = await putFloor(bucket, 'device-a', floorAt('2026-10-23T10:00:00Z', 'first bytes'));
  const payload = await retry.clone().json();
  check('an honest retry of bytes already accepted answers 200, so it stops retrying',
    retry.status === 200 && payload.unchanged === true, JSON.stringify(payload));

  const spelled = await putFloor(bucket, 'device-a',
    floorAt('2026-10-23T04:00:00-06:00', 'other bytes again'));
  check('the same instant spelled differently is the same revision',
    spelled.status === 409, String(spelled.status));
}

// ============================ the authority epoch, not merely the device
//
// A loses the file and gets it back. Its in-flight payload was composed
// BEFORE whatever the other device did in between, so re-authorizing on the
// device alone would let it discard that work silently.
{
  const bucket = cabinet({ [IKEY]: seedIndex() });
  await putFloor(bucket, 'device-a', floorAt('2026-10-23T09:00:00Z', 'A work'));
  bucket.holdNextGet(IKEY);
  const stale = putFloor(bucket, 'device-a', floorAt('2026-10-23T10:00:00Z', 'A stale'));
  await new Promise((r) => setTimeout(r, 25));
  const checkedIn = await call('files/' + ID + '/checkout/release', bucket,
    Object.assign({ method: 'POST', body: JSON.stringify({ deviceId: 'device-a' }) },
      asDevice('device-a')));
  const reacquired = await call('files/' + ID + '/checkout', bucket,
    Object.assign({ method: 'POST', body: JSON.stringify({ deviceId: 'device-a' }) },
      asDevice('device-a')));
  check('A checks the file in and takes it straight back',
    checkedIn.status === 200 && reacquired.status === 200,
    `${checkedIn.status}/${reacquired.status}`);
  bucket.letGo();
  const staleRes = await stale;
  check('a payload from the previous lease is refused even back in A’s own hands',
    staleRes.status === 403, `${staleRes.status} ${await staleRes.clone().text()}`);
  check('and the epoch that refused it is a number that cannot repeat',
    readIndex(bucket).authoritySeq > seedIndex().authoritySeq &&
    readIndex(bucket).seq >= readIndex(bucket).authoritySeq,
    JSON.stringify({ seq: readIndex(bucket).seq,
      authoritySeq: readIndex(bucket).authoritySeq }));
}

// ================================= a delete inside the window (GPT-010)
//
// The tombstone was a separate object checked before the swap, so a delete
// landing in that window changed nothing the swap was guarding: the
// publication answered 200 and left accepted bytes on a destroyed file.
{
  const bucket = cabinet({ [IKEY]: seedIndex({
    checkout: null,
    deletedAt: '2026-10-23T02:00:00.000Z',
    purgeAfter: '2027-02-20T02:00:00.000Z',
  }) });
  await putFloor(bucket, 'device-a', floorAt('2026-10-23T09:00:00Z', 'before the delete'));
  const acceptedKey = readIndex(bucket).components.floor.key;

  bucket.holdNextGet(IKEY);
  const inFlight = putFloor(bucket, 'device-a', floorAt('2026-10-23T10:00:00Z', 'after the delete'));
  await new Promise((r) => setTimeout(r, 25));
  const deleted = await call('files/' + ID, bucket,
    Object.assign({ method: 'DELETE' }, asDevice('device-b')));
  check('the back door permanently deletes the Customer File',
    deleted.status === 200, `${deleted.status} ${await deleted.clone().text()}`);
  bucket.letGo();
  const res = await inFlight;
  check('a publication in flight across the delete does not answer 200',
    res.status !== 200, `${res.status} ${await res.clone().text()}`);
  check('and the destroyed file gained no accepted component',
    !bucket.store.has(IKEY) && !bucket.store.has(acceptedKey),
    [...bucket.store.keys()].join(','));
}

// 2b. And one that starts after the delete never gets going.
{
  const bucket = cabinet({ [IKEY]: seedIndex({
    checkout: null,
    deletedAt: '2026-10-23T02:00:00.000Z',
    purgeAfter: '2027-02-20T02:00:00.000Z',
  }) });
  await call('files/' + ID, bucket, Object.assign({ method: 'DELETE' }, asDevice('device-b')));
  const late = await putFloor(bucket, 'device-a', floorAt('2026-10-23T10:00:00Z', 'too late'));
  check('a publication started after the delete is refused',
    late.status === 409, `${late.status} ${await late.clone().text()}`);
}

// ======================= the client does not own the acceptance fields
{
  const bucket = cabinet({ [IKEY]: seedIndex() });
  await putFloor(bucket, 'device-a', floorAt('2026-10-23T10:00:00Z', 'accepted bytes'));
  const acceptedKey = readIndex(bucket).components.floor.key;
  // A client that has never heard of acceptance references, announcing a
  // revision of its own and renaming the file in the same write.
  const res = await call('files/' + ID + '/index', bucket, Object.assign({
    method: 'PUT',
    body: JSON.stringify({
      id: ID,
      displayName: 'renamed by the client',
      floorUpdatedAt: '2027-01-01T00:00:00.000Z',
      components: { floor: { key: 'cf/' + ID + '/c/floor/forged.json', revision: 'x' } },
      checkout: { deviceId: 'device-b', email: 'lee@example.com' },
      seq: 1,
      authoritySeq: 1,
    }),
  }, asDevice('device-a')));
  const index = readIndex(bucket);
  check('an ordinary index write is accepted', res.status === 200,
    `${res.status} ${await res.clone().text()}`);
  check('and carries the client’s own change',
    index.displayName === 'renamed by the client', index.displayName);
  check('but cannot move the acceptance reference',
    index.components.floor.key === acceptedKey, index.components.floor.key);
  check('cannot announce a revision of its own',
    index.floorUpdatedAt === '2026-10-23T10:00:00.000Z', index.floorUpdatedAt);
  check('cannot hand itself the lease',
    index.checkout.deviceId === 'device-a' && index.checkout.email === 'tim@example.com',
    JSON.stringify(index.checkout));
  check('and cannot wind the sequence back to a number already used',
    index.seq > seedIndex().seq, String(index.seq));
}

// ============================================= what every reader resolves
{
  const bucket = cabinet({ [IKEY]: seedIndex(), [LEGACY('floor')]:
    { updatedAt: '2026-01-01T00:00:00.000Z', note: 'legacy bytes', byCanvasId: {} } });
  const before = await call('files/' + ID + '/components/floor', bucket, asDevice('device-a'));
  check('with no reference, a GET falls back to the legacy object',
    before.status === 200 && (await before.clone().json()).note === 'legacy bytes',
    String(before.status));

  await putFloor(bucket, 'device-a', floorAt('2026-10-23T10:00:00Z', 'accepted bytes'));
  const after = await call('files/' + ID + '/components/floor', bucket, asDevice('device-a'));
  check('once published, a GET answers the accepted bytes, not the legacy key',
    after.status === 200 && (await after.clone().json()).note === 'accepted bytes',
    String(after.status));
  check('and the legacy object is left in place as recovery material',
    bucket.store.has(LEGACY('floor')) &&
    JSON.parse(bucket.store.get(LEGACY('floor')).body).note === 'legacy bytes', 'kept');

  // A reference pointing at nothing is a FAULT. Falling back here would serve
  // bytes the owner had already replaced, and the client would take them as
  // current because the advertised revision says they are.
  bucket.store.delete(readIndex(bucket).components.floor.key);
  const broken = await call('files/' + ID + '/components/floor', bucket, asDevice('device-a'));
  check('a reference naming a missing object errors rather than serving older bytes',
    broken.status === 500, `${broken.status} ${await broken.clone().text()}`);
}

// ============== the purge finds the media of the version the index names
{
  const bucket = cabinet({ [IKEY]: seedIndex({
    checkout: null,
    deletedAt: '2026-10-23T02:00:00.000Z',
    purgeAfter: '2027-02-20T02:00:00.000Z',
  }) });
  bucket.store.set('media/old-plan', { body: 'old plan bytes' });
  bucket.store.set('media/new-plan', { body: 'new plan bytes' });
  // The legacy object cites the OLD plan; the accepted version cites the new
  // one. A purge reading the legacy key would delete the wrong photograph and
  // strand the right one as an orphan no listing names.
  bucket.store.set(LEGACY('plans'), { body: JSON.stringify({
    updatedAt: '2026-01-01T00:00:00.000Z',
    canvases: [{ id: 'cv1', plan: { id: 'old-plan' } }],
  }) });
  const published = await call('files/' + ID + '/components/plans', bucket,
    Object.assign({ method: 'PUT', body: JSON.stringify({
      updatedAt: '2026-10-23T10:00:00Z',
      canvases: [{ id: 'cv1', plan: { id: 'new-plan' } }],
    }) }, asDevice('device-a')));
  check('the newer plans component is accepted', published.status === 200,
    `${published.status} ${await published.clone().text()}`);

  const deleted = await call('files/' + ID, bucket,
    Object.assign({ method: 'DELETE' }, asDevice('device-b')));
  const tomb = JSON.parse(bucket.store.get('purge/' + ID + '.json').body);
  check('the permanent delete succeeds', deleted.status === 200, String(deleted.status));
  check('and it deleted the plan the INDEX named, not the one the legacy key did',
    !bucket.store.has('media/new-plan') && tomb.mediaIds.includes('new-plan'),
    JSON.stringify(tomb.mediaIds));
}

// =================== the sequence refuses to wrap rather than wrap quietly
//
// Past Number.MAX_SAFE_INTEGER a bump stops being a bump: seq + 1 === seq,
// the body repeats, its content-addressed ETag repeats, and a stale
// compare-and-swap could succeed long after it should have died. At one write
// per millisecond this is about 285,000 years away. It refuses anyway,
// because a silent wrap is not survivable.
{
  const bucket = cabinet({ [IKEY]: seedIndex({ seq: Number.MAX_SAFE_INTEGER - 2 }) });
  const res = await putFloor(bucket, 'device-a', floorAt('2026-10-23T10:00:00Z', 'at the ceiling'));
  check('a publication refuses rather than wrap the sequence',
    res.status === 500 && /sequence exhausted/.test(await res.clone().text()),
    `${res.status} ${await res.clone().text()}`);
  const acquire = await call('files/' + ID + '/checkout/takeover', bucket,
    Object.assign({ method: 'POST', body: JSON.stringify({ deviceId: 'device-b' }) },
      asDevice('device-b', leeToken)));
  check('and so does an ownership change, which is what stamps the epoch',
    acquire.status === 500, `${acquire.status} ${await acquire.clone().text()}`);
  check('nothing was accepted at the ceiling',
    !readIndex(bucket).components, JSON.stringify(readIndex(bucket).components || null));
}

// ============ the rollout window: an index that advertises what it lost
//
// During a version switch, an old-handler index PUT already in flight can
// complete afterwards. It carries the client's own body forward, so it keeps
// the client's <name>UpdatedAt and drops the components map it never knew
// about. The index then advertises a published revision with nothing pointing
// at it, and the legacy object holds whatever the old handler last wrote.
//
// Serving that silently is the corruption. It is refused instead.
{
  const bucket = cabinet({ [IKEY]: seedIndex() });
  bucket.store.set(LEGACY('floor'), { body: JSON.stringify(
    { updatedAt: '2026-01-01T00:00:00.000Z', note: 'what the old handler left', byCanvasId: {} }) });
  await putFloor(bucket, 'device-a', floorAt('2026-10-23T10:00:00Z', 'published'));
  // The old handler's write lands: the reference is gone, the advertised
  // revision stays.
  const wiped = readIndex(bucket);
  delete wiped.components;
  bucket.store.set(IKEY, { body: JSON.stringify(wiped) });

  const res = await call('files/' + ID + '/components/floor', bucket, asDevice('device-a'));
  check('a GET refuses when the index advertises a revision the legacy object does not carry',
    res.status === 500 && /older than the revision/.test(await res.clone().text()),
    `${res.status} ${await res.clone().text()}`);

  // A NEWER publication restores the reference. Equal-revision Sync does not
  // — see the client-through-Worker equal-revision probe (GPT-012 Fix 2).
  const again = await putFloor(bucket, 'device-a', floorAt('2026-10-23T11:00:00Z', 'repaired'));
  const after = await call('files/' + ID + '/components/floor', bucket, asDevice('device-a'));
  check('and a newer publication restores the reference the old write dropped',
    again.status === 200 && after.status === 200 &&
    (await after.clone().json()).note === 'repaired', String(after.status));
}

// 10b. A legacy object the index says nothing about is served as before.
{
  const bucket = cabinet({ [IKEY]: seedIndex() });
  bucket.store.set(LEGACY('floor'), { body: JSON.stringify(
    { updatedAt: '2026-01-01T00:00:00.000Z', note: 'never published', byCanvasId: {} }) });
  const res = await call('files/' + ID + '/components/floor', bucket, asDevice('device-a'));
  check('a file that never published anything still reads its legacy bytes',
    res.status === 200 && (await res.clone().json()).note === 'never published',
    String(res.status));
}

// 10c. The purge refuses rather than delete against bytes the index disowns.
{
  const bucket = cabinet({ [IKEY]: seedIndex({
    checkout: null,
    deletedAt: '2026-10-23T02:00:00.000Z',
    purgeAfter: '2027-02-20T02:00:00.000Z',
  }) });
  bucket.store.set('media/old-plan', { body: 'old plan bytes' });
  bucket.store.set(LEGACY('plans'), { body: JSON.stringify({
    updatedAt: '2026-01-01T00:00:00.000Z',
    canvases: [{ id: 'cv1', plan: { id: 'old-plan' } }],
  }) });
  await call('files/' + ID + '/components/plans', bucket,
    Object.assign({ method: 'PUT', body: JSON.stringify({
      updatedAt: '2026-10-23T10:00:00Z',
      canvases: [{ id: 'cv1', plan: { id: 'new-plan' } }],
    }) }, asDevice('device-a')));
  const wiped = readIndex(bucket);
  delete wiped.components;
  bucket.store.set(IKEY, { body: JSON.stringify(wiped) });

  const res = await call('files/' + ID, bucket,
    Object.assign({ method: 'DELETE' }, asDevice('device-b')));
  check('a permanent delete refuses rather than delete the wrong photographs',
    res.status === 500 && /older than the revision/.test(await res.clone().text()),
    `${res.status} ${await res.clone().text()}`);
  check('and nothing was destroyed',
    bucket.store.has(IKEY) && bucket.store.has('media/old-plan'), 'intact');
}

// ====================== a foreign lease stops a publication at the gate
{
  const bucket = cabinet({ [IKEY]: seedIndex({
    checkout: { deviceId: 'device-b', email: 'lee@example.com',
      checkedOutAt: '2026-10-23T01:00:00.000Z' },
  }) });
  const res = await putFloor(bucket, 'device-a', floorAt('2026-10-23T10:00:00Z', 'not mine'));
  check('a device that does not hold the file cannot publish to it',
    res.status === 403, `${res.status} ${await res.clone().text()}`);
  check('and wrote nothing', !readIndex(bucket).components, 'no reference');
}

// ========== GPT-012 Fix 1: checkout acquired while delete was mid-flight
//
// Before the fix, purge checked eligibility, then enumerated media, THEN
// marked purged without rechecking. A checkout during media discovery won
// the lease and the delete still destroyed the file.
{
  const bucket = cabinet({
    [IKEY]: seedIndex({
      checkout: null,
      deletedAt: '2026-10-23T02:00:00.000Z',
      purgeAfter: '2027-02-20T02:00:00.000Z',
    }),
    [LEGACY('plans')]: {
      updatedAt: '2026-10-23T01:00:00.000Z',
      canvases: [{ id: 'cv1', plan: { id: 'plan-race' } }],
    },
    [LEGACY('distress')]: { updatedAt: '2026-10-23T01:00:00.000Z', pins: [] },
    [LEGACY('floor')]: { updatedAt: '2026-10-23T01:00:00.000Z', byCanvasId: {} },
    [LEGACY('diagnostics')]: { updatedAt: '2026-10-23T01:00:00.000Z', figures: [] },
    'media/plan-race': 'plan-bytes',
  });
  // Hold the fence's first index read so checkout can land before eligibility
  // is decided on the CAS that marks purged.
  bucket.holdNextGet(IKEY);
  const deleting = call('files/' + ID, bucket,
    Object.assign({ method: 'DELETE' }, asDevice('device-a')));
  await new Promise((r) => setTimeout(r, 25));
  const checkout = await call('files/' + ID + '/checkout', bucket,
    Object.assign({ method: 'POST', body: JSON.stringify({ deviceId: 'device-b' }) },
      asDevice('device-b', leeToken)));
  bucket.letGo();
  const deleted = await deleting;
  const index = readIndex(bucket);
  check('a checkout that lands before the deleting fence is accepted',
    checkout.status === 200, `${checkout.status} ${await checkout.clone().text()}`);
  check('and permanent delete refuses rather than erasing the newly leased file',
    deleted.status === 403 && /checked out/i.test(await deleted.clone().text()),
    `${deleted.status} ${await deleted.clone().text()}`);
  check('the index, checkout lease, and plan media all remain',
    !!index && index.checkout && index.checkout.deviceId === 'device-b' &&
    !index.purged && bucket.store.has('media/plan-race'),
    JSON.stringify({ checkout: index && index.checkout, purged: index && index.purged }));
}

// ========== GPT-012 Fix 1: restore (clear deletedAt) before the fence
{
  const bucket = cabinet({
    [IKEY]: seedIndex({
      checkout: null,
      deletedAt: '2026-10-23T02:00:00.000Z',
      purgeAfter: '2027-02-20T02:00:00.000Z',
    }),
    [LEGACY('plans')]: { updatedAt: '2026-10-23T01:00:00.000Z', canvases: [] },
    [LEGACY('distress')]: { updatedAt: '2026-10-23T01:00:00.000Z', pins: [] },
    [LEGACY('floor')]: { updatedAt: '2026-10-23T01:00:00.000Z', byCanvasId: {} },
    [LEGACY('diagnostics')]: { updatedAt: '2026-10-23T01:00:00.000Z', figures: [] },
  });
  bucket.holdNextGet(IKEY);
  const deleting = call('files/' + ID, bucket,
    Object.assign({ method: 'DELETE' }, asDevice('device-a')));
  await new Promise((r) => setTimeout(r, 25));
  // Restore: clear Trash before the fence CAS. Direct store write matches an
  // index PUT that removed deletedAt between eligibility and the marker.
  const live = seedIndex({ checkout: null, deletedAt: null, purgeAfter: null, seq: 2 });
  bucket.store.set(IKEY, { body: JSON.stringify(live) });
  bucket.letGo();
  const deleted = await deleting;
  check('a restore before the deleting fence refuses permanent delete',
    deleted.status === 409 && /not in File Cabinet Trash/i.test(await deleted.clone().text()),
    `${deleted.status} ${await deleted.clone().text()}`);
  check('and the restored file was not destroyed',
    !!readIndex(bucket) && !readIndex(bucket).purged && !readIndex(bucket).deletedAt,
    JSON.stringify(readIndex(bucket)));
}

// ========== GPT-012 Fix 1: accepted plans/media update before the fence
//
// A publication lands while delete is held. Fence CAS fails, revalidates
// (still Trash, no checkout), fences the NEW version, and media discovery
// follows that fenced accepted-reference snapshot.
{
  const bucket = cabinet({
    [IKEY]: seedIndex({
      checkout: null,
      deletedAt: '2026-10-23T02:00:00.000Z',
      purgeAfter: '2027-02-20T02:00:00.000Z',
    }),
    [LEGACY('plans')]: {
      updatedAt: '2026-10-23T01:00:00.000Z',
      canvases: [{ id: 'cv1', plan: { id: 'plan-old' } }],
    },
    [LEGACY('distress')]: { updatedAt: '2026-10-23T01:00:00.000Z', pins: [] },
    [LEGACY('floor')]: { updatedAt: '2026-10-23T01:00:00.000Z', byCanvasId: {} },
    [LEGACY('diagnostics')]: { updatedAt: '2026-10-23T01:00:00.000Z', figures: [] },
    'media/plan-old': 'old-bytes',
    'media/plan-new': 'new-bytes',
  });
  bucket.holdNextGet(IKEY);
  const deleting = call('files/' + ID, bucket,
    Object.assign({ method: 'DELETE' }, asDevice('device-b')));
  await new Promise((r) => setTimeout(r, 25));
  const published = await call('files/' + ID + '/components/plans', bucket,
    Object.assign({ method: 'PUT', body: JSON.stringify({
      updatedAt: '2026-10-23T10:00:00Z',
      canvases: [{ id: 'cv1', plan: { id: 'plan-new' } }],
    }) }, asDevice('device-a')));
  check('plans publish before the fence is accepted',
    published.status === 200, `${published.status} ${await published.clone().text()}`);
  bucket.letGo();
  const deleted = await deleting;
  const tomb = bucket.store.get('purge/' + ID + '.json');
  const tombIds = tomb ? JSON.parse(tomb.body).mediaIds : [];
  check('delete still succeeds after fencing the updated index',
    deleted.status === 200, `${deleted.status} ${await deleted.clone().text()}`);
  check('and media discovery followed the fenced accepted plans, not the old legacy key',
    tombIds.includes('plan-new') && !bucket.store.has('media/plan-new'),
    JSON.stringify(tombIds));
}

globalThis.fetch = realFetch;
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
