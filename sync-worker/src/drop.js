/**
 * Sandia Geo Drop Box -- a temporary download page for a job's files.
 *
 * Tim (Nov 14, 2026): send a client or engineer a link instead of a big email. The link opens a plain
 * Sandia Geo page listing the files (the report PDF, a zip of the report's photographs, anything else
 * added), each with a Download button. The copies are good for 14 days and are then deleted. The
 * originals stay in the Customer File; nothing here is the only copy of anything.
 *
 * A drop lives in the same R2 prefix and under the same public path as an engineer lookbook
 * (lookbook/<token>/), so the Cloudflare Access path bypass that already exists covers it and nothing
 * in Access changes. It is told apart by manifest.kind === 'drop'. Create / upload / finalize / remove
 * stay Access-gated. A file is uploaded in fixed-size parts (R2 multipart) so a file bigger than one
 * request can carry still arrives whole.
 */

export const DROP_TTL_DAYS = 14;
export const DROP_TTL_MS = DROP_TTL_DAYS * 24 * 60 * 60 * 1000;
/** Every part but the last must be this size (an R2 rule; the smallest R2 allows is 5 MiB). 8 MiB keeps one request short enough for a weak connection. */
export const DROP_PART_BYTES = 8 * 1024 * 1024;
export const DROP_MAX_FILES = 40;
export const DROP_MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024;

const LOGO_DATA_URI = 'data:image/png;base64,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';

/** A file name safe to keep as an R2 key and in a URL, or null when nothing usable is left. */
export function sanitizeDropFileName(name) {
  var raw = String(name == null ? '' : name).split(/[\\/]/).pop();
  var clean = raw
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+/, '');
  if (clean.length > 120) {
    var dot = clean.lastIndexOf('.');
    var ext = dot > 0 && clean.length - dot <= 12 ? clean.slice(dot) : '';
    clean = clean.slice(0, 120 - ext.length) + ext;
  }
  if (!/[a-zA-Z0-9]/.test(clean)) return null;
  if (clean === 'index.html' || clean === 'manifest.json') return null;
  return clean;
}

export function buildDropManifest(input) {
  var now = Date.now();
  return {
    schema: 'toolbox.drop',
    schemaVersion: 1,
    kind: 'drop',
    status: input.status || 'draft',
    token: input.token,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DROP_TTL_MS).toISOString(),
    ttlDays: DROP_TTL_DAYS,
    customerFileId: input.customerFileId || '',
    title: input.title || 'Your files',
    residence: input.residence || '',
    address: input.address || '',
    files: Array.isArray(input.files) ? input.files : [],
    createdBy: input.createdBy || '',
  };
}

export function humanBytes(n) {
  var bytes = Number(n) || 0;
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function longDate(iso) {
  var t = Date.parse(iso);
  if (!isFinite(t)) return '';
  var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var d = new Date(t);
  return months[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
}

/** The page the client sees: plain, branded, a file list with Download buttons. No script. */
export function dropIndexHtml(manifest) {
  var title = escapeHtml(manifest.title || 'Your files');
  var who = escapeHtml([manifest.residence, manifest.address].filter(Boolean).join(' · '));
  var until = escapeHtml(longDate(manifest.expiresAt));
  var files = Array.isArray(manifest.files) ? manifest.files : [];
  var rows = files.map(function (file) {
    var href = 'files/' + encodeURIComponent(file.name);
    return '<li class="row">' +
      '<div class="what"><strong>' + escapeHtml(file.label || file.name) + '</strong>' +
      '<span>' + escapeHtml(file.name) + ' · ' + escapeHtml(humanBytes(file.size)) + '</span></div>' +
      '<a class="btn" href="' + href + '" download="' + escapeHtml(file.name) + '">Download</a>' +
      '</li>';
  }).join('');
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<meta name="robots" content="noindex, nofollow">\n' +
    '<title>' + title + ' — Sandia Geo</title>\n' +
    '<style>' +
    'body{margin:0;background:#f4f2ec;color:#0b2233;font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
    '.wrap{max-width:640px;margin:0 auto;padding:24px 16px 48px}' +
    '.logo{display:block;height:44px;width:auto;margin:8px 0 22px}' +
    'h1{font-size:24px;margin:0 0 4px}' +
    '.who{margin:0 0 6px;color:#4b5a66}' +
    '.until{margin:0 0 22px;color:#4b5a66;font-size:14px}' +
    'ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}' +
    '.row{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#fff;border:1px solid #d9d4c8;border-radius:12px;padding:14px 16px}' +
    '.what{min-width:0;display:flex;flex-direction:column}' +
    '.what strong{font-size:17px}' +
    '.what span{font-size:13px;color:#4b5a66;overflow-wrap:anywhere}' +
    '.btn{flex:none;display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 20px;border-radius:10px;background:#0b2233;color:#fff;text-decoration:none;font-weight:700}' +
    '.note{margin-top:22px;font-size:14px;color:#4b5a66}' +
    '.empty{background:#fff;border:1px solid #d9d4c8;border-radius:12px;padding:16px}' +
    '</style>\n</head>\n<body>\n<div class="wrap">\n' +
    '<img class="logo" src="' + LOGO_DATA_URI + '" alt="Sandia Geo">\n' +
    '<h1>' + title + '</h1>\n' +
    (who ? '<p class="who">' + who + '</p>\n' : '') +
    (until ? '<p class="until">Available until ' + until + '</p>\n' : '') +
    (rows ? '<ul>' + rows + '</ul>\n' : '<p class="empty">There are no files here.</p>\n') +
    '<p class="note">Download your files and save them to your computer. This page and its files are removed after the date above.</p>\n' +
    '</div>\n</body>\n</html>\n';
}
