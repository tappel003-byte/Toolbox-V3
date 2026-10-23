/**
 * A canvas carries two pictures, and every collector has to see both.
 *
 * Run: node tests/sync-contour-media-refs.mjs
 *
 * A canvas holds its floor plan and -- once Floor Survey has sent one -- a
 * contour layer drawn from the readings. js/sync.js uploads both and
 * js/db.js cleans up both. The Worker's two collectors read only the plan:
 *
 *   explore.js mediaRefsFromPlans      → File Explorer listings and archives
 *   index.js   mediaIdsFromPlansComponent → permanent-delete cleanup
 *
 * So a File Explorer archive came out quietly missing the contour images,
 * and a permanent delete left their bytes in the bucket forever. The second
 * of those is an orphan, not a loss: the omission is on the DELETE side, so
 * nothing still referenced was ever removed. Audit finding 7.
 *
 * Both Worker collectors are now one function, because four collectors that
 * must agree by hand is how they came to disagree. This checks all four
 * against the same canvas.
 */
import worker from '../sync-worker/src/index.js';
import { mediaRefsFromPlans, mediaIdsFromPlans } from '../sync-worker/src/explore.js';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const PLAN = 'pl_plan';
const CONTOUR = 'pl_contour';
const plans = {
  canvases: [
    { id: 'canvas-main', name: 'Main Level',
      plan: { id: PLAN, width: 1200, height: 900 },
      contourLayer: { id: CONTOUR, width: 1200, height: 900,
        createdAt: '2026-10-09T00:00:00.000Z', pointCount: 12,
        areaName: 'Main Level' } },
    { id: 'canvas-bare', name: 'Roof', plan: null, contourLayer: null },
  ],
};

// ---- the listing / archive collector -----------------------------------
const notes = [];
const refs = mediaRefsFromPlans(plans, notes);
const ids = refs.map((r) => r.id);
check('the listing collector returns the floor plan', ids.indexOf(PLAN) >= 0, ids.join(','));
check('and the contour layer beside it', ids.indexOf(CONTOUR) >= 0, ids.join(','));
check('a canvas with neither adds nothing', ids.length === 2, JSON.stringify(ids));
check('the contour ref is labelled for the person reading the listing',
  refs.some((r) => r.id === CONTOUR && /contour/i.test(r.label || '')),
  JSON.stringify(refs.find((r) => r.id === CONTOUR)));
check('and the plan is still labelled as it was',
  refs.some((r) => r.id === PLAN && /floor plan/i.test(r.label || '')),
  JSON.stringify(refs.find((r) => r.id === PLAN)));
check('the id-only wrapper agrees with it',
  JSON.stringify(mediaIdsFromPlans(plans, [])) === JSON.stringify(ids),
  JSON.stringify(mediaIdsFromPlans(plans, [])));

// ---- the permanent-delete collector, through the real Worker ------------
const keyFor = (id) => 'cf/' + id + '/plans.json';
const ID = '44444444-4444-4444-8444-444444444444';

function cabinet() {
  const store = new Map();
  store.set(keyFor(ID), JSON.stringify(plans));
  store.set('cf/' + ID + '/distress.json', JSON.stringify({ pins: [] }));
  store.set('cf/' + ID + '/floor.json', JSON.stringify({ byCanvasId: {} }));
  store.set('cf/' + ID + '/diagnostics.json', JSON.stringify({ figures: [] }));
  // Permanent delete is the back door's second action and only reaches a
  // file already in File Cabinet Trash.
  store.set('cf/' + ID + '/index.json', JSON.stringify({
    id: ID, displayName: 'Contour', deletedAt: '2026-10-20T00:00:00.000Z',
  }));
  store.set('media/' + PLAN, 'plan-bytes');
  store.set('media/' + CONTOUR, 'contour-bytes');
  const deleted = [];
  return {
    store, deleted,
    async get(key) {
      const row = store.get(key);
      if (row === undefined) return null;
      return { etag: 'etag-' + key, httpEtag: '"etag"',
        async json() { return JSON.parse(row); },
        async text() { return row; } };
    },
    async head(key) { return store.has(key) ? { key } : null; },
    async put(key, value) { store.set(key, String(value)); return { key }; },
    async delete(key) {
      const list = Array.isArray(key) ? key : [key];
      list.forEach((k) => { deleted.push(k); store.delete(k); });
    },
    async list() { return { objects: [], truncated: false }; },
  };
}

// The permanent-delete collector is internal, so it is reached the way the
// product reaches it: through the tombstone the Worker writes, which records
// exactly which media ids the delete claimed.
const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
);
const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
publicJwk.kid = 'contour-test'; publicJwk.alg = 'RS256'; publicJwk.use = 'sig';
const b64url = (b) => Buffer.from(b).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const header = b64url(new TextEncoder().encode(
  JSON.stringify({ alg: 'RS256', kid: 'contour-test', typ: 'JWT' })));
const now = Math.floor(Date.now() / 1000);
const payload = b64url(new TextEncoder().encode(JSON.stringify({
  iss: 'https://toolbox-test.cloudflareaccess.com', aud: 'aud-contour-test',
  exp: now + 600, nbf: now - 10, email: 'tim@example.com', sub: 'sub-tim',
})));
const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey,
  new TextEncoder().encode(header + '.' + payload));
const token = header + '.' + payload + '.' + b64url(new Uint8Array(sig));
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/cdn-cgi/access/certs')) {
    return new Response(JSON.stringify({ keys: [publicJwk] }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(url);
};
const env = { CF_ACCESS_TEAM_DOMAIN: 'toolbox-test.cloudflareaccess.com',
  CF_ACCESS_AUD: 'aud-contour-test' };

const bucket = cabinet();
const delRes = await worker.fetch(new Request('https://sync.example/files/' + ID, {
  method: 'DELETE',
  headers: new Headers({ 'Cf-Access-Jwt-Assertion': token,
    'x-toolbox-device-id': 'device-a' }),
}), Object.assign({ CABINET: bucket }, env));
const delBody = await delRes.clone().text();
const deleteRes = { path: 'DELETE files/' + ID, res: delRes };
if (delRes.status !== 200) console.log('   delete said', delRes.status, delBody.slice(0, 160));

const tomb = bucket.store.get('purge/' + ID + '.json');
const tombIds = tomb ? (JSON.parse(tomb).mediaIds || []) : null;
check('a permanent delete was accepted and left a tombstone',
  !!tombIds, deleteRes ? deleteRes.path : 'no route returned 200');
if (tombIds) {
  check('the delete claimed the floor plan', tombIds.indexOf(PLAN) >= 0,
    JSON.stringify(tombIds));
  check('and the contour layer, so its bytes are not orphaned',
    tombIds.indexOf(CONTOUR) >= 0, JSON.stringify(tombIds));
  check('the contour bytes really went',
    !bucket.store.has('media/' + CONTOUR),
    bucket.deleted.join(',') || 'nothing deleted');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
