/**
 * Focused R2 ETag conditional-write tests for checkout acquire/release.
 * Run: node tests/r2-checkout-etag.mjs
 *
 * Mirrors Worker acquireCheckout / releaseCheckout safety rules:
 * - onlyIf.etagMatches uses object.etag (never httpEtag)
 * - missing ETag fails safely (no unconditional put)
 * - failed precondition cannot acquire ownership
 */
import { requireObjectEtag, conditionalPutOptions } from '../sync-worker/src/r2-conditional.js';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function sameCheckoutOwner(checkout, identity, deviceId) {
  return !!(
    checkout &&
    normalizeEmail(checkout.email) === normalizeEmail(identity && identity.email) &&
    String(checkout.deviceId || '') === String(deviceId || '')
  );
}

function checkoutPayload(identity, deviceId) {
  return {
    email: normalizeEmail(identity.email),
    sub: identity.sub || '',
    deviceId: String(deviceId || ''),
    checkedOutAt: '2026-09-22T20:00:00.000Z',
  };
}

/** Minimal R2 mock that enforces etagMatches and never auto-supplies etag from httpEtag. */
function createMockCabinet(seed) {
  const store = Object.create(null);
  let puts = [];
  for (const [key, value] of Object.entries(seed || {})) {
    store[key] = {
      body: typeof value.body === 'string' ? value.body : JSON.stringify(value.body),
      etag: value.etag,
      httpEtag: value.httpEtag,
    };
  }
  return {
    puts,
    async get(key) {
      const row = store[key];
      if (!row) return null;
      return {
        etag: row.etag,
        httpEtag: row.httpEtag,
        async json() {
          return JSON.parse(row.body);
        },
      };
    },
    async put(key, body, opts) {
      puts.push({ key, opts: opts ? JSON.parse(JSON.stringify(opts)) : opts });
      const onlyIf = opts && opts.onlyIf;
      if (!onlyIf || typeof onlyIf.etagMatches !== 'string' || !onlyIf.etagMatches.trim()) {
        // Safety: Worker must never call put without etagMatches. Track as unconditional.
        puts[puts.length - 1].unconditional = true;
        store[key] = {
          body: String(body),
          etag: 'etag-after-unconditional',
          httpEtag: '"etag-after-unconditional"',
        };
        return { etag: 'etag-after-unconditional' };
      }
      const current = store[key];
      if (!current || current.etag !== onlyIf.etagMatches) {
        return null; // precondition failed
      }
      const nextEtag = 'etag-' + (puts.length + 1);
      store[key] = {
        body: String(body),
        etag: nextEtag,
        httpEtag: '"' + nextEtag + '"',
      };
      return { etag: nextEtag };
    },
    snapshot(key) {
      const row = store[key];
      return row ? { etag: row.etag, httpEtag: row.httpEtag, body: JSON.parse(row.body) } : null;
    },
  };
}

async function acquireCheckout(env, id, identity, deviceId) {
  const key = 'files/' + id + '/index.json';
  const got = await env.CABINET.get(key);
  if (!got) return { status: 404 };

  const etag = requireObjectEtag(got);
  if (!etag) {
    return { status: 500, message: 'Missing object ETag; refusing unsafe checkout acquire' };
  }

  let index;
  try {
    index = await got.json();
  } catch (_) {
    return { status: 500, message: 'Corrupt Customer File index' };
  }

  const existing = index.checkout || null;
  if (existing && existing.deviceId && normalizeEmail(existing.email)) {
    if (sameCheckoutOwner(existing, identity, deviceId)) {
      return { status: 200, index: index, idempotent: true };
    }
    return {
      status: 409,
      message: 'Customer File is checked out by another user or device',
      checkout: existing,
    };
  }

  const next = Object.assign({}, index, {
    checkout: checkoutPayload(identity, deviceId),
  });

  const putOpts = conditionalPutOptions(etag, { contentType: 'application/json' });
  if (!putOpts) {
    return { status: 500, message: 'Missing object ETag; refusing unsafe checkout acquire' };
  }

  const putResult = await env.CABINET.put(key, JSON.stringify(next), putOpts);
  if (putResult === null) {
    const again = await env.CABINET.get(key);
    if (!again) return { status: 404 };
    let latest;
    try { latest = await again.json(); } catch (_) { latest = null; }
    if (latest && sameCheckoutOwner(latest.checkout, identity, deviceId)) {
      return { status: 200, index: latest, idempotent: true };
    }
    return {
      status: 409,
      message: 'Customer File checkout changed during acquire',
      checkout: latest && latest.checkout ? latest.checkout : null,
    };
  }

  return { status: 200, index: next, idempotent: false };
}

async function releaseCheckout(env, id, identity, deviceId) {
  const key = 'files/' + id + '/index.json';
  const got = await env.CABINET.get(key);
  if (!got) return { status: 404 };

  const etag = requireObjectEtag(got);
  if (!etag) {
    return { status: 500, message: 'Missing object ETag; refusing unsafe checkout release' };
  }

  let index;
  try {
    index = await got.json();
  } catch (_) {
    return { status: 500, message: 'Corrupt Customer File index' };
  }

  const existing = index.checkout || null;
  if (!existing || !existing.deviceId) {
    return { status: 200, index: index, released: false };
  }
  if (!sameCheckoutOwner(existing, identity, deviceId)) {
    return {
      status: 403,
      message: 'Only the checkout owner can release this lease',
      checkout: existing,
    };
  }

  const next = Object.assign({}, index);
  delete next.checkout;

  const putOpts = conditionalPutOptions(etag, { contentType: 'application/json' });
  if (!putOpts) {
    return { status: 500, message: 'Missing object ETag; refusing unsafe checkout release' };
  }

  const putResult = await env.CABINET.put(key, JSON.stringify(next), putOpts);
  if (putResult === null) {
    return { status: 409, message: 'Customer File checkout changed during release' };
  }
  return { status: 200, index: next, released: true };
}

const identity = { email: 'tim@example.com', sub: 'sub-tim' };
const freeIndex = {
  id: 'cf-1',
  displayName: 'Cloud Job',
  updatedAt: '2026-02-01T00:00:00.000Z',
};

// --- Helper unit checks ---
{
  const fromEtag = requireObjectEtag({ etag: 'abc123', httpEtag: '"ignored"' });
  check('requireObjectEtag uses object.etag', fromEtag === 'abc123');

  const httpOnly = requireObjectEtag({ httpEtag: '"quoted-only"' });
  check('requireObjectEtag ignores httpEtag-only objects', httpOnly === null);

  const empty = requireObjectEtag({ etag: '   ' });
  check('requireObjectEtag rejects blank etag', empty === null);

  const opts = conditionalPutOptions('abc123', { contentType: 'application/json' });
  check(
    'conditionalPutOptions always sets onlyIf.etagMatches',
    !!(opts && opts.onlyIf && opts.onlyIf.etagMatches === 'abc123' && !opts.unconditional),
    JSON.stringify(opts),
  );

  const noOpts = conditionalPutOptions(null);
  check('conditionalPutOptions returns null when ETag missing', noOpts === null);

  const blankOpts = conditionalPutOptions('  ');
  check('conditionalPutOptions returns null for blank ETag', blankOpts === null);
}

// --- Acquire: valid conditional write ---
{
  const cabinet = createMockCabinet({
    'files/cf-1/index.json': { body: freeIndex, etag: 'etag-v1', httpEtag: '"etag-v1"' },
  });
  const result = await acquireCheckout({ CABINET: cabinet }, 'cf-1', identity, 'device-ipad');
  const put = cabinet.puts[0];
  check('acquire uses etagMatches conditional put', result.status === 200 && !result.idempotent);
  check(
    'acquire onlyIf uses object.etag (not httpEtag quoting)',
    !!(put && put.opts && put.opts.onlyIf && put.opts.onlyIf.etagMatches === 'etag-v1'),
    JSON.stringify(put && put.opts),
  );
  check('acquire never performs unconditional put', !(put && put.unconditional));
  check(
    'acquire records checkout owner',
    !!(result.index && result.index.checkout &&
      result.index.checkout.deviceId === 'device-ipad' &&
      result.index.checkout.email === 'tim@example.com'),
  );
}

// --- Acquire: failed ETag precondition cannot acquire ---
{
  const freeOnGet = createMockCabinet({
    'files/cf-1/index.json': { body: freeIndex, etag: 'etag-stale', httpEtag: '"etag-stale"' },
  });
  const originalPut = freeOnGet.put.bind(freeOnGet);
  freeOnGet.put = async (key, body, opts) => {
    freeOnGet.puts.push({ key, opts: opts ? JSON.parse(JSON.stringify(opts)) : opts });
    // Plant competing checkout, then return null like R2 precondition failure.
    const competing = Object.assign({}, freeIndex, {
      checkout: {
        email: 'lee@example.com',
        sub: 'sub-lee',
        deviceId: 'device-lee',
        checkedOutAt: '2026-09-22T19:00:00.000Z',
      },
    });
    await originalPut(key, JSON.stringify(competing), {
      httpMetadata: { contentType: 'application/json' },
      onlyIf: { etagMatches: 'etag-stale' },
    });
    return null;
  };

  const failed = await acquireCheckout({ CABINET: freeOnGet }, 'cf-1', identity, 'device-ipad');
  check(
    'failed ETag precondition cannot acquire ownership',
    failed.status === 409 &&
      !(failed.index && failed.index.checkout && failed.index.checkout.deviceId === 'device-ipad') &&
      failed.checkout && failed.checkout.deviceId === 'device-lee',
    JSON.stringify(failed),
  );
  check(
    'failed precondition still used conditional onlyIf',
    freeOnGet.puts.some((p) => p.opts && p.opts.onlyIf && p.opts.onlyIf.etagMatches === 'etag-stale'),
  );
}

// --- Acquire: missing ETag fails safely ---
{
  const noEtag = createMockCabinet({
    'files/cf-1/index.json': {
      body: freeIndex,
      etag: undefined,
      httpEtag: '"http-only-quote"',
    },
  });
  const result = await acquireCheckout({ CABINET: noEtag }, 'cf-1', identity, 'device-ipad');
  check(
    'missing ETag fails safely on acquire (no unconditional put)',
    result.status === 500 && /Missing object ETag/i.test(result.message || '') && noEtag.puts.length === 0,
    JSON.stringify({ result, puts: noEtag.puts }),
  );
  check(
    'httpEtag alone does not authorize acquire write',
    result.status === 500 && noEtag.puts.length === 0,
  );
}

// --- Release: missing ETag fails safely ---
{
  const leased = Object.assign({}, freeIndex, {
    checkout: checkoutPayload(identity, 'device-ipad'),
  });
  const noEtag = createMockCabinet({
    'files/cf-1/index.json': {
      body: leased,
      etag: '',
      httpEtag: '"still-present"',
    },
  });
  const result = await releaseCheckout({ CABINET: noEtag }, 'cf-1', identity, 'device-ipad');
  check(
    'release fails safely when required ETag unavailable',
    result.status === 500 && /Missing object ETag/i.test(result.message || '') && noEtag.puts.length === 0,
    JSON.stringify({ result, puts: noEtag.puts }),
  );
  const still = noEtag.snapshot('files/cf-1/index.json');
  check(
    'release without ETag leaves lease unchanged',
    !!(still && still.body.checkout && still.body.checkout.deviceId === 'device-ipad'),
  );
}

// --- Idempotency + competing device ---
{
  const leased = Object.assign({}, freeIndex, {
    checkout: checkoutPayload(identity, 'device-ipad'),
  });
  const cabinet = createMockCabinet({
    'files/cf-1/index.json': { body: leased, etag: 'etag-owned', httpEtag: '"etag-owned"' },
  });
  const same = await acquireCheckout({ CABINET: cabinet }, 'cf-1', identity, 'device-ipad');
  check(
    'same-user/same-device acquire remains idempotent',
    same.status === 200 && same.idempotent === true && cabinet.puts.length === 0,
    JSON.stringify(same),
  );

  const otherDevice = await acquireCheckout({ CABINET: cabinet }, 'cf-1', identity, 'device-phone');
  check(
    'competing device remains refused',
    otherDevice.status === 409 && otherDevice.checkout && otherDevice.checkout.deviceId === 'device-ipad',
    JSON.stringify(otherDevice),
  );

  const otherUser = await acquireCheckout(
    { CABINET: cabinet },
    'cf-1',
    { email: 'lee@example.com', sub: 'sub-lee' },
    'device-lee',
  );
  check(
    'competing user remains refused',
    otherUser.status === 409 && otherUser.checkout && otherUser.checkout.email === 'tim@example.com',
    JSON.stringify(otherUser),
  );
}

// --- Successful release uses conditional etag ---
{
  const leased = Object.assign({}, freeIndex, {
    checkout: checkoutPayload(identity, 'device-ipad'),
  });
  const cabinet = createMockCabinet({
    'files/cf-1/index.json': { body: leased, etag: 'etag-rel', httpEtag: '"etag-rel"' },
  });
  const result = await releaseCheckout({ CABINET: cabinet }, 'cf-1', identity, 'device-ipad');
  const put = cabinet.puts[0];
  check('release succeeds with conditional etagMatches', result.status === 200 && result.released === true);
  check(
    'release onlyIf uses object.etag',
    !!(put && put.opts && put.opts.onlyIf && put.opts.onlyIf.etagMatches === 'etag-rel'),
    JSON.stringify(put && put.opts),
  );
  check('release never unconditional', !(put && put.unconditional));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
