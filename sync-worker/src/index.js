/**
 * Toolbox Sync API — File Cabinet + selective local + exclusive Check Out foundation.
 * Worker + private R2. Protect with Cloudflare Access on this Worker hostname only.
 * Do not put the static Toolbox PWA behind Access.
 *
 * Identity: verified Cloudflare Access JWT (Cf-Access-Jwt-Assertion).
 * Requires env.CF_ACCESS_TEAM_DOMAIN and env.CF_ACCESS_AUD (secret).
 * Do not trust unverified convenience email headers.
 */

import { requireObjectEtag, conditionalPutOptions } from './r2-conditional.js';
import { exploreResult } from './explore.js';

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

function componentKey(id, name) {
  return 'cf/' + id + '/' + name + '.json';
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

function mediaIdsFromPlansComponent(plans) {
  const canvases = plans && Array.isArray(plans.canvases) ? plans.canvases : [];
  const ids = [];
  canvases.forEach(function (canvas) {
    const id = canvas && canvas.plan && canvas.plan.id;
    if (safeMediaId(id)) ids.push(id);
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
 * Plan, Distress, and Floor Survey recovery-PDF bytes referenced by this Customer File.
 * Stops before any delete when a present component cannot be read.
 */
async function referencedMediaIds(env, id) {
  const plansRead = await readStoredJson(await env.CABINET.get(componentKey(id, 'plans')));
  if (plansRead.corrupt) {
    return { error: 'Plans component is unreadable; refusing permanent delete' };
  }
  const distressRead = await readStoredJson(await env.CABINET.get(componentKey(id, 'distress')));
  if (distressRead.corrupt) {
    return { error: 'Distress component is unreadable; refusing permanent delete' };
  }
  const floorRead = await readStoredJson(await env.CABINET.get(componentKey(id, 'floor')));
  if (floorRead.corrupt) {
    return { error: 'Floor Survey component is unreadable; refusing permanent delete' };
  }
  const tombRead = await readStoredJson(await env.CABINET.get(purgeKey(id)));
  const prior = tombRead.body && Array.isArray(tombRead.body.mediaIds) ? tombRead.body.mediaIds : [];
  return {
    ids: uniqueMediaIds(
      mediaIdsFromPlansComponent(plansRead.body)
        .concat(mediaIdsFromDistressComponent(distressRead.body))
        .concat(mediaIdsFromFloorComponent(floorRead.body))
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

/**
 * Explicit permanent delete.
 * Refuses an active checkout lease before any write.
 * Tombstone is written before media or prefix removal so a crash cannot
 * resurrect the Customer File. Referenced media/{id} keys are deleted;
 * unrelated media keys are left alone.
 */
async function purgeCustomerFile(env, id) {
  const indexRead = await readStoredJson(await env.CABINET.get(indexKey(id)));
  if (indexRead.corrupt) {
    return { status: 500, message: 'Corrupt Customer File index; refusing permanent delete' };
  }
  const index = indexRead.body;
  const checkout = index && index.checkout;
  if (checkout && trimStr(checkout.deviceId) && normalizeEmail(checkout.email)) {
    return {
      status: 403,
      message: 'Customer File is checked out. Check it in before permanently deleting it.',
    };
  }

  const media = await referencedMediaIds(env, id);
  if (media.error) return { status: 500, message: media.error };

  const tombstone = await writePurgeTombstone(env, id, media.ids, media.tomb);
  for (let i = 0; i < tombstone.mediaIds.length; i++) {
    await env.CABINET.delete(mediaKey(tombstone.mediaIds[i]));
  }
  await deleteCustomerFilePrefix(env, id);
  return { status: 200, deleted: id, purged: tombstone };
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
async function acquireCheckout(env, id, identity, deviceId) {
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

  const existing = index.checkout || null;
  if (existing && trimStr(existing.deviceId) && normalizeEmail(existing.email)) {
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
    checkout: checkoutPayload(identity, deviceId, null),
  });

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
      message: 'Customer File checkout changed during acquire',
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
  let index;
  try {
    index = await got.json();
  } catch (_) {
    return { ok: false, response: text(request, 'Corrupt Customer File index', 500) };
  }
  const checkout = index && index.checkout;
  if (!checkout || !trimStr(checkout.deviceId) || !normalizeEmail(checkout.email)) {
    return { ok: true, exists: true, index: index };
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
  return { ok: true, exists: true, index: index, identity: identityResult };
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
      if (result.status === 500) return text(request, result.message || 'Server error', 500);
      return json(request, { ok: true, deleted: result.deleted, purged: result.purged });
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

        const writeGate = await assertWritableCheckout(request, env, id);
        if (!writeGate.ok) return writeGate.response;

        // Preserve server checkout lease on ordinary Sync index writes.
        if (writeGate.index && writeGate.index.checkout) {
          body.checkout = writeGate.index.checkout;
        } else {
          delete body.checkout;
        }

        await env.CABINET.put(indexKey(id), JSON.stringify(body), {
          httpMetadata: { contentType: 'application/json' },
        });
        return json(request, { ok: true });
      }
    }

    match = /^files\/([^/]+)\/components\/([^/]+)$/.exec(path);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const name = decodeURIComponent(match[2]);
      if (!COMPONENT_NAMES[name]) return badRequest(request, 'Unknown component');
      if (request.method === 'GET') {
        const got = await env.CABINET.get(componentKey(id, name));
        if (!got) return notFound(request);
        return json(request, await got.json());
      }
      if (request.method === 'PUT') {
        const tomb = await env.CABINET.head(purgeKey(id));
        if (tomb) return text(request, 'Customer File permanently deleted', 409);
        const writeGate = await assertWritableCheckout(request, env, id);
        if (!writeGate.ok) return writeGate.response;
        let body;
        try {
          body = await request.json();
        } catch (_) {
          return badRequest(request, 'Invalid JSON');
        }
        await env.CABINET.put(componentKey(id, name), JSON.stringify(body), {
          httpMetadata: { contentType: 'application/json' },
        });
        return json(request, { ok: true });
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
