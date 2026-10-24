/**
 * The real client against the real Worker. No reimplementation of either.
 *
 * Run: node tests/sync-client-through-worker.mjs
 *
 * Every other suite here tests one side. js/sync.js is driven against a
 * mocked API, and sync-worker/src/index.js is driven by hand-built requests.
 * Both can be green while the two disagree -- and they did. Acceptance made
 * the component route need an index to swap against, and syncOneRecord
 * pushes every component BEFORE it writes the index, so on a Customer File
 * the Cabinet had never seen the first component would have been refused
 * 404 and a new job could never have reached the Cabinet at all. Nothing
 * either side tested on its own would have caught it.
 *
 * So: js/sync.js is loaded into a sandbox whose fetch IS the Worker's fetch,
 * over an R2 mock with content-addressed ETags. The only thing standing in
 * for the real world is the Access cookie, which the sandbox supplies as a
 * signed JWT header -- what Cloudflare Access would have put there.
 */
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import vm from 'vm';
import worker from '../sync-worker/src/index.js';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const ID = '55555555-5555-4555-8555-555555555555';
const IKEY = 'cf/' + ID + '/index.json';

// ---- Access identity, as the Worker verifies it -------------------------
const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
);
const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
publicJwk.kid = 'client-worker';
publicJwk.alg = 'RS256';
publicJwk.use = 'sig';
const b64url = (bytes) => Buffer.from(bytes).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
async function signJwt(email, sub) {
  const header = b64url(new TextEncoder().encode(
    JSON.stringify({ alg: 'RS256', kid: 'client-worker', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    iss: 'https://toolbox-test.cloudflareaccess.com',
    aud: 'aud-client-worker', exp: now + 600, nbf: now - 10,
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
  CF_ACCESS_AUD: 'aud-client-worker',
  // Existing cases below prove the acceptance protocol with writes ON.
  // Gate-OFF and equal-revision probes are separate blocks that override this.
  COMPONENT_ACCEPTANCE_WRITES: '1',
};
const timToken = await signJwt('tim@example.com', 'sub-tim');

/** R2 with content-addressed ETags, the way Cloudflare computes them. */
function cabinet(seed) {
  const store = new Map();
  const etagOf = (body) => createHash('md5').update(String(body)).digest('hex');
  for (const [k, v] of Object.entries(seed || {})) {
    store.set(k, { body: typeof v === 'string' ? v : JSON.stringify(v) });
  }
  const row = (key) => {
    const found = store.get(key);
    if (!found) return null;
    return {
      key,
      etag: etagOf(found.body),
      httpEtag: '"' + etagOf(found.body) + '"',
      size: found.body.length,
      httpMetadata: { contentType: 'application/json' },
      async json() { return JSON.parse(found.body); },
      async text() { return found.body; },
      async arrayBuffer() { return new TextEncoder().encode(found.body).buffer; },
    };
  };
  return {
    store,
    async get(key) { return row(key); },
    async head(key) { return row(key); },
    async put(key, value, opts) {
      const found = store.get(key);
      const only = opts && opts.onlyIf;
      if (only && only.etagMatches !== undefined) {
        if (!found || etagOf(found.body) !== only.etagMatches) return null;
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

/**
 * js/sync.js, loaded as the browser loads it, with the few globals it reads.
 *
 * `fetch` goes straight to the Worker's own fetch handler with the bucket
 * this call is about. Nothing between them reimplements a route, a status
 * code or a conditional write.
 */
function loadClient(bucket, deviceId, envOverrides) {
  const code = readFileSync(new URL('../js/sync.js', import.meta.url), 'utf8');
  const localStore = new Map([['toolbox.deviceId', deviceId]]);
  const files = new Map();
  const media = new Map();
  const workerEnv = Object.assign({}, accessEnv, envOverrides || {});
  const sandbox = {
    console,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    setTimeout,
    clearTimeout,
    AbortController,
    Request,
    Response,
    Headers,
    TextEncoder,
    TextDecoder,
    crypto,
    navigator: { onLine: true },
    requests: [],
    localStorage: {
      getItem: (k) => (localStore.has(k) ? localStore.get(k) : null),
      setItem: (k, v) => { localStore.set(k, String(v)); },
      removeItem: (k) => { localStore.delete(k); },
    },
    files,
    media,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.fetch = async (url, init) => {
    const path = String(url).replace('https://sync.example', '');
    const headers = new Headers((init && init.headers) || {});
    // What Cloudflare Access puts on the request once the cookie is good.
    headers.set('Cf-Access-Jwt-Assertion', timToken);
    if (!headers.get('x-toolbox-device-id')) headers.set('x-toolbox-device-id', deviceId);
    const request = new Request('https://sync.example' + path, {
      method: (init && init.method) || 'GET',
      headers,
      body: init && init.body,
    });
    const res = await worker.fetch(request, Object.assign({ CABINET: bucket }, workerEnv));
    sandbox.requests.push({ method: request.method, path, status: res.status });
    return res;
  };
  sandbox.ToolboxConfig = { syncApiBase: 'https://sync.example' };
  sandbox.ToolboxPlanSetup = {
    ensurePlanSetup(record) {
      if (!record.planSetup) {
        record.planSetup = { updatedAt: '2026-10-23T08:00:00.000Z', canvases: [] };
      }
      return record;
    },
  };
  sandbox.ToolboxApp = {
    blankCustomerFile(id) {
      return { id, createdAt: '2026-10-23T08:00:00.000Z',
        updatedAt: '2026-10-23T08:00:00.000Z' };
    },
  };
  sandbox.ToolboxDB = {
    async saveCustomerFile(record) { files.set(record.id, JSON.parse(JSON.stringify(record))); },
    async getCustomerFile(id) { return files.get(id) || null; },
    async listCustomerFiles() { return [...files.values()]; },
    async getMedia(mediaId) { return media.get(mediaId) || null; },
    async putMedia(mediaId, value) { media.set(mediaId, value); },
  };
  vm.runInNewContext(code, sandbox, { filename: 'sync.js' });
  return { Sync: sandbox.window.ToolboxSync, sandbox };
}

const record = () => ({
  id: ID,
  createdAt: '2026-10-23T08:00:00.000Z',
  updatedAt: '2026-10-23T09:00:00.000Z',
  firstName: 'Janis',
  lastName: 'Fensterer',
  propertyAddress: '15 Rabbitbrush',
  customerUpdatedAt: '2026-10-23T09:00:00.000Z',
  planSetup: { updatedAt: '2026-10-23T09:10:00.000Z', canvases: [
    { id: 'cv1', name: 'Main Level' },
  ] },
  distress: { updatedAt: '2026-10-23T09:20:00.000Z', pins: [], mode: 'internal' },
  floorSurvey: { updatedAt: '2026-10-23T09:30:00.000Z', byCanvasId: {
    cv1: { canvasId: 'cv1', points: [{ id: 'p1', index: 1, x: 10, y: 10, value: 7.2 }] },
  } },
  trashUpdatedAt: '2026-10-23T09:00:00.000Z',
});

const readIndex = (bucket) => {
  const found = bucket.store.get(IKEY);
  return found ? JSON.parse(found.body) : null;
};

// ============================== a FIRST SYNC of a Customer File nobody has
//
// Components first, index after: the order syncOneRecord actually uses, and
// the order that would have made acceptance refuse a brand-new job.
{
  const bucket = cabinet({});
  const { Sync, sandbox } = loadClient(bucket, 'device-a');
  const result = await Sync._test.syncOneRecord(record(), null, {});
  const index = readIndex(bucket);
  const refused = sandbox.requests.filter((r) => r.status >= 400);

  check('a first sync of a brand-new Customer File is not refused anywhere',
    refused.length === 0, JSON.stringify(refused));
  check('and it pushed, rather than deciding there was nothing to do',
    result.changed === true &&
    result.components.filter((c) => c.action === 'push').length >= 4,
    JSON.stringify(result.components));
  check('the index exists and names an accepted object per component',
    !!index && !!index.components && !!index.components.floor &&
    !!index.components.customer && !!index.components.plans &&
    !!index.components.distress,
    JSON.stringify(index && Object.keys(index.components || {})));
  check('the component route was the one that created it, components-first',
    sandbox.requests[0].path.indexOf('/components/') > 0 ||
    sandbox.requests.findIndex((r) => r.method === 'PUT' && r.path.endsWith('/index')) >
    sandbox.requests.findIndex((r) => r.method === 'PUT' && r.path.indexOf('/components/') > 0),
    JSON.stringify(sandbox.requests.map((r) => r.method + ' ' + r.path).slice(0, 4)));

  // The field the client orders by, set by the server from the component's
  // own updatedAt -- and the client reads it back the same way.
  check('every advertised revision matches the component the client sent',
    index.floorUpdatedAt === '2026-10-23T09:30:00.000Z' &&
    index.distressUpdatedAt === '2026-10-23T09:20:00.000Z' &&
    index.plansUpdatedAt === '2026-10-23T09:10:00.000Z' &&
    index.customerUpdatedAt === '2026-10-23T09:00:00.000Z',
    JSON.stringify({ floor: index.floorUpdatedAt, distress: index.distressUpdatedAt,
      plans: index.plansUpdatedAt, customer: index.customerUpdatedAt }));
  check('and the client’s own browse fields survived the index write',
    index.displayName === 'Janis Fensterer' &&
    index.propertyAddress === '15 Rabbitbrush',
    JSON.stringify({ name: index.displayName, address: index.propertyAddress }));
}

// ================== a second sync with nothing changed exchanges nothing
{
  const bucket = cabinet({});
  const first = loadClient(bucket, 'device-a');
  await first.Sync._test.syncOneRecord(record(), null, {});
  const seqAfterFirst = readIndex(bucket).seq;
  const componentKeys = JSON.stringify(readIndex(bucket).components);

  const second = loadClient(bucket, 'device-a');
  const remote = await (await second.sandbox.fetch(
    'https://sync.example/files/' + ID + '/index')).json();
  const result = await second.Sync._test.syncOneRecord(record(), remote, {});
  check('nothing is pushed when nothing changed',
    result.components.every((c) => c.action === 'skip'),
    JSON.stringify(result.components));
  check('and no component object was replaced',
    JSON.stringify(readIndex(bucket).components) === componentKeys, 'unmoved');
  check('so the index was not rewritten either',
    readIndex(bucket).seq === seqAfterFirst,
    `${readIndex(bucket).seq} vs ${seqAfterFirst}`);
}

// ===================== a second device pulls what the first one published
//
// The reference, the advertised revision and the bytes have to agree, or the
// second device either fetches nothing or fetches the wrong version.
{
  const bucket = cabinet({});
  const first = loadClient(bucket, 'device-a');
  await first.Sync._test.syncOneRecord(record(), null, {});

  const second = loadClient(bucket, 'device-b');
  const remote = await (await second.sandbox.fetch(
    'https://sync.example/files/' + ID + '/index')).json();
  const shell = second.Sync._test.shellForRemotePull(ID, remote);
  const result = await second.Sync._test.syncOneRecord(shell, remote, {});
  const landed = await second.sandbox.ToolboxDB.getCustomerFile(ID);

  check('the second device pulls rather than pushing its empty shell',
    result.components.filter((c) => c.action === 'pull').length >= 4,
    JSON.stringify(result.components));
  check('and the Floor Survey it got is the one the first device sent',
    !!landed && !!landed.floorSurvey &&
    landed.floorSurvey.updatedAt === '2026-10-23T09:30:00.000Z' &&
    !!landed.floorSurvey.byCanvasId.cv1 &&
    landed.floorSurvey.byCanvasId.cv1.points.length === 1,
    JSON.stringify(landed && landed.floorSurvey && landed.floorSurvey.updatedAt));
  check('with the customer information and plans alongside it',
    landed.firstName === 'Janis' && landed.planSetup.canvases.length === 1,
    JSON.stringify({ name: landed.firstName, canvases: landed.planSetup.canvases.length }));
}

// ========== an edit on the first device reaches the second one's next sync
{
  const bucket = cabinet({});
  const first = loadClient(bucket, 'device-a');
  await first.Sync._test.syncOneRecord(record(), null, {});
  const firstKey = readIndex(bucket).components.floor.key;

  const edited = record();
  edited.floorSurvey.updatedAt = '2026-10-23T14:00:00.000Z';
  edited.floorSurvey.byCanvasId.cv1.points.push(
    { id: 'p2', index: 2, x: 40, y: 10, value: 6.9 });
  const again = loadClient(bucket, 'device-a');
  const remote = await (await again.sandbox.fetch(
    'https://sync.example/files/' + ID + '/index')).json();
  await again.Sync._test.syncOneRecord(edited, remote, {});
  const index = readIndex(bucket);

  check('the edit is published as a new object, not over the old one',
    index.components.floor.key !== firstKey &&
    JSON.parse(bucket.store.get(firstKey).body).byCanvasId.cv1.points.length === 1,
    `${firstKey} kept`);
  check('and the advertised revision moved with it',
    index.floorUpdatedAt === '2026-10-23T14:00:00.000Z', index.floorUpdatedAt);

  const second = loadClient(bucket, 'device-b');
  const fresh = await (await second.sandbox.fetch(
    'https://sync.example/files/' + ID + '/index')).json();
  const shell = second.Sync._test.shellForRemotePull(ID, fresh);
  await second.Sync._test.syncOneRecord(shell, fresh, {});
  const landed = await second.sandbox.ToolboxDB.getCustomerFile(ID);
  check('the second device reads the edit, not the version before it',
    landed.floorSurvey.byCanvasId.cv1.points.length === 2,
    String(landed.floorSurvey.byCanvasId.cv1.points.length));
}

// ================ the owner's device keeps the file; another one is refused
{
  const bucket = cabinet({});
  const first = loadClient(bucket, 'device-a');
  await first.Sync._test.syncOneRecord(record(), null, {});
  const acquired = await first.sandbox.fetch(
    'https://sync.example/files/' + ID + '/checkout',
    { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'device-a' }) });
  check('device A checks the Customer File out', acquired.status === 200,
    String(acquired.status));

  const other = loadClient(bucket, 'device-b');
  const remote = await (await other.sandbox.fetch(
    'https://sync.example/files/' + ID + '/index')).json();
  const theirs = record();
  theirs.floorSurvey.updatedAt = '2026-10-23T15:00:00.000Z';
  theirs.floorSurvey.byCanvasId.cv1.points = [];
  const result = await other.Sync._test.syncOneRecord(theirs, remote, {});
  const index = readIndex(bucket);

  check('the other device is blocked rather than allowed to push',
    result.checkoutBlocked === true && result.preserved === true,
    JSON.stringify({ blocked: result.checkoutBlocked, preserved: result.preserved }));
  check('and the accepted Floor Survey is still the owner’s',
    index.floorUpdatedAt === '2026-10-23T09:30:00.000Z' &&
    JSON.parse(bucket.store.get(index.components.floor.key).body)
      .byCanvasId.cv1.points.length === 1,
    index.floorUpdatedAt);
}

// ============== the client never sends a component without a revision
//
// The Worker refuses one outright, which is only safe because every push
// path on this side carries the component's own updatedAt. Asserted here
// rather than assumed: if a future change ever pushes a clockless component,
// this is where it is caught, not in the field.
{
  const bucket = cabinet({});
  const { Sync, sandbox } = loadClient(bucket, 'device-a');
  const clockless = record();
  // No revision anywhere the client reads one from.
  delete clockless.customerUpdatedAt;
  delete clockless.updatedAt;
  clockless.planSetup.updatedAt = '';
  clockless.distress.updatedAt = '';
  clockless.floorSurvey.updatedAt = '';
  clockless.trashUpdatedAt = '';
  const result = await Sync._test.syncOneRecord(clockless, null, {});
  const sent = sandbox.requests.filter((r) => r.path.indexOf('/components/') > 0);
  check('a component with no clock is not pushed at all',
    sent.length === 0, JSON.stringify(sent));
  check('and nothing the client did sent a 400 back',
    sandbox.requests.every((r) => r.status < 400) &&
    result.components.every((c) => c.action === 'skip'),
    JSON.stringify(sandbox.requests));
}

// ========== GPT-012 Fix 2: equal-revision Sync does NOT repair a dropped map
//
// An old-handler index PUT can drop `components` while preserving every
// <name>UpdatedAt. CLAUDE-013 claimed the owner's next Sync repairs it.
// Equal timestamps make decideComponentAction skip; nothing is pushed.
{
  const bucket = cabinet({});
  const first = loadClient(bucket, 'device-a');
  await first.Sync._test.syncOneRecord(record(), null, {});
  const wiped = readIndex(bucket);
  check('precondition: acceptance wrote a components map',
    !!wiped && !!wiped.components && !!wiped.components.floor, 'has refs');
  delete wiped.components;
  bucket.store.set(IKEY, { body: JSON.stringify(wiped) });

  const again = loadClient(bucket, 'device-a');
  const remote = JSON.parse(bucket.store.get(IKEY).body);
  again.sandbox.requests.length = 0;
  const result = await again.Sync._test.syncOneRecord(record(), remote, {});
  const componentPuts = again.sandbox.requests.filter((r) =>
    r.method === 'PUT' && r.path.indexOf('/components/') > 0);
  check('equal-revision Sync after a dropped components map changes nothing',
    result.changed === false, JSON.stringify({ changed: result.changed }));
  check('every component action is skip — there is no automatic repair push',
    result.components.every((c) => c.action === 'skip'),
    JSON.stringify(result.components));
  check('and the client issued no component PUT that could restore references',
    componentPuts.length === 0, JSON.stringify(componentPuts));
  check('so the index still has no components map',
    !readIndex(bucket).components, JSON.stringify(readIndex(bucket).components || null));
}

// ========== GPT-012 Fix 2: with writes gated OFF, ordinary Sync still works
//
// Default COMPONENT_ACCEPTANCE_WRITES is unset. Legacy PUTs write the fixed
// key; the client still exchanges components and index timestamps. Acceptance
// references are not created — that is the gated protocol, not everyday sync.
{
  const bucket = cabinet({});
  const gateOff = { COMPONENT_ACCEPTANCE_WRITES: '' };
  const { Sync, sandbox } = loadClient(bucket, 'device-a', gateOff);
  const result = await Sync._test.syncOneRecord(record(), null, {});
  const index = readIndex(bucket);
  const refused = sandbox.requests.filter((r) => r.status >= 400);
  check('with acceptance writes OFF, a first sync is not refused',
    refused.length === 0 && result.changed === true,
    JSON.stringify({ refused, changed: result.changed, components: result.components }));
  check('legacy component objects were written at the fixed keys',
    bucket.store.has('cf/' + ID + '/floor.json') &&
    bucket.store.has('cf/' + ID + '/customer.json'),
    [...bucket.store.keys()].filter((k) => k.indexOf('/c/') < 0).join(','));
  check('and no acceptance candidate objects were created while gated off',
    [...bucket.store.keys()].every((k) => k.indexOf('/c/') < 0),
    [...bucket.store.keys()].filter((k) => k.indexOf('/c/') >= 0).join(','));
  check('the index carries client browse fields and advertised revisions',
    !!index && index.displayName === 'Janis Fensterer' &&
    index.floorUpdatedAt === '2026-10-23T09:30:00.000Z',
    JSON.stringify(index && { name: index.displayName, floor: index.floorUpdatedAt }));
}

globalThis.fetch = realFetch;
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
