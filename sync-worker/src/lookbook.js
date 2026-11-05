/**
 * Engineer lookbook shares — temporary read-only report packages on R2.
 *
 * Tim (Nov 5, 2026): PDF hardcopy stays the durable deliverable; a 30-day
 * link lets an engineer browse the report online and open photographs full
 * screen. Not a second Customer File editor. Not SaaS tenancy.
 *
 * Public GET routes must be excluded from Cloudflare Access on the Worker
 * hostname (path bypass for lookbook/*). Create/upload stays Access-gated.
 */

export const LOOKBOOK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const LOOKBOOK_PREFIX = 'lookbooks/';

export function newLookbookToken() {
  var bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    out += (bytes[i] + 256).toString(16).slice(1);
  }
  return out;
}

export function lookbookRoot(token) {
  return LOOKBOOK_PREFIX + token + '/';
}

export function lookbookManifestKey(token) {
  return lookbookRoot(token) + 'manifest.json';
}

export function lookbookObjectKey(token, relativePath) {
  var clean = String(relativePath || '')
    .replace(/^\/+/, '')
    .replace(/\.\./g, '');
  if (!clean || clean.indexOf('..') !== -1) return null;
  return lookbookRoot(token) + clean;
}

export function isExpired(manifest, nowMs) {
  if (!manifest || typeof manifest.expiresAt !== 'string') return true;
  var exp = Date.parse(manifest.expiresAt);
  if (!isFinite(exp)) return true;
  return (typeof nowMs === 'number' ? nowMs : Date.now()) >= exp;
}

export function buildManifest(input) {
  var now = Date.now();
  var expiresAt = new Date(now + LOOKBOOK_TTL_MS).toISOString();
  return {
    schema: 'toolbox.lookbook',
    schemaVersion: 1,
    status: input.status || 'draft',
    token: input.token,
    createdAt: new Date(now).toISOString(),
    expiresAt: expiresAt,
    ttlDays: 30,
    customerFileId: input.customerFileId || '',
    title: input.title || 'Report lookbook',
    residence: input.residence || '',
    address: input.address || '',
    pages: Array.isArray(input.pages) ? input.pages : [],
    photos: Array.isArray(input.photos) ? input.photos : [],
    createdBy: input.createdBy || '',
  };
}

/** Safe relative object path under a lookbook token (no traversal). */
export function sanitizeLookbookRelativePath(relativePath) {
  var raw = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!raw || raw.length > 180) return null;
  var parts = raw.split('/');
  var out = [];
  for (var i = 0; i < parts.length; i += 1) {
    var part = parts[i];
    if (!part || part === '.' || part === '..') return null;
    if (!/^[a-zA-Z0-9._-]+$/.test(part)) return null;
    out.push(part);
  }
  if (!out.length) return null;
  return out.join('/');
}

export function lookbookContentType(relativePath) {
  var name = String(relativePath || '').toLowerCase();
  if (name.endsWith('.html')) return 'text/html; charset=utf-8';
  if (name.endsWith('.css')) return 'text/css; charset=utf-8';
  if (name.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (name.endsWith('.json')) return 'application/json; charset=utf-8';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

/**
 * Minimal lookbook HTML. Sheet stills and photos are relative to this file.
 * Print / Save as PDF uses the browser print dialog (same as Toolbox).
 */
export function lookbookIndexHtml(manifest) {
  var title = escapeHtml(manifest.title || 'Report lookbook');
  var residence = escapeHtml(manifest.residence || '');
  var address = escapeHtml(manifest.address || '');
  var expires = escapeHtml(manifest.expiresAt || '');
  var payload = JSON.stringify({
    title: manifest.title || 'Report lookbook',
    residence: manifest.residence || '',
    address: manifest.address || '',
    expiresAt: manifest.expiresAt || '',
    pages: manifest.pages || [],
    photos: manifest.photos || [],
  }).replace(/</g, '\\u003c');

  return '<!doctype html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + title + '</title>\n' +
    '<link rel="stylesheet" href="lookbook.css">\n' +
    '</head>\n' +
    '<body>\n' +
    '<header class="lb-top">\n' +
    '  <div class="lb-top__id">\n' +
    '    <strong>' + title + '</strong>\n' +
    '    <span>' + residence + (address ? ' · ' + address : '') + '</span>\n' +
    '  </div>\n' +
    '  <div class="lb-top__actions">\n' +
    '    <span class="lb-expiry">Available until ' + expires.slice(0, 10) + '</span>\n' +
    '    <button type="button" id="lb-print" class="lb-btn">Save as PDF</button>\n' +
    '  </div>\n' +
    '</header>\n' +
    '<nav class="lb-tabs" role="tablist">\n' +
    '  <button type="button" class="lb-tab is-on" data-lb-tab="report">Report</button>\n' +
    '  <button type="button" class="lb-tab" data-lb-tab="photos">Photographs</button>\n' +
    '</nav>\n' +
    '<main id="lb-report" class="lb-pane is-on"></main>\n' +
    '<main id="lb-photos" class="lb-pane" hidden></main>\n' +
    '<div id="lb-viewer" class="lb-viewer" hidden></div>\n' +
    '<script type="application/json" id="lb-data">' + payload + '</script>\n' +
    '<script src="lookbook.js"></script>\n' +
    '</body>\n' +
    '</html>\n';
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
