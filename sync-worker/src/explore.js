/**
 * Read-only File Explorer over the real File Cabinet keys.
 *
 * Storage is not a folder of photos and plans. Each Customer File is
 * cf/{id}/*.json. Plan images and distress photos are flat media/{id}
 * objects. This module lists those keys and only the media ids cited by
 * the stored plans.json, distress.json, floor.json, and diagnostics.json
 * manifests. It does not invent folders, names, or bytes, and it never
 * writes the bucket. A media id is included only when a manifest cites it.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function safeCustomerId(id) {
  return typeof id === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,128}$/.test(id) &&
    id.indexOf('..') === -1;
}

export function safeMediaId(id) {
  return typeof id === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(id) &&
    id.indexOf('..') === -1;
}

function uploadedIso(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && value && !isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return null;
}

function objectMeta(key, source) {
  const meta = { key: key };
  if (source && typeof source.size === 'number' && isFinite(source.size) && source.size >= 0) {
    meta.size = source.size;
  }
  const uploaded = uploadedIso(source && source.uploaded);
  if (uploaded) meta.uploaded = uploaded;
  const contentType = source && source.httpMetadata && source.httpMetadata.contentType;
  if (typeof contentType === 'string' && contentType.trim()) meta.contentType = contentType;
  return meta;
}

async function listPrefix(cabinet, prefix) {
  const found = [];
  let cursor;
  for (;;) {
    const listed = await cabinet.list(cursor ? { prefix: prefix, cursor: cursor } : { prefix: prefix });
    const objects = listed && listed.objects ? listed.objects : [];
    for (let i = 0; i < objects.length; i++) found.push(objects[i]);
    if (!listed || !listed.truncated) break;
    cursor = listed.cursor;
    if (!cursor) break;
  }
  return found;
}

async function readJson(got) {
  if (!got || typeof got.json !== 'function') return { ok: false };
  try {
    return { ok: true, value: await got.json() };
  } catch (_) {
    return { ok: false };
  }
}

function noteUnsafe(notes, source) {
  const text = 'Referenced media id in ' + source + ' is not a single storage key and was not fetched.';
  if (notes.indexOf(text) === -1) notes.push(text);
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function considerMedia(refs, notes, source, id, purpose, label, detail) {
  if (typeof id !== 'string' || !id) return;
  if (!safeMediaId(id)) {
    noteUnsafe(notes, source);
    return;
  }
  refs.push({
    id: id,
    purpose: purpose,
    label: label,
    detail: detail || '',
  });
}

function canvasNameMap(plans) {
  const names = Object.create(null);
  const canvases = plans && Array.isArray(plans.canvases) ? plans.canvases : [];
  canvases.forEach(function (canvas) {
    if (!canvas || typeof canvas.id !== 'string' || !canvas.id) return;
    const name = trimmed(canvas.name);
    if (name) names[canvas.id] = name;
  });
  return names;
}

function mediaRefsFromPlans(payload, notes) {
  const refs = [];
  if (!payload || typeof payload !== 'object') return refs;
  const canvases = Array.isArray(payload.canvases) ? payload.canvases : [];
  canvases.forEach(function (canvas) {
    const name = trimmed(canvas && canvas.name);
    considerMedia(
      refs,
      notes,
      'plans.json',
      canvas && canvas.plan && canvas.plan.id,
      'plan',
      name ? 'Floor plan — ' + name : 'Floor plan image',
      '',
    );
  });
  return refs;
}

function mediaRefsFromDistress(payload, notes) {
  const refs = [];
  if (!payload || typeof payload !== 'object') return refs;
  const pins = Array.isArray(payload.pins) ? payload.pins : [];
  pins.forEach(function (pin) {
    const photos = pin && Array.isArray(pin.photos) ? pin.photos : [];
    photos.forEach(function (id) {
      if (typeof id !== 'string' || id.indexOf('ph_') !== 0) return;
      considerMedia(refs, notes, 'distress.json', id, 'distress-photo', 'Distress Survey photograph', '');
    });
  });
  const quick = Array.isArray(payload.quickCapture) ? payload.quickCapture : [];
  quick.forEach(function (item) {
    if (!item || typeof item.id !== 'string' || item.id.indexOf('ph_') !== 0) return;
    const sourceName = trimmed(item.sourceName);
    considerMedia(
      refs,
      notes,
      'distress.json',
      item.id,
      'quick-capture',
      sourceName ? 'Quick Capture photo — ' + sourceName : 'Quick Capture photo',
      '',
    );
  });
  return refs;
}

function floorLevelLabel(canvasId, layer, canvasNames) {
  const fromPlan = canvasId && canvasNames ? canvasNames[canvasId] : '';
  if (fromPlan) return fromPlan;
  return trimmed(layer && layer.name);
}

function takeFloorLayer(refs, notes, layer, canvasId, canvasNames) {
  if (!layer || typeof layer !== 'object' || Array.isArray(layer)) return;
  const level = floorLevelLabel(canvasId, layer, canvasNames);
  const suffix = level ? ' — ' + level : '';
  considerMedia(
    refs,
    notes,
    'floor.json',
    layer.recoveryPdfMediaId,
    'floor-pdf',
    'Floor Survey recovery PDF' + suffix,
    '',
  );
  ['figureMediaId', 'topoFigureMediaId', 'renderedFigureMediaId'].forEach(function (key) {
    considerMedia(refs, notes, 'floor.json', layer[key], 'floor-figure', 'Floor Survey figure' + suffix, '');
  });
  const areas = Array.isArray(layer.areas) ? layer.areas : [];
  areas.forEach(function (area) {
    if (!area || typeof area !== 'object') return;
    ['figureMediaId', 'recoveryPdfMediaId', 'renderedFigureMediaId', 'topoFigureMediaId'].forEach(function (key) {
      const purpose = key === 'recoveryPdfMediaId' ? 'floor-pdf' : 'floor-figure';
      const label = (key === 'recoveryPdfMediaId' ? 'Floor Survey recovery PDF' : 'Floor Survey figure') + suffix;
      considerMedia(refs, notes, 'floor.json', area[key], purpose, label, '');
    });
  });
}

function mediaRefsFromFloor(payload, notes, canvasNames) {
  const refs = [];
  if (!payload || typeof payload !== 'object') return refs;
  const map = payload.byCanvasId;
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    Object.keys(map).forEach(function (canvasId) {
      takeFloorLayer(refs, notes, map[canvasId], canvasId, canvasNames);
    });
  }
  ['epochs', 'sessions', 'surveys'].forEach(function (group) {
    const list = payload[group];
    if (!Array.isArray(list)) return;
    list.forEach(function (entry) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
      const nested = entry.byCanvasId;
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        Object.keys(nested).forEach(function (canvasId) {
          takeFloorLayer(refs, notes, nested[canvasId], canvasId, canvasNames);
        });
        return;
      }
      takeFloorLayer(refs, notes, entry, typeof entry.canvasId === 'string' ? entry.canvasId : '', canvasNames);
    });
  });
  return refs;
}

function mediaRefsFromDiagnostics(payload, notes) {
  const refs = [];
  if (!payload || typeof payload !== 'object') return refs;
  const figures = Array.isArray(payload.figures) ? payload.figures : [];
  figures.forEach(function (fig) {
    if (!fig || typeof fig !== 'object') return;
    const canvas = trimmed(fig.canvasName);
    considerMedia(
      refs,
      notes,
      'diagnostics.json',
      fig.mediaId,
      'diagnostics-figure',
      canvas ? 'Diagnostics figure — ' + canvas : 'Diagnostics figure',
      '',
    );
  });
  return refs;
}

const PURPOSE_RANK = {
  'distress-photo': 1,
  'quick-capture': 2,
  plan: 1,
  'floor-pdf': 1,
  'floor-figure': 2,
  'diagnostics-figure': 1,
};

function mergeMediaRefs(refs) {
  const map = Object.create(null);
  const order = [];
  refs.forEach(function (ref) {
    if (!ref || !ref.id) return;
    const prev = map[ref.id];
    if (!prev) {
      map[ref.id] = {
        id: ref.id,
        purpose: ref.purpose,
        label: ref.label,
        detail: ref.detail || '',
        also: [],
      };
      order.push(ref.id);
      return;
    }
    if (prev.purpose === ref.purpose) {
      if (!prev.detail && ref.detail) prev.detail = ref.detail;
      if (ref.label && ref.label.length > prev.label.length) prev.label = ref.label;
      return;
    }
    const prevRank = PURPOSE_RANK[prev.purpose] || 9;
    const nextRank = PURPOSE_RANK[ref.purpose] || 9;
    if (nextRank < prevRank) {
      prev.also.push(prev.purpose);
      prev.purpose = ref.purpose;
      prev.label = ref.label;
      prev.detail = ref.detail || prev.detail;
    } else if (prev.also.indexOf(ref.purpose) === -1) {
      prev.also.push(ref.purpose);
    }
  });
  return order.map(function (id) { return map[id]; });
}

export function mediaIdsFromPlans(payload, notes) {
  return mediaRefsFromPlans(payload, notes).map(function (ref) { return ref.id; });
}

export function mediaIdsFromDistress(payload, notes) {
  return mediaRefsFromDistress(payload, notes).map(function (ref) { return ref.id; });
}

const STORED_FILE = {
  'index.json': { purpose: 'technical', label: 'Cabinet index' },
  'customer.json': { purpose: 'customer', label: 'Customer information' },
  'plans.json': { purpose: 'plans', label: 'Plans and canvases' },
  'distress.json': { purpose: 'distress', label: 'Distress Survey' },
  'floor.json': { purpose: 'floor', label: 'Floor Survey' },
  'diagnostics.json': { purpose: 'diagnostics', label: 'Diagnostics' },
  'report.json': { purpose: 'report', label: 'Report Builder' },
  'trash.json': { purpose: 'technical', label: 'Trash record' },
};

function annotateStoredFile(row, id) {
  const prefix = 'cf/' + id + '/';
  const filename = row.key.indexOf(prefix) === 0 ? row.key.slice(prefix.length) : '';
  const known = STORED_FILE[filename];
  if (known) {
    row.purpose = known.purpose;
    row.label = known.label;
  } else {
    row.purpose = 'other';
    row.label = filename || 'Stored file';
  }
  return row;
}

function copyIdentity(target, value) {
  if (!value || typeof value !== 'object') return;
  const name = trimmed(value.displayName);
  const address = trimmed(value.propertyAddress);
  const survey = trimmed(value.fieldWorkDate);
  const created = trimmed(value.createdAt);
  if (name) target.displayName = name;
  if (address) target.propertyAddress = address;
  if (survey) target.fieldWorkDate = survey;
  if (created) target.createdAt = created;
}

export async function readCabinetIndexListing(cabinet) {
  const listed = await listPrefix(cabinet, 'cf/');
  const files = [];
  for (let i = 0; i < listed.length; i++) {
    const obj = listed[i];
    const match = /^cf\/([^/]+)\/index\.json$/.exec(obj && obj.key);
    if (!match || !safeCustomerId(match[1])) continue;
    const row = objectMeta(obj.key, obj);
    row.id = match[1];
    const got = await cabinet.get(obj.key);
    const parsed = await readJson(got);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') {
      row.unreadable = true;
    } else {
      copyIdentity(row, parsed.value);
      const storedType = got && got.httpMetadata && got.httpMetadata.contentType;
      if (!row.contentType && typeof storedType === 'string' && storedType.trim()) {
        row.contentType = storedType;
      }
      if (typeof row.size !== 'number' && got && typeof got.size === 'number') row.size = got.size;
      if (!row.uploaded) {
        const uploaded = uploadedIso(got && got.uploaded);
        if (uploaded) row.uploaded = uploaded;
      }
    }
    files.push(row);
  }
  files.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
  return { files: files };
}

async function readManifest(cabinet, id, name, storedByKey, notes) {
  const key = 'cf/' + id + '/' + name + '.json';
  if (!storedByKey[key]) return null;
  const parsed = await readJson(await cabinet.get(key));
  if (!parsed.ok) {
    notes.push(key + ' could not be read; its media references are not listed.');
    return null;
  }
  return parsed.value;
}

async function referencedMedia(cabinet, id, storedByKey, notes) {
  const plans = await readManifest(cabinet, id, 'plans', storedByKey, notes);
  const distress = await readManifest(cabinet, id, 'distress', storedByKey, notes);
  const floor = await readManifest(cabinet, id, 'floor', storedByKey, notes);
  const diagnostics = await readManifest(cabinet, id, 'diagnostics', storedByKey, notes);
  const names = canvasNameMap(plans);
  return mergeMediaRefs(
    mediaRefsFromPlans(plans, notes)
      .concat(mediaRefsFromDistress(distress, notes))
      .concat(mediaRefsFromFloor(floor, notes, names))
      .concat(mediaRefsFromDiagnostics(diagnostics, notes)),
  );
}

export async function readCustomerFileListing(cabinet, id) {
  if (!safeCustomerId(id)) {
    return { status: 400, text: 'Bad request' };
  }
  const prefix = 'cf/' + id + '/';
  const indexKey = prefix + 'index.json';
  const listed = await listPrefix(cabinet, prefix);
  const stored = [];
  const storedByKey = Object.create(null);
  listed.forEach(function (obj) {
    if (!obj || typeof obj.key !== 'string') return;
    if (!obj.key.startsWith(prefix) || obj.key.indexOf('..') !== -1) return;
    storedByKey[obj.key] = obj;
    stored.push(annotateStoredFile(objectMeta(obj.key, obj), id));
  });
  if (!storedByKey[indexKey]) return { status: 404, text: 'Not found' };

  const notes = [];
  const identity = {};
  const indexParsed = await readJson(await cabinet.get(indexKey));
  if (indexParsed.ok) copyIdentity(identity, indexParsed.value);
  const mediaRefs = await referencedMedia(cabinet, id, storedByKey, notes);
  const objects = stored.slice();
  for (let i = 0; i < mediaRefs.length; i++) {
    const ref = mediaRefs[i];
    const key = 'media/' + ref.id;
    const head = await cabinet.head(key);
    const row = head ? objectMeta(key, head) : { key: key, missing: true };
    row.purpose = ref.purpose;
    row.label = ref.label;
    if (ref.detail) row.detail = ref.detail;
    if (ref.also && ref.also.length) row.also = ref.also.slice();
    objects.push(row);
  }
  objects.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
  const body = {
    id: id,
    prefix: prefix,
    objects: objects,
    referenceNotes: notes,
  };
  copyIdentity(body, identity);
  return { status: 200, json: body };
}

function findEntry(listing, key) {
  const objects = listing.json && listing.json.objects ? listing.json.objects : [];
  for (let i = 0; i < objects.length; i++) {
    if (objects[i] && objects[i].key === key) return objects[i];
  }
  return null;
}

async function objectBytes(got) {
  if (!got) return null;
  if (typeof got.arrayBuffer === 'function') {
    const buffer = await got.arrayBuffer();
    return new Uint8Array(buffer);
  }
  if (got.body && typeof got.body.getReader === 'function') {
    const reader = got.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      chunks.push(step.value);
      total += step.value.byteLength;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      out.set(chunks[i], offset);
      offset += chunks[i].byteLength;
    }
    return out;
  }
  return null;
}

function downloadFilename(key) {
  const parts = String(key || '').split('/');
  const base = parts[parts.length - 1] || 'object';
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_');
  return cleaned || 'object';
}

export async function readExploreObject(cabinet, id, key) {
  if (!safeCustomerId(id)) return { status: 400, text: 'Bad request' };
  if (typeof key !== 'string' || !key || key.indexOf('..') !== -1) {
    return { status: 400, text: 'Bad request' };
  }
  const listing = await readCustomerFileListing(cabinet, id);
  if (listing.status !== 200) return listing;
  const entry = findEntry(listing, key);
  if (!entry) return { status: 404, text: 'Not found' };
  if (entry.missing) return { status: 404, text: 'Not stored' };
  const got = await cabinet.get(key);
  if (!got) return { status: 404, text: 'Not stored' };
  const bytes = await objectBytes(got);
  if (!bytes) return { status: 500, text: 'Could not read File Cabinet objects' };
  const contentType = (got.httpMetadata && got.httpMetadata.contentType) || entry.contentType || 'application/octet-stream';
  return {
    status: 200,
    body: bytes,
    headers: {
      'content-type': contentType,
      'content-length': String(bytes.byteLength),
      'content-disposition': 'attachment; filename="' + downloadFilename(key) + '"',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      'access-control-expose-headers': 'content-disposition, content-type',
    },
  };
}

function dosTimeDate(iso) {
  const date = iso ? new Date(iso) : null;
  if (!date || isNaN(date.getTime()) || date.getUTCFullYear() < 1980) {
    return { time: 0, date: 33 };
  }
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  const day = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time: time, date: day };
}

function localHeader(nameBytes, crc, size, time, date) {
  const out = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, time, true);
  view.setUint16(12, date, true);
  view.setUint32(14, crc >>> 0, true);
  view.setUint32(18, size >>> 0, true);
  view.setUint32(22, size >>> 0, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  out.set(nameBytes, 30);
  return out;
}

function centralHeader(nameBytes, crc, size, time, date, offset) {
  const out = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, time, true);
  view.setUint16(14, date, true);
  view.setUint32(16, crc >>> 0, true);
  view.setUint32(20, size >>> 0, true);
  view.setUint32(24, size >>> 0, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset >>> 0, true);
  out.set(nameBytes, 46);
  return out;
}

function eocd(count, cdSize, cdOffset) {
  const out = new Uint8Array(22);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, cdSize >>> 0, true);
  view.setUint32(16, cdOffset >>> 0, true);
  view.setUint16(20, 0, true);
  return out;
}

function concatParts(parts) {
  let total = 0;
  for (let i = 0; i < parts.length; i++) total += parts[i].length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i], offset);
    offset += parts[i].length;
  }
  return out;
}

export async function buildExploreZip(cabinet, id) {
  const listing = await readCustomerFileListing(cabinet, id);
  if (listing.status !== 200) return listing;
  const stored = listing.json.objects.filter(function (entry) { return entry && !entry.missing; });
  const missing = listing.json.objects
    .filter(function (entry) { return entry && entry.missing; })
    .map(function (entry) { return entry.key; });
  const missingText = missing.length ? missing.join('\n') + '\n' : '';
  const files = [];
  for (let i = 0; i < stored.length; i++) {
    const entry = stored[i];
    const got = await cabinet.get(entry.key);
    const bytes = await objectBytes(got);
    if (!bytes) return { status: 500, text: 'Could not read File Cabinet objects' };
    if (bytes.byteLength > 0xffffffff) return { status: 413, text: 'Object is too large to archive' };
    files.push({
      name: entry.key,
      bytes: bytes,
      uploaded: entry.uploaded || null,
    });
  }
  files.push({
    name: 'missing.txt',
    bytes: new TextEncoder().encode(missingText),
    uploaded: null,
  });

  const parts = [];
  const central = [];
  let offset = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const nameBytes = new TextEncoder().encode(file.name);
    const stamp = dosTimeDate(file.uploaded);
    const crc = crc32(file.bytes);
    const local = localHeader(nameBytes, crc, file.bytes.length, stamp.time, stamp.date);
    parts.push(local, file.bytes);
    central.push(centralHeader(nameBytes, crc, file.bytes.length, stamp.time, stamp.date, offset));
    offset += local.length + file.bytes.length;
  }
  const cdStart = offset;
  for (let i = 0; i < central.length; i++) {
    parts.push(central[i]);
    offset += central[i].length;
  }
  parts.push(eocd(central.length, offset - cdStart, cdStart));
  const body = concatParts(parts);
  return {
    status: 200,
    body: body,
    headers: {
      'content-type': 'application/zip',
      'content-length': String(body.byteLength),
      'content-disposition': 'attachment; filename="cf-' + id + '.zip"',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      'access-control-expose-headers': 'content-disposition, content-type',
    },
  };
}

export async function exploreResult(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/+/, '');
  const cabinet = env && env.CABINET;
  if (!cabinet) return { status: 500, text: 'R2 cabinet binding missing' };

  try {
    if (path === 'explore/files' && request.method === 'GET') {
      const listing = await readCabinetIndexListing(cabinet);
      return { status: 200, json: listing };
    }

    let match = /^explore\/files\/([^/]+)$/.exec(path);
    if (match && request.method === 'GET') {
      return readCustomerFileListing(cabinet, decodeURIComponent(match[1]));
    }

    match = /^explore\/files\/([^/]+)\/object$/.exec(path);
    if (match && request.method === 'GET') {
      return readExploreObject(cabinet, decodeURIComponent(match[1]), url.searchParams.get('key'));
    }

    match = /^explore\/files\/([^/]+)\/archive$/.exec(path);
    if (match && request.method === 'GET') {
      return buildExploreZip(cabinet, decodeURIComponent(match[1]));
    }

    return { status: 404, text: 'Not found' };
  } catch (err) {
    console.error('File Explorer read failed', err);
    return { status: 500, text: 'Could not read File Cabinet objects' };
  }
}
