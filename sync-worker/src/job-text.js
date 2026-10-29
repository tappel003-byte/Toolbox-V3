/**
 * A plain-text file per job, so a search reads text instead of opening jobs.
 *
 * Tim's design: the customer, the report's wording, and the pin and picture
 * descriptions, as plain text -- so "half inch drywall crack" is found by
 * scanning words rather than by opening every job and reading its records.
 * Each part sits under a labelled heading, so a hit says where it came from:
 * a field observation the investigator wrote at the property, a measurement,
 * or a conclusion written in the report afterwards. Those are different
 * kinds of statement (VISION section 2) and a search must not blur them.
 *
 * DERIVED, NEVER AUTHORITATIVE. The text is built from the components the
 * index names (resolveAcceptedComponent, the same resolution every other
 * reader uses) and stored beside them as cf/{id}/search.txt. Nothing reads it
 * back into a job. It carries the etag of the index it was built from; when
 * the index has moved on, the text is stale and is built again from the
 * components. A job never searched has no text yet and gets one the first
 * time a search reaches it -- which is how the jobs already in the Cabinet
 * are included: the Worker READS them.
 *
 * What this never does: write a job's index, touch a checkout lease, or
 * write any component or media. The only object it writes is its own
 * search.txt, and it removes that again if the job turned out to be gone.
 */

import { resolveAcceptedComponent } from './components.js';

export const JOB_TEXT_FORMAT = '1';
export const JOB_TEXT_LEAF = 'search.txt';
/** Jobs whose text is built in one request; the rest wait for the next. */
export const MAX_BUILDS_PER_SEARCH = 20;
const MAX_HITS_PER_JOB = 3;

const COMPONENTS = ['customer', 'plans', 'distress', 'floor', 'report', 'diagnostics'];

export function jobTextKey(id) {
  return 'cf/' + id + '/' + JOB_TEXT_LEAF;
}

function trim(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Report wording is rich text or a plain string; either way, its words. */
export function plainText(value) {
  if (typeof value === 'string') return value;
  if (!isObject(value) || !Array.isArray(value.paragraphs)) return '';
  return value.paragraphs.map(function (p) {
    const runs = isObject(p) && Array.isArray(p.runs) ? p.runs : [];
    return runs.map(function (r) { return isObject(r) && typeof r.text === 'string' ? r.text : ''; }).join('');
  }).join('\n');
}

function lines(value) {
  return plainText(value).split(/\r?\n/).map(trim).filter(Boolean);
}

function canvasNames(plans) {
  const names = Object.create(null);
  const canvases = isObject(plans) && Array.isArray(plans.canvases) ? plans.canvases : [];
  canvases.forEach(function (canvas, i) {
    if (!isObject(canvas) || typeof canvas.id !== 'string') return;
    names[canvas.id] = trim(canvas.name) || ('Level ' + (i + 1));
  });
  return names;
}

/** The section headings. Each says what KIND of statement sits under it. */
export const SECTIONS = {
  customer: 'Customer',
  pins: 'Field observation · Distress pins',
  photos: 'Field observation · Photographs',
  floor: 'Field measurement · Floor Survey',
  discussion: 'Conclusion · Report discussion',
  captions: 'Report wording · Picture captions',
  notes: 'Report wording · Picture location notes',
  other: 'Report wording · Other report text',
  diagnostics: 'Diagnostics',
};

function heading(title) {
  return '== ' + title + ' ==';
}

function customerLines(customer, index) {
  const c = isObject(customer) ? customer : {};
  const idx = isObject(index) ? index : {};
  const out = [];
  const name = [trim(c.firstName), trim(c.lastName)].filter(Boolean).join(' ') || trim(idx.displayName);
  if (name) out.push('Name: ' + name);
  if (trim(c.spouseName)) out.push('Also: ' + trim(c.spouseName));
  if (trim(c.companyName)) out.push('Company: ' + trim(c.companyName));
  const property = trim(c.propertyAddress) || trim(idx.propertyAddress);
  if (property) out.push('Property: ' + property);
  if (!c.mailingSameAsProperty && trim(c.mailingAddress)) out.push('Mailing: ' + trim(c.mailingAddress));
  ['cellPhone', 'homePhone', 'email', 'spouseCellPhone', 'spouseHomePhone', 'spouseEmail'].forEach(function (key) {
    if (trim(c[key])) out.push('Contact: ' + trim(c[key]));
  });
  lines(c.notes).forEach(function (line) { out.push('Note: ' + line); });
  if (trim(idx.fieldWorkDate)) out.push('Field work date: ' + trim(idx.fieldWorkDate));
  if (trim(idx.deletedAt)) out.push('In File Cabinet Trash');
  return out;
}

function pinLines(distress, names) {
  const pins = isObject(distress) && Array.isArray(distress.pins) ? distress.pins.filter(isObject) : [];
  return pins.slice().sort(function (a, b) {
    const an = typeof a.num === 'number' ? a.num : Infinity;
    const bn = typeof b.num === 'number' ? b.num : Infinity;
    return an - bn;
  }).map(function (pin) {
    const where = [];
    // The stored number, never recomputed: photograph numbering belongs to
    // Distress Survey and is not re-derived here.
    if (typeof pin.num === 'number' && isFinite(pin.num)) where.push('Pin ' + pin.num);
    else where.push('Pin');
    const level = names[trim(pin.canvasId)];
    if (level) where.push(level);
    if (trim(pin.location)) where.push(trim(pin.location));
    if (trim(pin.category)) where.push(trim(pin.category));
    const said = lines(pin.description).join(' ');
    const photos = Array.isArray(pin.photos) ? pin.photos.length : 0;
    const tail = photos ? ' [' + photos + (photos === 1 ? ' photograph]' : ' photographs]') : '';
    return where.join(' · ') + (said ? ': ' + said : '') + tail;
  }).filter(function (line) { return /:/.test(line); });
}

function photoLines(distress, customer) {
  const out = [];
  const d = isObject(distress) ? distress : {};
  (Array.isArray(d.quickCapture) ? d.quickCapture : []).forEach(function (item) {
    if (!isObject(item)) return;
    const bits = [trim(item.folder), trim(item.subject), trim(item.sourceName), trim(item.description)].filter(Boolean);
    if (bits.length) out.push('Quick Capture · ' + bits.join(' · '));
  });
  const collection = function (list, label) {
    (Array.isArray(list) ? list : []).forEach(function (entry) {
      if (!isObject(entry)) return;
      const bits = [trim(entry.subject), trim(entry.folder), trim(entry.description)].filter(Boolean);
      if (bits.length) out.push(label + ' · ' + bits.join(' · '));
    });
  };
  collection(d.unassignedPhotos, 'Unassigned photo');
  collection(d.generalPhotos, 'General photo');
  collection(isObject(customer) ? customer.generalPhotos : null, 'General photo');
  return out;
}

function floorLines(floor, names) {
  const out = [];
  const layers = isObject(floor) && isObject(floor.byCanvasId) ? floor.byCanvasId : {};
  Object.keys(layers).forEach(function (canvasId) {
    const layer = layers[canvasId];
    if (!isObject(layer)) return;
    const level = names[canvasId] || trim(layer.name) || 'Level';
    const readings = Array.isArray(layer.points) ? layer.points.length : 0;
    const head = [level];
    if (readings) head.push(readings + (readings === 1 ? ' reading' : ' readings'));
    if (trim(layer.inspectionDate)) head.push('surveyed ' + trim(layer.inspectionDate));
    out.push(head.join(' · '));
    (Array.isArray(layer.areas) ? layer.areas : []).forEach(function (area) {
      if (isObject(area) && trim(area.name)) out.push(level + ' · Boundary: ' + trim(area.name));
    });
    (Array.isArray(layer.transitions) ? layer.transitions : []).forEach(function (t) {
      if (!isObject(t)) return;
      const name = trim(t.name) || trim(t.label);
      const notes = lines(t.notes).join(' ');
      if (name || notes) out.push(level + ' · Transition: ' + [name, notes].filter(Boolean).join(' — '));
    });
    lines(layer.notes).forEach(function (line) { out.push(level + ' · Note: ' + line); });
  });
  return out;
}

function reportLines(report) {
  const found = { discussion: [], captions: [], notes: [], other: [] };
  if (!isObject(report)) return found;
  const pages = Array.isArray(report.pages) ? report.pages.filter(isObject) : [];
  pages.forEach(function (page) {
    const text = isObject(page.reportText) ? page.reportText : {};
    const meta = isObject(page.meta) ? page.meta : {};
    const title = trim(page.title);
    const isDiscussion = meta.sectionId === 'discussion' || /discussion/i.test(title);
    lines(text.body).forEach(function (line) {
      (isDiscussion ? found.discussion : found.other).push(line);
    });
    if (isObject(text.captions)) {
      Object.keys(text.captions).forEach(function (key) {
        lines(text.captions[key]).forEach(function (line) { found.captions.push(line); });
      });
    }
    if (isObject(text.notes)) {
      Object.keys(text.notes).forEach(function (key) {
        lines(text.notes[key]).forEach(function (line) { found.notes.push(line); });
      });
    }
    if (isObject(text.rail)) {
      Object.keys(text.rail).forEach(function (key) {
        lines(text.rail[key]).forEach(function (line) { found.other.push(line); });
      });
    }
    if (Array.isArray(text.contents)) {
      text.contents.forEach(function (entry) {
        if (isObject(entry)) lines(entry.text).forEach(function (line) { found.other.push(line); });
      });
    }
    (Array.isArray(meta.overlays) ? meta.overlays : []).forEach(function (overlay) {
      if (isObject(overlay) && overlay.kind === 'text') {
        lines(overlay.text).forEach(function (line) { found.other.push(line); });
      }
    });
  });
  const pen = isObject(report.penLog) && isObject(report.penLog.notes) ? report.penLog.notes : {};
  Object.keys(pen).forEach(function (key) {
    lines(pen[key]).forEach(function (line) { found.notes.push(line); });
  });
  // The same caption on two sheets is one statement, not two hits.
  Object.keys(found).forEach(function (name) {
    const seen = Object.create(null);
    found[name] = found[name].filter(function (line) {
      if (seen[line]) return false;
      seen[line] = 1;
      return true;
    });
  });
  return found;
}

function diagnosticsLines(diagnostics) {
  const out = [];
  if (!isObject(diagnostics)) return out;
  (Array.isArray(diagnostics.entries) ? diagnostics.entries : []).forEach(function (entry) {
    if (!isObject(entry)) return;
    ['title', 'note', 'notes', 'caption'].forEach(function (key) {
      lines(entry[key]).forEach(function (line) { out.push(line); });
    });
  });
  (Array.isArray(diagnostics.figures) ? diagnostics.figures : []).forEach(function (fig) {
    if (!isObject(fig)) return;
    ['title', 'caption'].forEach(function (key) {
      lines(fig[key]).forEach(function (line) { out.push(line); });
    });
  });
  return out;
}

/**
 * The text itself. Pure: components in, a string out. A component that is
 * absent contributes no section, and nothing is filled in for it.
 */
export function buildJobText(id, index, components) {
  const parts = components || {};
  const names = canvasNames(parts.plans);
  const out = [];
  out.push('Toolbox job text — ' + (trim(index && index.displayName) || id));
  out.push('Built from the stored job for searching. The job itself is the record; this file is not.');
  const add = function (title, body) {
    if (!body.length) return;
    out.push('');
    out.push(heading(title));
    body.forEach(function (line) { out.push(line); });
  };
  add(SECTIONS.customer, customerLines(parts.customer, index));
  add(SECTIONS.pins, pinLines(parts.distress, names));
  add(SECTIONS.photos, photoLines(parts.distress, parts.customer));
  add(SECTIONS.floor, floorLines(parts.floor, names));
  const report = reportLines(parts.report);
  add(SECTIONS.discussion, report.discussion);
  add(SECTIONS.captions, report.captions);
  add(SECTIONS.notes, report.notes);
  add(SECTIONS.other, report.other);
  add(SECTIONS.diagnostics, diagnosticsLines(parts.diagnostics));
  if (parts.unreadable && parts.unreadable.length) {
    out.push('');
    out.push('Not included, because the stored record could not be read: ' + parts.unreadable.join(', ') + '.');
  }
  return out.join('\n') + '\n';
}

async function readJsonObject(got) {
  if (!got) return { absent: true };
  try {
    return { value: await got.json() };
  } catch (_) {
    return { unreadable: true };
  }
}

function indexVersion(obj) {
  return (obj && (obj.etag || obj.httpEtag)) || '';
}

/**
 * Build one job's text from its components and store it. Returns the text,
 * or null when the job is not there to describe (no index, or purged).
 */
export async function buildAndStoreJobText(cabinet, id) {
  const indexGot = await cabinet.get('cf/' + id + '/index.json');
  if (!indexGot) return null;
  const version = indexVersion(indexGot);
  const indexRead = await readJsonObject(indexGot);
  if (!indexRead.value || !isObject(indexRead.value) || indexRead.value.purged) return null;
  const index = indexRead.value;
  const components = { unreadable: [] };
  for (let i = 0; i < COMPONENTS.length; i++) {
    const name = COMPONENTS[i];
    const resolved = resolveAcceptedComponent(index, id, name);
    const read = await readJsonObject(await cabinet.get(resolved.key));
    if (read.value && typeof read.value === 'object') components[name] = read.value;
    else if (read.unreadable) components.unreadable.push(name);
  }
  const text = buildJobText(id, index, components);
  await cabinet.put(jobTextKey(id), text, {
    httpMetadata: { contentType: 'text/plain; charset=utf-8' },
    customMetadata: { indexEtag: version, format: JOB_TEXT_FORMAT },
  });
  // A permanent delete that ran while this was being read would leave the
  // text behind with no job. Look once more, and take it back if so.
  const after = await cabinet.head('cf/' + id + '/index.json');
  if (!after) {
    try { await cabinet.delete(jobTextKey(id)); } catch (_) {}
    return null;
  }
  return text;
}

/** Is the stored text the one for this version of the index? */
export function textIsCurrent(textMeta, indexEtag) {
  const meta = textMeta && textMeta.customMetadata;
  return !!meta && meta.format === JOB_TEXT_FORMAT && !!indexEtag && meta.indexEtag === indexEtag;
}

/**
 * Every job's index and text object, from one listing of cf/.
 */
async function listJobs(cabinet) {
  const jobs = Object.create(null);
  let cursor;
  for (;;) {
    const options = { prefix: 'cf/', include: ['customMetadata'] };
    if (cursor) options.cursor = cursor;
    const listed = await cabinet.list(options);
    const objects = listed && listed.objects ? listed.objects : [];
    objects.forEach(function (obj) {
      const match = /^cf\/([^/]+)\/(index\.json|search\.txt)$/.exec(obj && obj.key);
      if (!match) return;
      const job = jobs[match[1]] || (jobs[match[1]] = { id: match[1] });
      if (match[2] === 'index.json') job.index = obj;
      else job.text = obj;
    });
    if (!listed || !listed.truncated || !listed.cursor) break;
    cursor = listed.cursor;
  }
  return Object.keys(jobs).map(function (id) { return jobs[id]; }).filter(function (job) {
    return !!job.index;
  });
}

/** The job's text: the stored one when current, else built now. */
export async function currentJobText(cabinet, id) {
  const index = await cabinet.head('cf/' + id + '/index.json');
  if (!index) return null;
  const stored = await cabinet.head(jobTextKey(id));
  if (stored && textIsCurrent(stored, indexVersion(index))) {
    const got = await cabinet.get(jobTextKey(id));
    if (got) return await got.text();
  }
  return buildAndStoreJobText(cabinet, id);
}

export function queryWords(query) {
  return String(query || '').toLowerCase().split(/[^a-z0-9'"/.\-]+/).map(function (w) {
    return w.replace(/^[^a-z0-9]+|[^a-z0-9"]+$/g, '');
  }).filter(function (w) { return w.length > 0; }).slice(0, 12);
}

/**
 * Where in one job's text the words are. A job matches when every word is
 * somewhere in it; the hits are the lines holding the most of them, each
 * with the heading it sits under.
 */
export function findInText(text, words) {
  if (!words.length) return null;
  const folded = String(text || '').toLowerCase();
  for (let i = 0; i < words.length; i++) {
    if (folded.indexOf(words[i]) === -1) return null;
  }
  const rows = String(text || '').split('\n');
  let section = '';
  const scored = [];
  rows.forEach(function (line, at) {
    const head = /^== (.+) ==$/.exec(line);
    if (head) { section = head[1]; return; }
    if (!section || !line.trim()) return;
    const low = line.toLowerCase();
    let score = 0;
    words.forEach(function (w) { if (low.indexOf(w) !== -1) score += 1; });
    if (score) scored.push({ section: section, line: line, score: score, at: at });
  });
  scored.sort(function (a, b) { return b.score - a.score || a.at - b.at; });
  return scored.slice(0, MAX_HITS_PER_JOB).map(function (hit) {
    return { section: hit.section, text: hit.line, all: hit.score === words.length };
  });
}

function readIdentity(text) {
  const first = String(text || '').split('\n', 1)[0] || '';
  const name = first.replace(/^Toolbox job text — /, '');
  const property = /\nProperty: ([^\n]+)/.exec(text || '');
  const date = /\nField work date: ([^\n]+)/.exec(text || '');
  return {
    displayName: name,
    propertyAddress: property ? property[1] : '',
    fieldWorkDate: date ? date[1] : '',
    inTrash: /\nIn File Cabinet Trash\n/.test(text || ''),
  };
}

/**
 * Search every job's text. Reads the stored text where it is current and
 * builds it where it is not, up to MAX_BUILDS_PER_SEARCH jobs a request; how
 * many were left for next time is said, never hidden.
 */
export async function searchJobText(cabinet, query) {
  const words = queryWords(query);
  if (!words.length) return { status: 400, text: 'Search words required' };
  const jobs = await listJobs(cabinet);
  const results = [];
  let built = 0;
  let attempts = 0;
  let notYet = 0;
  let gone = 0;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    let text = null;
    if (job.text && textIsCurrent(job.text, indexVersion(job.index))) {
      const got = await cabinet.get(job.text.key);
      text = got ? await got.text() : null;
    }
    if (text === null) {
      if (attempts >= MAX_BUILDS_PER_SEARCH) { notYet += 1; continue; }
      attempts += 1;
      try {
        text = await buildAndStoreJobText(cabinet, job.id);
      } catch (err) {
        console.error('Job text could not be built', job.id, err);
        notYet += 1;
        continue;
      }
      // Being permanently deleted: not a job to search, and not counted.
      if (text === null) { gone += 1; continue; }
      built += 1;
    }
    const hits = findInText(text, words);
    if (!hits) continue;
    results.push(Object.assign({ id: job.id, hits: hits }, readIdentity(text)));
  }
  results.sort(function (a, b) {
    const da = a.fieldWorkDate || '';
    const db = b.fieldWorkDate || '';
    if (da !== db) return da < db ? 1 : -1;
    return a.displayName < b.displayName ? -1 : 1;
  });
  return {
    status: 200,
    json: {
      query: String(query || ''),
      words: words,
      searched: jobs.length - gone - notYet,
      total: jobs.length - gone,
      notYetRead: notYet,
      built: built,
      results: results,
    },
  };
}
