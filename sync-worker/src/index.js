/**
 * Toolbox Sync API — Stage A
 * Worker + private R2. Protect with Cloudflare Access on this Worker hostname only.
 * Do not put the static Toolbox PWA behind Access.
 */

/** PWA origin only — Access cookie sync uses credentials:include (no *). */
const ALLOWED_ORIGINS = {
  'https://sandiageotoolbox.com': true,
};

function corsHeaders(request) {
  const origin = (request && request.headers && request.headers.get('Origin')) || '';
  const headers = {
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-toolbox-encoding',
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

async function writePurgeTombstone(env, id) {
  const body = {
    id: id,
    purgedAt: new Date().toISOString(),
    reason: 'permanent-delete',
  };
  await env.CABINET.put(purgeKey(id), JSON.stringify(body), {
    httpMetadata: { contentType: 'application/json' },
  });
  return body;
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
      return json(request, { ok: true, service: 'toolbox-sync' });
    }

    if (path === 'files' && request.method === 'GET') {
      const files = await listIndexes(env);
      const purged = await listPurges(env);
      return json(request, { files: files, purged: purged });
    }

    let match = /^files\/([^/]+)$/.exec(path);
    if (match && request.method === 'DELETE') {
      const id = decodeURIComponent(match[1]);
      // Tombstone first: a crash after delete-but-before-tombstone would leave
      // a resurrection window. Write the durable purge marker, then remove objects.
      const tombstone = await writePurgeTombstone(env, id);
      await deleteCustomerFilePrefix(env, id);
      return json(request, { ok: true, deleted: id, purged: tombstone });
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
