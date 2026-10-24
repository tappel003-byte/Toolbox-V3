/**
 * Toolbox Sync API — File Cabinet + selective local + exclusive Check Out foundation.
 * Worker + private R2. Protect with Cloudflare Access on this Worker hostname only.
 * Do not put the static Toolbox PWA behind Access.
 *
 * Identity: verified Cloudflare Access JWT (Cf-Access-Jwt-Assertion).
 * Requires env.CF_ACCESS_TEAM_DOMAIN and env.CF_ACCESS_AUD (secret).
 * Do not trust unverified convenience email headers.
 */

import {
  requireObjectEtag,
  conditionalPutOptions,
  createOnlyPutOptions,
} from './r2-conditional.js';
import { exploreResult, mediaRefsFromPlans } from './explore.js';
import {
  revField,
  revMs,
  canonicalRev,
  bodyRevisionMs,
  legacyComponentKey,
  candidateComponentKey,
  newCandidateToken,
  resolveAcceptedComponent,
  legacyIsStale,
  applyServerOwnedIndexFields,
  nextSeq,
  stampAuthority,
  authorityOf,
} from './components.js';

/** PWA origin only — Access cookie sync uses credentials:include (no *). */
const ALLOWED_ORIGINS = {
  'https://sandiageotoolbox.com': true,
};

function corsHeaders(request) {
  const origin = (request && request.headers && request.headers.get('Origin')) || '';
  const headers = {
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-toolbox-encoding, x-toolbox-device-id',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && ALLOWED_ORIGINS[origin]) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Vary'] = 'Origin';
  }
  return headers;
}

function json(request, data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, corsHeaders(request)),
  });
}

function text(request, body, status) {
  return new Response(body, {
    status: status || 200,
    headers: Object.assign({ 'content-type': 'text/plain; charset=utf-8' }, corsHeaders(request)),
  });
}

function notFound(request) {
  return text(request, 'Not found', 404);
}

function badRequest(request, message) {
  return text(request, message || 'Bad request', 400);
}

function conflict(request, message) {
  return text(request, message || 'Conflict', 409);
}

function forbidden(request, message) {
  return text(request, message || 'Forbidden', 403);
}

function serviceUnavailable(request, message) {
  return text(request, message || 'Service unavailable', 503);
}

function unauthorized(request, message) {
  return text(request, message || 'Unauthorized', 401);
}

function indexKey(id) {
  return 'cf/' + id + '/index.json';
}

// The LEGACY key: where a component lived before acceptance references
// existed, and what resolveAcceptedComponent falls back to when an index
// carries no reference. Never written again by the component route.
function componentKey(id, name) {
  return legacyComponentKey(id, name);
}

function mediaKey(mediaId) {
  return 'media/' + mediaId;
}

function purgeKey(id) {
  return 'purge/' + id + '.json';
}

const COMPONENT_NAMES = {
  customer: true,
  plans: true,
  distress: true,
  floor: true,
  diagnostics: true,
  report: true,
  trash: true,
};

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function trimStr(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sameCheckoutOwner(checkout, identity, deviceId) {
  if (!checkout || !identity) return false;
  const email = normalizeEmail(checkout.email);
  const device = trimStr(checkout.deviceId);
  return !!email && !!device &&
    email === normalizeEmail(identity.email) &&
    device === trimStr(deviceId);
}

function checkoutPayload(identity, deviceId, previous) {
  return {
    email: normalizeEmail(identity.email),
    sub: typeof identity.sub === 'string' ? identity.sub : '',
    deviceId: trimStr(deviceId),
    checkedOutAt: (previous && previous.checkedOutAt) || new Date().toISOString(),
  };
}

/**
 * Who the job was taken from, kept on the lease that took it.
 *
 * A Take Over is the one way a lease changes hands without the holder
 * agreeing, so it leaves a record of whose it was. Nothing reads this to
 * make a decision -- the lease itself is the decision -- it is there so the
 * Cabinet can say what happened.
 */
function takenOverFrom(previous) {
  if (!previous) return null;
  return {
    email: normalizeEmail(previous.email),
    deviceId: trimStr(previous.deviceId),
    checkedOutAt: trimStr(previous.checkedOutAt),
    takenAt: new Date().toISOString(),
  };
}

/* ---- Access JWT verification (Web Crypto; no convenience headers) ---- */

let cachedJwks = null;
let cachedJwksAt = 0;

function accessConfigReady(env) {
  return !!(env && trimStr(env.CF_ACCESS_TEAM_DOMAIN) && trimStr(env.CF_ACCESS_AUD));
}

function accessIssuer(env) {
  const team = trimStr(env.CF_ACCESS_TEAM_DOMAIN).replace(/^https?:\/\//, '').replace(/\/$/, '');
  return 'https://' + team;
}

async function fetchAccessJwks(env) {
  const now = Date.now();
  if (cachedJwks && (now - cachedJwksAt) < 3600000) return cachedJwks;
  const issuer = accessIssuer(env);
  const response = await fetch(issuer + '/cdn-cgi/access/certs');
  if (!response.ok) throw new Error('Unable to fetch Access JWKS');
  cachedJwks = await response.json();
  cachedJwksAt = now;
  return cachedJwks;
}

function b64urlToBytes(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseJwtParts(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  return { header: header, payload: payload, signingInput: parts[0] + '.' + parts[1], signature: parts[2] };
}

async function importAccessKey(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

function audienceMatches(claimAud, expected) {
  const want = trimStr(expected);
  if (!want) return false;
  if (typeof claimAud === 'string') return claimAud === want;
  if (Array.isArray(claimAud)) return claimAud.indexOf(want) !== -1;
  return false;
}

async function verifyAccessJwt(request, env) {
  if (!accessConfigReady(env)) {
    const err = new Error('Access identity is not configured (CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD)');
    err.code = 'config';
    throw err;
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) {
    const err = new Error('Missing Access token');
    err.code = 'auth';
    throw err;
  }

  const parsed = parseJwtParts(token);
  if (parsed.header.alg !== 'RS256') {
    const err = new Error('Unsupported Access token algorithm');
    err.code = 'auth';
    throw err;
  }

  const issuer = accessIssuer(env);
  if (parsed.payload.iss !== issuer) {
    const err = new Error('Access token issuer mismatch');
    err.code = 'auth';
    throw err;
  }
  if (!audienceMatches(parsed.payload.aud, env.CF_ACCESS_AUD)) {
    const err = new Error('Access token audience mismatch');
    err.code = 'auth';
    throw err;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof parsed.payload.exp === 'number' && parsed.payload.exp < nowSec) {
    const err = new Error('Access token expired');
    err.code = 'auth';
    throw err;
  }
  if (typeof parsed.payload.nbf === 'number' && parsed.payload.nbf > nowSec + 5) {
    const err = new Error('Access token not yet valid');
    err.code = 'auth';
    throw err;
  }

  const jwks = await fetchAccessJwks(env);
  const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
  const jwk = keys.find(function (k) { return k.kid && k.kid === parsed.header.kid; }) || keys[0];
  if (!jwk) {
    const err = new Error('No Access signing key available');
    err.code = 'auth';
    throw err;
  }

  const key = await importAccessKey(jwk);
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(parsed.signature),
    new TextEncoder().encode(parsed.signingInput),
  );
  if (!ok) {
    const err = new Error('Access token signature invalid');
    err.code = 'auth';
    throw err;
  }

  const email = normalizeEmail(parsed.payload.email);
  if (!email) {
    const err = new Error('Access token has no email');
    err.code = 'auth';
    throw err;
  }
  return {
    email: email,
    sub: typeof parsed.payload.sub === 'string' ? parsed.payload.sub : '',
  };
}

async function requireIdentity(request, env) {
  try {
    return await verifyAccessJwt(request, env);
  } catch (err) {
    if (err && err.code === 'config') {
      return { errorResponse: serviceUnavailable(request, err.message) };
    }
    return { errorResponse: unauthorized(request, (err && err.message) || 'Unauthorized') };
  }
}

function requestDeviceId(request) {
  return trimStr(request.headers.get('x-toolbox-device-id'));
}

/* ---- R2 cabinet helpers ---- */

async function listIndexes(env) {
  const files = [];
  let cursor;
  for (;;) {
    const listed = await env.CABINET.list(cursor ? { prefix: 'cf/', cursor: cursor } : { prefix: 'cf/' });
    for (const obj of listed.objects || []) {
      if (!obj.key.endsWith('/index.json')) continue;
      const got = await env.CABINET.get(obj.key);
      if (!got) continue;
      try {
        files.push(await got.json());
      } catch (_) {}
    }
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }
  return files;
}

async function listPurges(env) {
  const purged = [];
  let cursor;
  for (;;) {
    const listed = await env.CABINET.list(cursor ? { prefix: 'purge/', cursor: cursor } : { prefix: 'purge/' });
    for (const obj of listed.objects || []) {
      if (!obj.key.endsWith('.json')) continue;
      const got = await env.CABINET.get(obj.key);
      if (!got) continue;
      try {
        const body = await got.json();
        if (body && body.id) purged.push(body);
        else {
          const id = obj.key.slice('purge/'.length, -'.json'.length);
          if (id) purged.push({ id: id, purgedAt: null });
        }
      } catch (_) {
        const id = obj.key.slice('purge/'.length, -'.json'.length);
        if (id) purged.push({ id: id, purgedAt: null });
      }
    }
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }
  return purged;
}

function safeMediaId(id) {
  return typeof id === 'string' &&
    !!id &&
    id.indexOf('/') === -1 &&
    id.indexOf('\\') === -1 &&
    id.indexOf('..') === -1;
}

// The same collector File Explorer lists and archives with, so a permanent
// delete removes exactly what an archive would have contained -- the floor
// plan AND the contour layer drawn from the readings. Reading only the plan
// here left the contour bytes orphaned in the bucket on every permanent
// delete. Audit finding 7.
function mediaIdsFromPlansComponent(plans) {
  return mediaRefsFromPlans(plans, [])
    .map(function (ref) { return ref && ref.id; })
    .filter(function (id) { return safeMediaId(id); });
}

function mediaIdsFromDiagnosticsComponent(diagnostics) {
  const figures = diagnostics && Array.isArray(diagnostics.figures) ? diagnostics.figures : [];
  const ids = [];
  figures.forEach(function (fig) {
    const id = fig && fig.mediaId;
    if (safeMediaId(id) && id.indexOf('dxfig_') === 0) ids.push(id);
  });
  return ids;
}

function mediaIdsFromFloorComponent(floor) {
  const layers = floor && floor.byCanvasId && typeof floor.byCanvasId === 'object' ? floor.byCanvasId : {};
  const ids = [];
  Object.keys(layers).forEach(function (key) {
    const id = layers[key] && layers[key].recoveryPdfMediaId;
    if (safeMediaId(id) && id.indexOf('fsrec_') === 0) ids.push(id);
  });
  return ids;
}

function mediaIdsFromDistressComponent(distress) {
  const pins = distress && Array.isArray(distress.pins) ? distress.pins : [];
  const ids = [];
  pins.forEach(function (pin) {
    const photos = pin && Array.isArray(pin.photos) ? pin.photos : [];
    photos.forEach(function (id) {
      if (safeMediaId(id) && id.indexOf('ph_') === 0) ids.push(id);
    });
  });
  const quick = distress && Array.isArray(distress.quickCapture) ? distress.quickCapture : [];
  quick.forEach(function (item) {
    const id = item && item.id;
    if (safeMediaId(id) && id.indexOf('ph_') === 0) ids.push(id);
  });
  return ids;
}

function uniqueMediaIds(ids) {
  const seen = Object.create(null);
  const out = [];
  (ids || []).forEach(function (id) {
    if (!safeMediaId(id) || seen[id]) return;
    seen[id] = true;
    out.push(id);
  });
  return out;
}

async function readStoredJson(object) {
  if (!object) return { missing: true, body: null };
  try {
    return { missing: false, body: await object.json() };
  } catch (_) {
    return { missing: false, corrupt: true, body: null };
  }
}

/**
 * Plan, Distress, Floor Survey recovery-PDF, and Diagnostics figure bytes
 * referenced by this Customer File.
 * Stops before any delete when a present component cannot be read.
 */
async function referencedMediaIds(env, id, fencedIndex) {
  // Through the SAME resolution a component GET uses. A purge that read the
  // legacy key while the index named a candidate would have looked for
  // photographs in a version the owner had already replaced -- and left the
  // real ones behind as orphans no listing names.
  //
  // When a fenced index snapshot is supplied, use THAT accepted-reference
  // map. Do not re-read a potentially different version after the deleting
  // fence has already won.
  let indexBody = fencedIndex;
  if (indexBody === undefined) {
    const indexRead = await readStoredJson(await env.CABINET.get(indexKey(id)));
    if (indexRead.corrupt) {
      return { error: 'Corrupt Customer File index; refusing permanent delete' };
    }
    indexBody = indexRead.body;
  }
  const readComponent = async function (name, label) {
    const resolved = resolveAcceptedComponent(indexBody, id, name);
    const read = await readStoredJson(await env.CABINET.get(resolved.key));
    if (read.corrupt) {
      return { error: label + ' component is unreadable; refusing permanent delete' };
    }
    // A reference naming an object that is not there means the component's
    // media cannot be enumerated. Deleting on top of that would strand the
    // photographs it referenced, so it stops instead.
    if (read.missing && resolved.from === 'accepted') {
      return { error: label + ' component is missing from storage; refusing permanent delete' };
    }
    // Deleting against a component the index does not vouch for would delete
    // the wrong photographs and strand the right ones.
    if (!read.missing && resolved.from === 'legacy' &&
        legacyIsStale(indexBody, name, read.body)) {
      return { error: 'Stored ' + label + ' is older than the revision the index advertises; refusing permanent delete' };
    }
    return read;
  };
  const plansRead = await readComponent('plans', 'Plans');
  if (plansRead.error) return { error: plansRead.error };
  const distressRead = await readComponent('distress', 'Distress');
  if (distressRead.error) return { error: distressRead.error };
  const floorRead = await readComponent('floor', 'Floor Survey');
  if (floorRead.error) return { error: floorRead.error };
  const diagnosticsRead = await readComponent('diagnostics', 'Diagnostics');
  if (diagnosticsRead.error) return { error: diagnosticsRead.error };
  const tombRead = await readStoredJson(await env.CABINET.get(purgeKey(id)));
  const prior = tombRead.body && Array.isArray(tombRead.body.mediaIds) ? tombRead.body.mediaIds : [];
  return {
    ids: uniqueMediaIds(
      mediaIdsFromPlansComponent(plansRead.body)
        .concat(mediaIdsFromDistressComponent(distressRead.body))
        .concat(mediaIdsFromFloorComponent(floorRead.body))
        .concat(mediaIdsFromDiagnosticsComponent(diagnosticsRead.body))
        .concat(prior),
    ),
    tomb: tombRead.body,
  };
}

async function writePurgeTombstone(env, id, mediaIds, previous) {
  const body = {
    id: id,
    purgedAt: (previous && previous.purgedAt) || new Date().toISOString(),
    reason: 'permanent-delete',
    mediaIds: uniqueMediaIds(mediaIds),
  };
  await env.CABINET.put(purgeKey(id), JSON.stringify(body), {
    httpMetadata: { contentType: 'application/json' },
  });
  return body;
}

function indexIsInTrash(index) {
  return !!(index && trimStr(index.deletedAt));
}

function tombstoneAuthorizesRetry(tomb, id) {
  return !!(tomb && tomb.reason === 'permanent-delete' && trimStr(tomb.id) === id);
}

/**
 * Whether an index is eligible for permanent delete on THIS snapshot.
 * Checkout and Trash are re-checked on every CAS attempt; a lease or restore
 * that landed since the previous attempt must refuse, not mark purged.
 */
function purgeEligibilityFailure(index) {
  const checkout = index && index.checkout;
  if (checkout && trimStr(checkout.deviceId) && normalizeEmail(checkout.email)) {
    return {
      status: 403,
      error: 'Customer File is checked out. Check it in before permanently deleting it.',
    };
  }
  if (index && !indexIsInTrash(index)) {
    return { status: 409, error: 'Customer File is not in File Cabinet Trash.' };
  }
  return null;
}

/**
 * Explicit permanent delete.
 * Trash is the boundary: an existing index must already have deletedAt.
 * Refuses an active checkout lease, a live index, a corrupt index, and a
 * missing index that was never authorized, before any tombstone, media, or
 * prefix write. A missing index with a permanent-delete tombstone is a
 * retry of a purge that already started.
 *
 * Eligibility and the deleting fence are decided on the SAME index
 * snapshot/CAS. Media is enumerated only AFTER the fence wins, from that
 * fenced accepted-reference snapshot — never collected first then marked
 * against a potentially different version. An incomplete deletion remains
 * recoverable/retryable; the purged marker refuses new writes.
 */
async function purgeCustomerFile(env, id) {
  const fence = await fenceIndexForPurge(env, id);
  if (fence.error) {
    return { status: fence.status || 500, message: fence.error };
  }

  // Media from the fenced snapshot (or legacy+tombstone on a gone retry).
  const media = await referencedMediaIds(env, id, fence.fencedIndex);
  if (media.error) return { status: 500, message: media.error };

  const tombstone = await writePurgeTombstone(env, id, media.ids, media.tomb);
  for (let i = 0; i < tombstone.mediaIds.length; i++) {
    await env.CABINET.delete(mediaKey(tombstone.mediaIds[i]));
  }
  await deleteCustomerFilePrefix(env, id);
  return { status: 200, deleted: id, purged: tombstone };
}

/**
 * Fence the index for permanent delete: eligibility + purged marker in one
 * compare-and-swap. On CAS conflict, re-read AND revalidate checkout/Trash.
 *
 * Recording the deletion in the index makes it an index VERSION, exactly
 * like a takeover: a publication that read an earlier version cannot swap
 * against it, and one that starts afterwards is refused at the gate. The
 * tombstone still outlives the index for the retry path.
 */
async function fenceIndexForPurge(env, id) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const got = await env.CABINET.get(indexKey(id));
    if (!got) {
      const tombRead = await readStoredJson(await env.CABINET.get(purgeKey(id)));
      if (tombRead.corrupt) {
        return { status: 500, error: 'Corrupt purge record; refusing permanent delete' };
      }
      if (!tombstoneAuthorizesRetry(tombRead.body, id)) {
        return { status: 409, error: 'Customer File is not in File Cabinet Trash.' };
      }
      // Already fenced and prefix-cleared on a prior attempt. Retry continues
      // from the tombstone; there is no live index to re-check.
      return { ok: true, fencedIndex: null, gone: true };
    }
    const etag = requireObjectEtag(got);
    if (!etag) {
      return { status: 500, error: 'Missing object ETag; refusing unsafe delete marker' };
    }
    let index;
    try {
      index = await got.json();
    } catch (_) {
      return { status: 500, error: 'Corrupt Customer File index; refusing permanent delete' };
    }
    const refused = purgeEligibilityFailure(index);
    if (refused) return refused;
    if (index && index.purged) {
      return { ok: true, fencedIndex: index, already: true };
    }
    const next = Object.assign({}, index, {
      purged: { reason: 'permanent-delete', at: new Date().toISOString() },
    });
    const bumped = nextSeq(index);
    if (bumped.error) {
      return { status: 500, error: 'Customer File index sequence exhausted; refusing write' };
    }
    next.seq = bumped.seq;
    const putOpts = conditionalPutOptions(etag, { contentType: 'application/json' });
    if (!putOpts) {
      return { status: 500, error: 'Missing object ETag; refusing unsafe delete marker' };
    }
    const put = await env.CABINET.put(indexKey(id), JSON.stringify(next), putOpts);
    if (put !== null) return { ok: true, fencedIndex: next };
    // CAS conflict: another write (checkout, restore, publication) landed.
    // Loop re-reads and revalidates eligibility against that version.
  }
  return { status: 409, error: 'Customer File changed during permanent delete; try again' };
}

async function deleteCustomerFilePrefix(env, id) {
  const prefix = 'cf/' + id + '/';
  let cursor;
  for (;;) {
    const listed = await env.CABINET.list(cursor ? { prefix: prefix, cursor: cursor } : { prefix: prefix });
    for (const obj of listed.objects || []) {
      await env.CABINET.delete(obj.key);
    }
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }
}

/**
 * Atomic checkout acquire using R2 conditional put (etagMatches).
 * R2 alone is sufficient: only one writer can satisfy the etag precondition.
 * Uses object.etag only (never httpEtag). Missing ETag → fail safe (no unconditional put).
 */
async function acquireCheckout(env, id, identity, deviceId, options) {
  const key = indexKey(id);
  const got = await env.CABINET.get(key);
  if (!got) return { status: 404 };

  const etag = requireObjectEtag(got);
  if (!etag) {
    return {
      status: 500,
      message: 'Missing object ETag; refusing unsafe checkout acquire',
    };
  }

  let index;
  try {
    index = await got.json();
  } catch (_) {
    return { status: 500, message: 'Corrupt Customer File index' };
  }
  if (!index || index.id !== id) return { status: 500, message: 'Corrupt Customer File index' };
  // A file already fenced for permanent delete authorizes no new lease. Without
  // this a checkout could land after the deleting fence and look successful
  // while the purge finishes destroying the file.
  if (index.purged) {
    return { status: 409, message: 'Customer File permanently deleted' };
  }

  const takeOver = !!(options && options.takeOver);
  const existing = index.checkout || null;
  const heldByAnother = !!(existing && trimStr(existing.deviceId) && normalizeEmail(existing.email));
  if (heldByAnother) {
    if (sameCheckoutOwner(existing, identity, deviceId)) {
      return { status: 200, index: index, idempotent: true };
    }
    // A Take Over is the one acquire that does not stop here. The holder is
    // not asked, because the reason for a Take Over is that the holder
    // cannot answer -- a device lost, broken, or wiped. It is still one
    // conditional write, so two devices cannot both win it.
    if (!takeOver) {
      return {
        status: 409,
        message: 'Customer File is checked out by another user or device',
        checkout: existing,
      };
    }
  }

  const taking = checkoutPayload(identity, deviceId, null);
  if (takeOver && heldByAnother) {
    const from = takenOverFrom(existing);
    if (from) taking.takenOverFrom = from;
  }
  const next = Object.assign({}, index, { checkout: taking });
  // EVERY ownership change gets a new epoch, stamped from a sequence that
  // never repeats. Without it an index body could be written back byte for
  // byte -- same content-addressed ETag -- and a dead lease would read as
  // live again, which is exactly what defeats the "touch the component"
  // design this protocol replaced.
  const stamped = stampAuthority(index, next);
  if (stamped.error) {
    return { status: 500, message: 'Customer File index sequence exhausted; refusing write' };
  }

  const putOpts = conditionalPutOptions(etag, { contentType: 'application/json' });
  if (!putOpts) {
    return {
      status: 500,
      message: 'Missing object ETag; refusing unsafe checkout acquire',
    };
  }

  const putResult = await env.CABINET.put(key, JSON.stringify(next), putOpts);
  // Conditional put returns null when the precondition fails.
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
      message: takeOver
        ? 'Customer File checkout changed during Take Over'
        : 'Customer File checkout changed during acquire',
      checkout: latest && latest.checkout ? latest.checkout : null,
    };
  }

  return { status: 200, index: next, idempotent: false };
}

async function releaseCheckout(env, id, identity, deviceId) {
  const key = indexKey(id);
  const got = await env.CABINET.get(key);
  if (!got) return { status: 404 };

  const etag = requireObjectEtag(got);
  if (!etag) {
    return {
      status: 500,
      message: 'Missing object ETag; refusing unsafe checkout release',
    };
  }

  let index;
  try {
    index = await got.json();
  } catch (_) {
    return { status: 500, message: 'Corrupt Customer File index' };
  }

  const existing = index.checkout || null;
  if (!existing || !trimStr(existing.deviceId)) {
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
  // A release is an ownership change. Stamping it is what stops a write
  // authorized in one unleased moment from landing in the next one -- the
  // epoch was the device name alone once, so every unleased moment was
  // called "none" and they were indistinguishable.
  const stamped = stampAuthority(index, next);
  if (stamped.error) {
    return { status: 500, message: 'Customer File index sequence exhausted; refusing write' };
  }

  const putOpts = conditionalPutOptions(etag, { contentType: 'application/json' });
  if (!putOpts) {
    return {
      status: 500,
      message: 'Missing object ETag; refusing unsafe checkout release',
    };
  }

  const putResult = await env.CABINET.put(key, JSON.stringify(next), putOpts);
  if (putResult === null) {
    return { status: 409, message: 'Customer File checkout changed during release' };
  }
  return { status: 200, index: next, released: true };
}

async function assertWritableCheckout(request, env, id) {
  const got = await env.CABINET.get(indexKey(id));
  if (!got) return { ok: true, exists: false };
  // The version this answer is about. A caller that goes on to WRITE the
  // index must carry this back as a precondition, or the lease it just read
  // can be acquired by another device before the write lands and then
  // overwritten by this stale copy of it.
  const etag = requireObjectEtag(got);
  let index;
  try {
    index = await got.json();
  } catch (_) {
    return { ok: false, response: text(request, 'Corrupt Customer File index', 500) };
  }
  // A file on its way out authorizes nothing, not even a start. Read from the
  // index, which is the same object acceptance swaps against: a delete
  // recorded here cannot be missed by a publication the way a separate
  // tombstone object could.
  if (index && index.purged) {
    return { ok: false, response: text(request, 'Customer File permanently deleted', 409) };
  }
  const checkout = index && index.checkout;
  if (!checkout || !trimStr(checkout.deviceId) || !normalizeEmail(checkout.email)) {
    return { ok: true, exists: true, index: index, etag: etag, authority: authorityOf(index) };
  }

  const identityResult = await requireIdentity(request, env);
  if (identityResult.errorResponse) return { ok: false, response: identityResult.errorResponse };
  const deviceId = requestDeviceId(request);
  if (!deviceId) {
    return { ok: false, response: badRequest(request, 'Missing x-toolbox-device-id') };
  }
  if (!sameCheckoutOwner(checkout, identityResult, deviceId)) {
    return {
      ok: false,
      response: forbidden(request, 'Customer File is checked out by another user or device'),
    };
  }
  return { ok: true, exists: true, index: index, etag: etag, identity: identityResult,
    authority: authorityOf(index) };
}

/**
 * True when the index already names an accepted candidate for this component.
 * Gate-OFF must not treat that component as legacy-writable (GPT-013).
 */
function hasAcceptedReference(index, name) {
  const refs = index && index.components;
  const ref = refs && typeof refs === 'object' ? refs[name] : null;
  return !!(ref && typeof ref === 'object' && typeof ref.key === 'string' && ref.key);
}

/**
 * The lease is the SERVER's, never the client's: an ordinary Sync write
 * carries back whatever the server holds and may not set, change or drop it.
 *
 * The same now goes for the acceptance references, the revisions they
 * advertise, the sequence, the authority epoch and the deletion state. The
 * client used to write the <name>UpdatedAt fields itself; with the server
 * owning the reference, letting it keep writing them would let it announce a
 * revision that does not describe the accepted bytes -- and that is the field
 * js/sync.js compares to decide which side is newer.
 */
function applyServerLease(gate, body, env) {
  const writesOn = acceptanceWritesEnabled(env);
  // While writes are OFF, legacy-only components keep client-authored
  // <name>UpdatedAt so ordinary Sync still works. Components that already
  // have accepted references keep their stored revision pinned to that
  // reference — an ordinary index PUT must not advertise a new clock for
  // unchanged accepted bytes (GPT-013).
  applyServerOwnedIndexFields(gate && gate.index, body, {
    includeRevisionFields: writesOn,
  });
  if (writesOn) return;
  const stored = gate && gate.index;
  if (!stored) return;
  Object.keys(COMPONENT_NAMES).forEach(function (name) {
    if (!hasAcceptedReference(stored, name)) return;
    const field = revField(name);
    const value = stored[field];
    if (value === undefined || value === null) delete body[field];
    else body[field] = value;
  });
}

/**
 * Accepted-reference WRITES stay off until an explicit activation step flips
 * COMPONENT_ACCEPTANCE_WRITES. Readers already resolve accepted references
 * and check stale legacy fallbacks; that preparatory read path is always on.
 * The document alone is not a gate — this env flag is.
 *
 * Default OFF preserves the legacy component PUT for files that have never
 * published accepted references. It is a read-compatible stop for components
 * that already have references — not a write rollback that can acknowledge
 * ignored legacy bytes. Flipping the flag on without a deployment drain that
 * stops old Worker handlers from acknowledging writes across the conversion
 * boundary is not authorized from repository code alone; see
 * docs/component-acceptance-activation.md.
 */
function acceptanceWritesEnabled(env) {
  const flag = env && env.COMPONENT_ACCEPTANCE_WRITES;
  return flag === '1' || flag === 'true' || flag === true;
}

/**
 * Legacy component PUT: write to the fixed key while acceptance writes are
 * gated OFF. Refuses when an accepted reference already exists for this
 * component — acknowledging a legacy overwrite would leave readers on the
 * old candidate while the index (or a later equal-clock skip) pretends the
 * new work landed (GPT-013).
 */
async function putComponentLegacy(request, env, id, name) {
  const tomb = await env.CABINET.head(purgeKey(id));
  if (tomb) return text(request, 'Customer File permanently deleted', 409);
  const writeGate = await assertWritableCheckout(request, env, id);
  if (!writeGate.ok) return writeGate.response;
  if (writeGate.exists && hasAcceptedReference(writeGate.index, name)) {
    return conflict(request,
      'Accepted ' + name + ' is already stored; COMPONENT_ACCEPTANCE_WRITES must be on to publish');
  }
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return badRequest(request, 'Invalid JSON');
  }
  await env.CABINET.put(legacyComponentKey(id, name), JSON.stringify(body), {
    httpMetadata: { contentType: 'application/json' },
  });
  return json(request, { ok: true });
}

/**
 * PUBLISH A COMPONENT. The protocol, against the real store.
 * Only reached when acceptanceWritesEnabled(env) is true.
 *
 * Two writes, in this order, and only the second one decides anything:
 *   1. An immutable candidate at a unique key, create-only. Accepted bytes
 *      are never overwritten, so a stale writer cannot destroy current work
 *      even if everything after this point goes wrong.
 *   2. One compare-and-swap on the index that moves the reference and the
 *      advertised revision together. A takeover, a release or any other
 *      index write in between loses this device the swap.
 *
 * What it refuses, and why each one was reachable:
 *   - no usable revision: the ordering check would be skipped entirely and
 *     an old client could publish over newer content with a 200, leaving the
 *     advertised field describing the bytes it had just replaced.
 *   - an older instant: two uploads from one owner can complete out of order.
 *   - the same instant with different bytes: the client's own comparison
 *     cannot tell them apart, so chooseSide() says 'skip' and nothing would
 *     ever fetch the new bytes. Silent divergence.
 *   - a deleted file, read from the index inside the swap boundary.
 *   - a candidate this request did not write.
 */
async function publishComponent(request, env, id, name) {
  const tomb = await env.CABINET.head(purgeKey(id));
  if (tomb) return text(request, 'Customer File permanently deleted', 409);

  let gate = await assertWritableCheckout(request, env, id);
  if (!gate.ok) return gate.response;

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return badRequest(request, 'Invalid JSON');
  }

  // The revision comes out of the component's OWN body, from the same field
  // js/sync.js componentRevision() reads. No new header, no client change,
  // and the server cannot end up advertising a revision the component does
  // not carry.
  const ms = bodyRevisionMs(name, body);
  if (ms === null) {
    return badRequest(request, 'Component carries no usable ' + name + ' revision');
  }
  const revision = canonicalRev(ms);

  // Written BEFORE the candidate: a request that cannot be accepted should
  // not leave bytes behind.
  const bytes = JSON.stringify(body);
  const key = candidateComponentKey(id, name, newCandidateToken());
  const wrote = await env.CABINET.put(key, bytes, createOnlyPutOptions({
    contentType: 'application/json',
  }));
  if (wrote === null) {
    // A fresh token cannot collide, so this is a store fault rather than a
    // race. Either way a create that did not happen is not a licence to
    // publish -- the only way on would be proving this exact object already
    // holds exactly these bytes, which a fresh token makes impossible.
    return text(request, 'Component candidate could not be stored', 500);
  }

  /**
   * A FIRST SYNC arrives components-first.
   *
   * js/sync.js syncOneRecord pushes every changed component and only then
   * writes the index, so on a Customer File the Cabinet has never seen the
   * index does not exist yet when the first component lands. The old handler
   * did not care -- it wrote the component unconditionally. Acceptance needs
   * an index to swap against, so one is created here, create-only, and the
   * client's own index write moments later falls into the ordinary
   * conditional path and fills in the rest.
   *
   * Create-only, so two devices racing a first sync cannot both win it: the
   * loser re-reads and goes through the gate against what is actually there.
   *
   * Honest about the gap: between this create and the client's index write,
   * a Cabinet listing shows the file with no customer name on it, because
   * the name lives in the index the client has not sent yet. It is one round
   * trip wide, and the alternative -- refusing the component -- would mean a
   * new Customer File could never reach the Cabinet at all.
   */
  if (!gate.exists) {
    const opening = { id: id, seq: 1, authoritySeq: 1, components: {} };
    opening.components[name] = { key: key, revision: revision };
    opening[revField(name)] = revision;
    const created = await env.CABINET.put(indexKey(id), JSON.stringify(opening),
      createOnlyPutOptions({ contentType: 'application/json' }));
    if (created !== null) return json(request, { ok: true, revision: revision, created: true });
    // Lost the create. Run the gate again against what is there now, which
    // refuses outright if the file already belongs to another device.
    gate = await assertWritableCheckout(request, env, id);
    if (!gate.ok) return gate.response;
    if (!gate.exists) {
      return text(request, 'Customer File index could not be created', 500);
    }
  }

  const authority = gate.authority;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = gate.index;
    // Read from the version this attempt is about to swap against. A delete
    // landing after this line changes the index, so the swap fails and the
    // next attempt sees it.
    if (stored && stored.purged) {
      return text(request, 'Customer File permanently deleted', 409);
    }
    const acceptedMs = revMs(stored && stored[revField(name)]);
    if (acceptedMs !== null && ms < acceptedMs) {
      return conflict(request, 'A newer ' + name + ' is already stored; sync again');
    }
    if (acceptedMs !== null && ms === acceptedMs) {
      const current = resolveAcceptedComponent(stored, id, name);
      const there = await env.CABINET.get(current.key);
      if (there) {
        const already = await there.text();
        if (already === bytes) {
          // An honest retry of a write that already landed. Answering 409
          // here would send the owner chasing it.
          return json(request, { ok: true, revision: revision, unchanged: true });
        }
        return conflict(request,
          'A different ' + name + ' is stored at the same revision; save again');
      }
      // The reference points at nothing. Publishing repairs it; refusing
      // would leave the component unreadable at this revision for good.
    }

    const components = Object.assign({}, (stored && stored.components) || {});
    components[name] = { key: key, revision: revision };
    const next = Object.assign({}, stored, { components: components });
    // The reference and the field the client orders by move TOGETHER, so they
    // can never describe different bytes.
    next[revField(name)] = revision;
    const bumped = nextSeq(stored);
    if (bumped.error) {
      return text(request, 'Customer File index sequence exhausted; refusing write', 500);
    }
    next.seq = bumped.seq;

    const putOpts = conditionalPutOptions(gate.etag, { contentType: 'application/json' });
    if (!putOpts) {
      return text(request, 'Missing object ETag; refusing unsafe component publish', 500);
    }
    const put = await env.CABINET.put(indexKey(id), JSON.stringify(next), putOpts);
    if (put !== null) return json(request, { ok: true, revision: revision });

    // Something changed the index under us. RE-AUTHORIZE rather than retry
    // blind -- and against the authority EPOCH, not merely the device. A
    // device can lose the file and get it back, and this payload was composed
    // before whatever the other device did in between; republishing it would
    // discard that work silently.
    gate = await assertWritableCheckout(request, env, id);
    if (!gate.ok) return gate.response;
    if (!gate.exists) return notFound(request);
    if (gate.authority !== authority) {
      return forbidden(request, 'Customer File ownership changed during save; sync again');
    }
  }
  return conflict(request, 'Customer File index changed during save; sync again');
}

const PWA_ORIGIN = 'https://sandiageotoolbox.com';

function authDoneResponse() {
  const dest = PWA_ORIGIN + '/?resumeSync=1';
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta http-equiv="refresh" content="0;url=' + dest + '">'
    + '<title>Signed in</title>'
    + '<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:2rem;text-align:center;color:#123}</style>'
    + '</head><body>'
    + '<p>Signed in. Returning to Toolbox…</p>'
    + '<p><a href="' + dest + '">Continue</a></p>'
    + '<script>location.replace(' + JSON.stringify(dest) + ');</script>'
    + '</body></html>';
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+/, '');

    // After Cloudflare Access login, land here then bounce back to the PWA
    // in the same browser/PWA cookie jar (required on iPhone home-screen PWA).
    if (path === 'auth-done' && request.method === 'GET') {
      return authDoneResponse();
    }

    if (!env.CABINET) {
      return text(request, 'R2 cabinet binding missing', 500);
    }

    if (path === 'health' && request.method === 'GET') {
      return json(request, {
        ok: true,
        service: 'toolbox-sync',
        accessConfigured: accessConfigReady(env),
      });
    }

    if (path === 'me' && request.method === 'GET') {
      const identityResult = await requireIdentity(request, env);
      if (identityResult.errorResponse) return identityResult.errorResponse;
      return json(request, {
        email: identityResult.email,
        sub: identityResult.sub,
      });
    }

    // File Explorer is a read-only window onto real keys. It must not fall
    // through to checkout, sync writes, or delete. Identity is required here
    // even though Cloudflare Access also sits in front of the Worker.
    if (path === 'explore' || path.startsWith('explore/')) {
      const identityResult = await requireIdentity(request, env);
      if (identityResult.errorResponse) return identityResult.errorResponse;
      if (request.method !== 'GET') return text(request, 'Method not allowed', 405);
      const result = await exploreResult(request, env);
      if (result && result.body) {
        const headers = Object.assign({}, corsHeaders(request), result.headers || {});
        return new Response(result.body, { status: result.status || 200, headers: headers });
      }
      if (result && result.json !== undefined) return json(request, result.json, result.status);
      return text(request, (result && result.text) || 'Not found', (result && result.status) || 404);
    }

    if (path === 'files' && request.method === 'GET') {
      const files = await listIndexes(env);
      const purged = await listPurges(env);
      return json(request, { files: files, purged: purged });
    }

    let match = /^files\/([^/]+)$/.exec(path);
    if (match && request.method === 'DELETE') {
      const id = decodeURIComponent(match[1]);
      const result = await purgeCustomerFile(env, id);
      if (result.status === 403) return forbidden(request, result.message);
      if (result.status === 409) return conflict(request, result.message);
      if (result.status === 500) return text(request, result.message || 'Server error', 500);
      return json(request, { ok: true, deleted: result.deleted, purged: result.purged });
    }

    // Take Over is its own route, not a flag on the ordinary acquire, so
    // nothing can slip past the refusal that protects a live lease by
    // accident. The route exists because a lease can outlive the device
    // holding it: a phone that is lost, broken, or wiped still names itself
    // in the Cabinet, and without this the job was stuck for everybody.
    match = /^files\/([^/]+)\/checkout\/takeover$/.exec(path);
    if (match && request.method === 'POST') {
      const id = decodeURIComponent(match[1]);
      const identityResult = await requireIdentity(request, env);
      if (identityResult.errorResponse) return identityResult.errorResponse;
      let body;
      try {
        body = await request.json();
      } catch (_) {
        return badRequest(request, 'Invalid JSON');
      }
      const deviceId = trimStr(body && body.deviceId) || requestDeviceId(request);
      if (!deviceId) return badRequest(request, 'deviceId is required');
      const headerDevice = requestDeviceId(request);
      if (headerDevice && headerDevice !== deviceId) {
        return badRequest(request, 'deviceId header/body mismatch');
      }

      const tomb = await env.CABINET.head(purgeKey(id));
      if (tomb) return conflict(request, 'Customer File permanently deleted');

      const result = await acquireCheckout(env, id, identityResult, deviceId, { takeOver: true });
      if (result.status === 404) return notFound(request);
      if (result.status === 500) return text(request, result.message || 'Server error', 500);
      if (result.status === 409) {
        return json(request, {
          ok: false,
          code: 'checked_out',
          message: result.message,
          checkout: result.checkout || null,
        }, 409);
      }
      return json(request, {
        ok: true,
        takeOver: true,
        idempotent: !!result.idempotent,
        index: result.index,
        checkout: result.index && result.index.checkout,
      });
    }

    match = /^files\/([^/]+)\/checkout$/.exec(path);
    if (match && request.method === 'POST') {
      const id = decodeURIComponent(match[1]);
      const identityResult = await requireIdentity(request, env);
      if (identityResult.errorResponse) return identityResult.errorResponse;
      let body;
      try {
        body = await request.json();
      } catch (_) {
        return badRequest(request, 'Invalid JSON');
      }
      const deviceId = trimStr(body && body.deviceId) || requestDeviceId(request);
      if (!deviceId) return badRequest(request, 'deviceId is required');
      const headerDevice = requestDeviceId(request);
      if (headerDevice && headerDevice !== deviceId) {
        return badRequest(request, 'deviceId header/body mismatch');
      }

      const tomb = await env.CABINET.head(purgeKey(id));
      if (tomb) return conflict(request, 'Customer File permanently deleted');

      const result = await acquireCheckout(env, id, identityResult, deviceId);
      if (result.status === 404) return notFound(request);
      if (result.status === 500) return text(request, result.message || 'Server error', 500);
      if (result.status === 409) {
        return json(request, {
          ok: false,
          code: 'checked_out',
          message: result.message,
          checkout: result.checkout || null,
        }, 409);
      }
      return json(request, {
        ok: true,
        idempotent: !!result.idempotent,
        index: result.index,
        checkout: result.index && result.index.checkout,
      });
    }

    match = /^files\/([^/]+)\/checkout\/release$/.exec(path);
    if (match && request.method === 'POST') {
      const id = decodeURIComponent(match[1]);
      const identityResult = await requireIdentity(request, env);
      if (identityResult.errorResponse) return identityResult.errorResponse;
      const deviceId = requestDeviceId(request);
      if (!deviceId) return badRequest(request, 'Missing x-toolbox-device-id');

      const result = await releaseCheckout(env, id, identityResult, deviceId);
      if (result.status === 404) return notFound(request);
      if (result.status === 500) return text(request, result.message || 'Server error', 500);
      if (result.status === 403) return forbidden(request, result.message);
      if (result.status === 409) return conflict(request, result.message);
      return json(request, {
        ok: true,
        released: !!result.released,
        index: result.index,
      });
    }

    match = /^files\/([^/]+)\/index$/.exec(path);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (request.method === 'GET') {
        const got = await env.CABINET.get(indexKey(id));
        if (!got) return notFound(request);
        return json(request, await got.json());
      }
      if (request.method === 'PUT') {
        const tomb = await env.CABINET.head(purgeKey(id));
        if (tomb) return text(request, 'Customer File permanently deleted', 409);
        let body;
        try {
          body = await request.json();
        } catch (_) {
          return badRequest(request, 'Invalid JSON');
        }
        if (!body || body.id !== id) return badRequest(request, 'Index id mismatch');

        let gate = await assertWritableCheckout(request, env, id);
        if (!gate.ok) return gate.response;
        applyServerLease(gate, body, env);

        if (!gate.exists) {
          // CREATE-ONCE, not an unconditional write.
          //
          // The comment that used to stand here said a lease cannot exist on
          // an object that does not, so there was none to lose. That is true
          // at the moment of the READ and false at the moment of the WRITE:
          // another device can create the index in between and acquire a
          // checkout on it, and this write would then erase that lease while
          // returning 200 -- the same shape of fault the conditional update
          // below was added to fix, left standing on the path beside it.
          // The first version of an index starts the sequence, so even a
          // brand-new file's authority epoch is stamped from a real number.
          body.seq = 1;
          if (typeof body.authoritySeq !== 'number') body.authoritySeq = 1;
          const created = await env.CABINET.put(
            indexKey(id),
            JSON.stringify(body),
            createOnlyPutOptions({ contentType: 'application/json' }),
          );
          if (created !== null) return json(request, { ok: true });
          // Lost the create. Something is there now, and it may be checked
          // out. Run the gate again against what is actually there, which
          // refuses this write outright if the file now belongs to another
          // device, and otherwise carry ITS lease rather than the absence we
          // read. Then fall into the conditional update below.
          gate = await assertWritableCheckout(request, env, id);
          if (!gate.ok) return gate.response;
          if (!gate.exists) {
            return text(request, 'Customer File index could not be created', 500);
          }
          applyServerLease(gate, body, env);
        }

        // Read-modify-write, so it needs the same compare-and-swap the
        // checkout routes already use. Without it, a lease acquired between
        // the read above and the write below was erased by this stale copy
        // of the index -- both requests returning 200, the file left checked
        // out to nobody. Audit finding 3.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const putOpts = conditionalPutOptions(gate.etag, { contentType: 'application/json' });
          if (!putOpts) {
            return text(request, 'Missing object ETag; refusing unsafe index write', 500);
          }
          // Every index version is a new number, so no index body can repeat
          // and no content-addressed ETag can come back around.
          const bumped = nextSeq(gate.index);
          if (bumped.error) {
            return text(request, 'Customer File index sequence exhausted; refusing write', 500);
          }
          body.seq = bumped.seq;
          const putResult = await env.CABINET.put(indexKey(id), JSON.stringify(body), putOpts);
          // Conditional put returns null when the precondition fails.
          if (putResult !== null) return json(request, { ok: true });
          if (attempt > 0) break;
          // Something changed the index under us. Read it again and run the
          // gate against what is there NOW: if a checkout was acquired or
          // taken over in the gap, this device is no longer the writer and
          // the retry is refused rather than allowed through.
          gate = await assertWritableCheckout(request, env, id);
          if (!gate.ok) return gate.response;
          if (!gate.exists) return notFound(request);
          applyServerLease(gate, body, env);
        }
        return conflict(request, 'Customer File index changed during write; sync again');
      }
    }

    match = /^files\/([^/]+)\/components\/([^/]+)$/.exec(path);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const name = decodeURIComponent(match[2]);
      if (!COMPONENT_NAMES[name]) return badRequest(request, 'Unknown component');
      if (request.method === 'GET') {
        // Through the SAME resolution every other reader uses, so a GET can
        // never answer with a different version than the archive, the listing
        // or the purge would find.
        const indexRead = await readStoredJson(await env.CABINET.get(indexKey(id)));
        if (indexRead.corrupt) return text(request, 'Corrupt Customer File index', 500);
        const resolved = resolveAcceptedComponent(indexRead.body, id, name);
        const got = await env.CABINET.get(resolved.key);
        if (!got) {
          // A reference pointing at nothing is a FAULT, not a cue to fall
          // back. Falling back would serve bytes the owner already replaced,
          // and the client would take them as current.
          if (resolved.from === 'accepted') {
            return text(request, 'Accepted component object is missing', 500);
          }
          return notFound(request);
        }
        const payload = await got.json();
        // The fallback is checked, not trusted. See legacyIsStale.
        if (resolved.from === 'legacy' && legacyIsStale(indexRead.body, name, payload)) {
          return text(request,
            'Stored ' + name + ' is older than the revision the index advertises', 500);
        }
        return json(request, payload);
      }
      if (request.method === 'PUT') {
        if (acceptanceWritesEnabled(env)) {
          return publishComponent(request, env, id, name);
        }
        return putComponentLegacy(request, env, id, name);
      }
    }

    match = /^media\/([^/]+)\/exists$/.exec(path);
    if (match && request.method === 'GET') {
      const mediaId = decodeURIComponent(match[1]);
      const got = await env.CABINET.head(mediaKey(mediaId));
      return json(request, { exists: !!got });
    }

    match = /^media\/([^/]+)$/.exec(path);
    if (match) {
      const mediaId = decodeURIComponent(match[1]);
      if (request.method === 'GET') {
        const got = await env.CABINET.get(mediaKey(mediaId));
        if (!got) return notFound(request);
        const headers = corsHeaders(request);
        headers['content-type'] = (got.httpMetadata && got.httpMetadata.contentType) || 'application/octet-stream';
        return new Response(got.body, { status: 200, headers: headers });
      }
      if (request.method === 'PUT') {
        const contentType = request.headers.get('content-type') || 'application/octet-stream';
        const bytes = await request.arrayBuffer();
        await env.CABINET.put(mediaKey(mediaId), bytes, {
          httpMetadata: { contentType: contentType },
        });
        return json(request, { ok: true, bytes: bytes.byteLength });
      }
    }

    return notFound(request);
  },
};
