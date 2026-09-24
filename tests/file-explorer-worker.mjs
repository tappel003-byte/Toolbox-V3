/**
 * Synthetic File Explorer tests. No production bucket.
 * Run: node tests/file-explorer-worker.mjs
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import worker from '../sync-worker/src/index.js';
import { crc32 } from '../sync-worker/src/explore.js';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = 'plan-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const UPLOADED = new Date('2026-03-04T15:06:07.000Z');

const indexBody = JSON.stringify({
  id: ID,
  displayName: 'Mitchell',
  propertyAddress: '10 Oak Street',
  checkout: {
    email: 'tim@example.com',
    deviceId: 'device-a',
    checkedOutAt: '2026-09-01T12:00:00.000Z',
  },
});
const plansBody = JSON.stringify({
  canvases: [
    { name: 'Ground', plan: { id: PLAN_ID, width: 20, height: 10 } },
    { name: 'Empty', plan: null },
  ],
});
const distressBody = JSON.stringify({
  pins: [{
    photos: ['ph_present', 'data:image/jpeg;base64,abc', 'room-note', 'ph_missing', 'ph_../secret'],
  }],
  quickCapture: [{ id: 'ph_quick' }, { id: 'not-a-photo' }],
});
const floorBody = JSON.stringify({ schemaVersion: 1, byCanvasId: {} });
const customerBody = JSON.stringify({ firstName: 'Ada', lastName: 'Mitchell' });
const otherIndexBody = JSON.stringify({
  id: OTHER,
  displayName: 'Keulen',
  propertyAddress: '5 Pine Road',
});
const badIndexBody = JSON.stringify({ id: 'badjson', displayName: 'Unreadable plans' });
const badPlansBody = '{';
const plainIndexBody = JSON.stringify({ id: 'plainindex' });

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const pdf = new TextEncoder().encode('%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function createCabinet(seed) {
  const objects = new Map();
  const ops = [];
  for (const row of seed) {
    const bytes = typeof row.body === 'string' ? new TextEncoder().encode(row.body) : row.body;
    objects.set(row.key, {
      bytes,
      contentType: row.contentType || null,
      uploaded: row.uploaded || UPLOADED,
      etag: row.etag || ('etag-' + row.key),
    });
  }
  function present(key) {
    const row = objects.get(key);
    if (!row) return null;
    ops.push('read ' + key);
    const copy = new Uint8Array(row.bytes);
    return {
      key,
      size: row.bytes.byteLength,
      uploaded: row.uploaded,
      etag: row.etag,
      httpMetadata: row.contentType ? { contentType: row.contentType } : {},
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(copy);
          controller.close();
        },
      }),
      async text() { return new TextDecoder().decode(row.bytes); },
      async json() { return JSON.parse(new TextDecoder().decode(row.bytes)); },
      async arrayBuffer() { return new Uint8Array(row.bytes).buffer; },
    };
  }
  return {
    ops,
    objects,
    async list(opts) {
      const prefix = (opts && opts.prefix) || '';
      ops.push('list ' + prefix);
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      return {
        truncated: false,
        objects: keys.map((key) => {
          const row = objects.get(key);
          return {
            key,
            size: row.bytes.byteLength,
            uploaded: row.uploaded,
            etag: row.etag,
            httpMetadata: row.contentType ? { contentType: row.contentType } : {},
          };
        }),
      };
    },
    async get(key) { return present(key); },
    async head(key) {
      const row = objects.get(key);
      ops.push('head ' + key);
      if (!row) return null;
      return {
        key,
        size: row.bytes.byteLength,
        uploaded: row.uploaded,
        etag: row.etag,
        httpMetadata: row.contentType ? { contentType: row.contentType } : {},
      };
    },
    async put(key) {
      ops.push('put ' + key);
      throw new Error('File Explorer must not put ' + key);
    },
    async delete(key) {
      ops.push('delete ' + key);
      throw new Error('File Explorer must not delete ' + key);
    },
  };
}

function seedCabinet() {
  return createCabinet([
    { key: `cf/${ID}/index.json`, body: indexBody, contentType: 'application/json' },
    { key: `cf/${ID}/plans.json`, body: plansBody, contentType: 'application/json' },
    { key: `cf/${ID}/distress.json`, body: distressBody, contentType: 'application/json' },
    { key: `cf/${ID}/floor.json`, body: floorBody, contentType: 'application/json' },
    { key: `cf/${ID}/customer.json`, body: customerBody, contentType: 'application/json' },
    { key: `cf/${OTHER}/index.json`, body: otherIndexBody, contentType: 'application/json' },
    { key: 'cf/badjson/index.json', body: badIndexBody, contentType: 'application/json' },
    { key: 'cf/badjson/plans.json', body: badPlansBody, contentType: 'application/json' },
    { key: 'cf/plainindex/index.json', body: plainIndexBody, contentType: 'application/json' },
    { key: 'cf/orphan/plans.json', body: plansBody, contentType: 'application/json' },
    { key: `media/${PLAN_ID}`, body: jpeg, contentType: 'image/jpeg' },
    { key: 'media/ph_present', body: jpeg, contentType: 'image/jpeg' },
    { key: 'media/ph_quick', body: pdf, contentType: 'application/pdf' },
    { key: 'media/ph_unreferenced', body: png, contentType: 'image/png' },
    { key: 'media/other-plan', body: jpeg, contentType: 'image/jpeg' },
    { key: `purge/${ID}.json`, body: '{"id":"nope"}', contentType: 'application/json' },
  ]);
}

const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
publicJwk.kid = 'explore-test';
publicJwk.alg = 'RS256';
publicJwk.use = 'sig';

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function signJwt(email) {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid: 'explore-test', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    iss: 'https://toolbox-test.cloudflareaccess.com',
    aud: 'aud-explore-test',
    exp: now + 600,
    nbf: now - 10,
    email: email || 'tim@example.com',
    sub: 'sub-tim',
  })));
  const signingInput = new TextEncoder().encode(header + '.' + payload);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, signingInput);
  return header + '.' + payload + '.' + b64url(new Uint8Array(signature));
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const href = String(url);
  if (href.endsWith('/cdn-cgi/access/certs')) {
    return new Response(JSON.stringify({ keys: [publicJwk] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return realFetch(url);
};

const accessEnv = {
  CF_ACCESS_TEAM_DOMAIN: 'toolbox-test.cloudflareaccess.com',
  CF_ACCESS_AUD: 'aud-explore-test',
};
const token = await signJwt();

async function call(path, cabinet, options) {
  const opts = options || {};
  const headers = new Headers(opts.headers || {});
  if (opts.auth !== false) headers.set('Cf-Access-Jwt-Assertion', opts.token || token);
  const request = new Request('https://sync.example/' + path, {
    method: opts.method || 'GET',
    headers,
  });
  return worker.fetch(request, Object.assign({ CABINET: cabinet }, opts.env || accessEnv));
}

check('crc32 matches the known check value', crc32(new TextEncoder().encode('123456789')) === 0xcbf43926);

const unauth = await call('explore/files', seedCabinet(), { auth: false, env: {} });
check('explore without Access config is unavailable', unauth.status === 503, String(unauth.status));

const missingToken = await call('explore/files', seedCabinet(), { auth: false });
check('explore without a token is unauthorized', missingToken.status === 401, String(missingToken.status));

const cabinet = seedCabinet();
const listed = await call('explore/files', cabinet);
check('index listing is 200', listed.status === 200, String(listed.status));
const listing = await listed.json();
const keys = (listing.files || []).map((row) => row.key).sort();
check('root lists only index.json keys', JSON.stringify(keys) === JSON.stringify([
  `cf/${ID}/index.json`,
  `cf/${OTHER}/index.json`,
  'cf/badjson/index.json',
  'cf/plainindex/index.json',
].sort()), JSON.stringify(keys));
const mitchell = (listing.files || []).find((row) => row.id === ID);
check('display name and address are labels from index.json',
  mitchell && mitchell.displayName === 'Mitchell' && mitchell.propertyAddress === '10 Oak Street');
check('listing does not publish the checkout lease', mitchell && !('checkout' in mitchell));
check('index metadata is the stored type, size, and upload time',
  mitchell && mitchell.contentType === 'application/json' &&
  mitchell.size === new TextEncoder().encode(indexBody).byteLength &&
  mitchell.uploaded === UPLOADED.toISOString());
const plain = (listing.files || []).find((row) => row.id === 'plainindex');
check('an index without a display name does not invent one', plain && !plain.displayName && !plain.propertyAddress);
check('orphan plans.json without an index is not a Customer File row',
  !(listing.files || []).some((row) => row.id === 'orphan' || String(row.key).includes('orphan')));
check('root listing never lists media or purge prefixes',
  cabinet.ops.filter((op) => op.startsWith('list ')).every((op) => op === 'list cf/'));

const opsBeforeDetail = cabinet.ops.length;
const detailResponse = await call(`explore/files/${ID}`, cabinet);
check('customer listing is 200', detailResponse.status === 200, String(detailResponse.status));
const detail = await detailResponse.json();
const objectKeys = (detail.objects || []).map((row) => row.key);
check('customer listing is the stored prefix plus referenced media only', JSON.stringify(objectKeys) === JSON.stringify([
  `cf/${ID}/customer.json`,
  `cf/${ID}/distress.json`,
  `cf/${ID}/floor.json`,
  `cf/${ID}/index.json`,
  `cf/${ID}/plans.json`,
  'media/ph_missing',
  'media/ph_present',
  'media/ph_quick',
  `media/${PLAN_ID}`,
]), JSON.stringify(objectKeys));
const missing = (detail.objects || []).find((row) => row.key === 'media/ph_missing');
check('referenced missing media is visible and has no invented metadata',
  missing && missing.missing === true && !('size' in missing) && !('contentType' in missing) && !('uploaded' in missing));
const quick = (detail.objects || []).find((row) => row.key === 'media/ph_quick');
check('present media keeps its stored content type and size',
  quick && quick.contentType === 'application/pdf' && quick.size === pdf.byteLength && !quick.missing);
check('unreadable-id note is visible', (detail.referenceNotes || []).some((note) => /not a single storage key/.test(note)));
check('detail does not list unreferenced, other-customer, or purge objects',
  !objectKeys.some((key) => key.includes('unreferenced') || key.includes('other-plan') || key.startsWith('purge/')));
const detailOps = cabinet.ops.slice(opsBeforeDetail);
check('detail lists only this customer prefix and referenced media heads',
  detailOps.every((op) => {
    if (op.startsWith('list ')) return op === `list cf/${ID}/`;
    if (op.startsWith('head ')) {
      return ['media/' + PLAN_ID, 'media/ph_present', 'media/ph_quick', 'media/ph_missing'].includes(op.slice(5));
    }
    if (op.startsWith('read ')) return op.startsWith(`read cf/${ID}/`);
    return false;
  }), detailOps.join(' | '));

const badDetail = await call('explore/files/badjson', cabinet);
const badJson = await badDetail.json();
check('unreadable plans.json stays listed and does not invent media',
  badDetail.status === 200 &&
  (badJson.objects || []).some((row) => row.key === 'cf/badjson/plans.json') &&
  !(badJson.objects || []).some((row) => row.key.startsWith('media/')) &&
  (badJson.referenceNotes || []).some((note) => note.includes('plans.json could not be read')));

const orphan = await call('explore/files/orphan', cabinet);
check('a prefix without index.json is not found', orphan.status === 404, String(orphan.status));

const image = await call(`explore/files/${ID}/object?key=${encodeURIComponent('media/ph_present')}`, cabinet);
const imageBytes = new Uint8Array(await image.arrayBuffer());
check('image download returns the stored bytes and content type',
  image.status === 200 &&
  image.headers.get('content-type') === 'image/jpeg' &&
  imageBytes.length === jpeg.length &&
  imageBytes.every((byte, index) => byte === jpeg[index]));
const pdfResponse = await call(`explore/files/${ID}/object?key=${encodeURIComponent('media/ph_quick')}`, cabinet);
check('pdf download keeps the stored pdf content type',
  pdfResponse.status === 200 && pdfResponse.headers.get('content-type') === 'application/pdf');
const jsonResponse = await call(`explore/files/${ID}/object?key=${encodeURIComponent(`cf/${ID}/index.json`)}`, cabinet);
const jsonText = await jsonResponse.text();
check('json download is the stored index text, including its checkout field',
  jsonResponse.status === 200 &&
  jsonResponse.headers.get('content-type') === 'application/json' &&
  jsonText === indexBody);

const missingObject = await call(`explore/files/${ID}/object?key=${encodeURIComponent('media/ph_missing')}`, cabinet);
check('missing media download is not stored and has an empty body',
  missingObject.status === 404 && (await missingObject.text()) === 'Not stored');
const hidden = await call(`explore/files/${ID}/object?key=${encodeURIComponent('media/ph_unreferenced')}`, cabinet);
check('unreferenced media cannot be downloaded through this Customer File', hidden.status === 404);
const otherObject = await call(`explore/files/${ID}/object?key=${encodeURIComponent(`cf/${OTHER}/index.json`)}`, cabinet);
check('another Customer File key cannot be read through this id', otherObject.status === 404);
const purgeObject = await call(`explore/files/${ID}/object?key=${encodeURIComponent(`purge/${ID}.json`)}`, cabinet);
check('purge objects are not readable from File Explorer', purgeObject.status === 404);
const traversal = await call(`explore/files/${encodeURIComponent('../purge')}/object?key=media/ph_present`, cabinet);
check('customer id traversal is rejected', traversal.status === 400 || traversal.status === 404, String(traversal.status));

const archiveResponse = await call(`explore/files/${ID}/archive`, cabinet);
check('archive status is 200 zip', archiveResponse.status === 200 && archiveResponse.headers.get('content-type') === 'application/zip');
const archiveBytes = Buffer.from(await archiveResponse.arrayBuffer());
const dir = mkdtempSync(join(tmpdir(), 'toolbox-explore-'));
const zipPath = join(dir, 'archive.zip');
writeFileSync(zipPath, archiveBytes);
const unzipped = spawnSync('python3', ['-c', `
import zipfile, pathlib, sys
path, dest = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(path) as zf:
    bad = zf.testzip()
    if bad:
        raise SystemExit('crc ' + bad)
    zf.extractall(dest)
    print('\\n'.join(zf.namelist()))
`, zipPath, join(dir, 'out')], { encoding: 'utf8' });
check('zip CRC is valid', unzipped.status === 0, unzipped.status === 0 ? '' : (unzipped.stderr || unzipped.stdout));
const names = (unzipped.stdout || '').trim().split('\n').filter(Boolean).sort();
check('zip paths are the real keys plus missing.txt', JSON.stringify(names) === JSON.stringify([
  `cf/${ID}/customer.json`,
  `cf/${ID}/distress.json`,
  `cf/${ID}/floor.json`,
  `cf/${ID}/index.json`,
  `cf/${ID}/plans.json`,
  `media/${PLAN_ID}`,
  'media/ph_present',
  'media/ph_quick',
  'missing.txt',
].sort()), JSON.stringify(names));
const outDir = join(dir, 'out');
check('zip index bytes match storage', readFileSync(join(outDir, 'cf', ID, 'index.json'), 'utf8') === indexBody);
check('zip plan bytes match storage', Buffer.compare(readFileSync(join(outDir, 'media', PLAN_ID)), Buffer.from(jpeg)) === 0);
check('zip pdf bytes match storage', Buffer.compare(readFileSync(join(outDir, 'media', 'ph_quick')), Buffer.from(pdf)) === 0);
check('missing.txt lists only the absent referenced key',
  readFileSync(join(outDir, 'missing.txt'), 'utf8') === 'media/ph_missing\n');
rmSync(dir, { recursive: true, force: true });

const posted = await call(`explore/files/${ID}`, cabinet, { method: 'POST' });
check('explore does not accept writes', posted.status === 405, String(posted.status));
check('no checkout mutation was written',
  !cabinet.ops.some((op) => op.startsWith('put ') || op.startsWith('delete ')),
  cabinet.ops.filter((op) => op.startsWith('put ') || op.startsWith('delete ')).join(' | '));
check('stored index checkout is unchanged',
  new TextDecoder().decode(cabinet.objects.get(`cf/${ID}/index.json`).bytes) === indexBody);

const failed = results.filter((row) => !row.ok);
if (failed.length) {
  console.error(`\n${failed.length} failed`);
  process.exit(1);
}
console.log(`\n${results.length} passed`);
