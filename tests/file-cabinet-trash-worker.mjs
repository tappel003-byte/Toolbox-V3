/**
 * File Cabinet permanent-delete boundaries. In-memory R2 only.
 * Run: node tests/file-cabinet-trash-worker.mjs
 */
import worker from '../sync-worker/src/index.js';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function createCabinet(seed) {
  const store = Object.create(null);
  const ops = [];
  Object.entries(seed || {}).forEach(function ([key, value]) {
    store[key] = typeof value === 'string' ? value : JSON.stringify(value);
  });
  return {
    ops: ops,
    store: store,
    async get(key) {
      if (!Object.prototype.hasOwnProperty.call(store, key)) return null;
      const body = store[key];
      return {
        etag: 'etag-1',
        async json() { return JSON.parse(body); },
        async text() { return body; },
      };
    },
    async head(key) {
      if (!Object.prototype.hasOwnProperty.call(store, key)) return null;
      return { etag: 'etag-1' };
    },
    async put(key, body) {
      ops.push({ op: 'put', key: key });
      store[key] = String(body);
      return { etag: 'etag-put' };
    },
    async delete(key) {
      ops.push({ op: 'delete', key: key });
      delete store[key];
    },
    async list(options) {
      const prefix = (options && options.prefix) || '';
      const keys = Object.keys(store).filter(function (key) { return key.startsWith(prefix); });
      return {
        objects: keys.map(function (key) { return { key: key }; }),
        truncated: false,
      };
    },
  };
}

function deleteRequest(id) {
  return new Request('https://sync.example/files/' + encodeURIComponent(id), { method: 'DELETE' });
}

async function callDelete(cabinet, id) {
  const before = cabinet.ops.length;
  const response = await worker.fetch(deleteRequest(id), { CABINET: cabinet });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { json = null; }
  return {
    status: response.status,
    text: text,
    json: json,
    ops: cabinet.ops.slice(before),
  };
}

const plans = {
  canvases: [{ plan: { id: 'plan-job' } }, { plan: { id: '../escape' } }],
};
const distress = {
  pins: [{ photos: ['ph_job', 'not-a-photo', 'ph_../no'] }],
  quickCapture: [{ id: 'ph_quick' }, { id: 'not-quick' }],
};
const floor = {
  byCanvasId: {
    'canvas-job': { recoveryPdfMediaId: 'fsrec_canvas-job' },
    bad: { recoveryPdfMediaId: 'fsrec_../no' },
    other: { recoveryPdfMediaId: 'not-a-pdf' },
  },
};
const diagnostics = {
  figures: [
    { id: 'dxf_job', mediaId: 'dxfig_job' },
    { id: 'dxf_bad', mediaId: 'dxfig_../no' },
    { id: 'dxf_other', mediaId: 'not-a-figure' },
  ],
};

const cabinet = createCabinet({
  'cf/job/index.json': { id: 'job', deletedAt: '2026-01-01T00:00:00.000Z' },
  'cf/job/plans.json': plans,
  'cf/job/distress.json': distress,
  'cf/job/floor.json': floor,
  'cf/job/diagnostics.json': diagnostics,
  'cf/job/report.json': { updatedAt: '2026-02-01T00:00:00.000Z' },
  'cf/job/customer.json': { firstName: 'Ada' },
  'media/plan-job': 'plan-bytes',
  'media/ph_job': 'photo-bytes',
  'media/ph_quick': 'quick-bytes',
  'media/fsrec_canvas-job': 'pdf-bytes',
  'media/dxfig_job': 'figure-bytes',
  'media/other-plan': 'keep-me',
  'cf/baddiagnostics/index.json': { id: 'baddiagnostics', deletedAt: '2026-01-04T00:00:00.000Z' },
  'cf/baddiagnostics/diagnostics.json': '{',
  'media/dxfig_baddiagnostics': 'figure-bytes',
  'cf/badfloor/index.json': { id: 'badfloor', deletedAt: '2026-01-03T00:00:00.000Z' },
  'cf/badfloor/floor.json': '{',
  'media/fsrec_badfloor': 'pdf-bytes',
  'cf/leased/index.json': {
    id: 'leased',
    deletedAt: '2026-01-02T00:00:00.000Z',
    checkout: {
      email: 'lee@example.com',
      deviceId: 'device-lee',
      checkedOutAt: '2026-09-01T00:00:00.000Z',
    },
  },
  'cf/leased/plans.json': { canvases: [{ plan: { id: 'plan-leased' } }] },
  'media/plan-leased': 'leased-bytes',
  'cf/stub/index.json': { id: 'stub' },
  'cf/stub/customer.json': { firstName: '' },
  'cf/corrupt/index.json': { id: 'corrupt' },
  'cf/corrupt/plans.json': '{',
  'media/plan-corrupt': 'corrupt-bytes',
});

const leased = await callDelete(cabinet, 'leased');
check(
  'DELETE refuses an active checkout and deletes nothing',
  leased.status === 403 &&
    /checked out/i.test(leased.text) &&
    leased.ops.length === 0 &&
    cabinet.store['media/plan-leased'] === 'leased-bytes' &&
    cabinet.store['cf/leased/index.json'] &&
    !cabinet.store['purge/leased.json'],
  JSON.stringify({ status: leased.status, ops: leased.ops, text: leased.text }),
);

const corrupt = await callDelete(cabinet, 'corrupt');
check(
  'DELETE stops when referenced component JSON cannot be read',
  corrupt.status === 500 &&
    corrupt.ops.length === 0 &&
    cabinet.store['media/plan-corrupt'] === 'corrupt-bytes' &&
    !cabinet.store['purge/corrupt.json'],
  JSON.stringify({ status: corrupt.status, ops: corrupt.ops, text: corrupt.text }),
);

const badFloor = await callDelete(cabinet, 'badfloor');
check(
  'DELETE stops when the Floor Survey component cannot be read',
  badFloor.status === 500 &&
    /Floor Survey/i.test(badFloor.text) &&
    badFloor.ops.length === 0 &&
    cabinet.store['media/fsrec_badfloor'] === 'pdf-bytes' &&
    !cabinet.store['purge/badfloor.json'],
  JSON.stringify({ status: badFloor.status, ops: badFloor.ops, text: badFloor.text }),
);

const badDiagnostics = await callDelete(cabinet, 'baddiagnostics');
check(
  'DELETE stops when the Diagnostics component cannot be read',
  badDiagnostics.status === 500 &&
    /Diagnostics/i.test(badDiagnostics.text) &&
    badDiagnostics.ops.length === 0 &&
    cabinet.store['media/dxfig_baddiagnostics'] === 'figure-bytes' &&
    !cabinet.store['purge/baddiagnostics.json'],
  JSON.stringify({ status: badDiagnostics.status, ops: badDiagnostics.ops, text: badDiagnostics.text }),
);

const purged = await callDelete(cabinet, 'job');
const tomb = cabinet.store['purge/job.json'] ? JSON.parse(cabinet.store['purge/job.json']) : null;
const tombPut = purged.ops.findIndex(function (op) { return op.op === 'put' && op.key === 'purge/job.json'; });
const mediaDelete = purged.ops.findIndex(function (op) { return op.op === 'delete' && op.key === 'media/plan-job'; });
const photoDelete = purged.ops.findIndex(function (op) { return op.op === 'delete' && op.key === 'media/ph_job'; });
const prefixDelete = purged.ops.findIndex(function (op) { return op.op === 'delete' && op.key === 'cf/job/index.json'; });
check(
  'DELETE writes the tombstone, then deletes referenced media, then the cabinet prefix',
  purged.status === 200 &&
    tomb &&
    tomb.reason === 'permanent-delete' &&
    Array.isArray(tomb.mediaIds) &&
    tomb.mediaIds.indexOf('plan-job') !== -1 &&
    tomb.mediaIds.indexOf('ph_job') !== -1 &&
    tomb.mediaIds.indexOf('ph_quick') !== -1 &&
    tomb.mediaIds.indexOf('fsrec_canvas-job') !== -1 &&
    tomb.mediaIds.indexOf('dxfig_job') !== -1 &&
    tomb.mediaIds.indexOf('not-quick') === -1 &&
    tomb.mediaIds.indexOf('fsrec_../no') === -1 &&
    tomb.mediaIds.indexOf('dxfig_../no') === -1 &&
    tomb.mediaIds.indexOf('not-a-pdf') === -1 &&
    tomb.mediaIds.indexOf('not-a-figure') === -1 &&
    tomb.mediaIds.indexOf('../escape') === -1 &&
    tomb.mediaIds.indexOf('not-a-photo') === -1 &&
    tombPut !== -1 &&
    mediaDelete > tombPut &&
    photoDelete > tombPut &&
    prefixDelete > mediaDelete &&
    !cabinet.store['media/plan-job'] &&
    !cabinet.store['media/ph_job'] &&
    !cabinet.store['media/ph_quick'] &&
    !cabinet.store['media/fsrec_canvas-job'] &&
    !cabinet.store['media/dxfig_job'] &&
    !cabinet.store['cf/job/floor.json'] &&
    !cabinet.store['cf/job/diagnostics.json'] &&
    !cabinet.store['cf/job/report.json'] &&
    cabinet.store['media/other-plan'] === 'keep-me' &&
    cabinet.store['media/fsrec_badfloor'] === 'pdf-bytes' &&
    cabinet.store['media/plan-leased'] === 'leased-bytes' &&
    !cabinet.store['cf/job/index.json'] &&
    !cabinet.store['cf/job/plans.json'] &&
    !cabinet.store['cf/job/distress.json'],
  JSON.stringify({ status: purged.status, ops: purged.ops, tomb: tomb }),
);

const stub = await callDelete(cabinet, 'stub');
check(
  'Empty-stub DELETE still tombstones without touching unrelated media',
  stub.status === 200 &&
    !!cabinet.store['purge/stub.json'] &&
    !cabinet.store['cf/stub/index.json'] &&
    cabinet.store['media/other-plan'] === 'keep-me',
  JSON.stringify({ status: stub.status, ops: stub.ops }),
);

const again = await callDelete(cabinet, 'job');
const retryTomb = cabinet.store['purge/job.json'] ? JSON.parse(cabinet.store['purge/job.json']) : null;
check(
  'A repeated DELETE keeps the tombstone and does not remove unrelated media',
  again.status === 200 &&
    retryTomb &&
    retryTomb.purgedAt === tomb.purgedAt &&
    retryTomb.mediaIds.indexOf('plan-job') !== -1 &&
    cabinet.store['media/other-plan'] === 'keep-me',
  JSON.stringify({ status: again.status, tomb: retryTomb }),
);

const failed = results.filter(function (result) { return !result.ok; });
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) process.exit(1);
