/**
 * The searchable text file per job: built on the Worker from the components
 * the index names, labelled by kind of statement, stored beside the job as
 * cf/{id}/search.txt, rebuilt when the index moves on. Never writes an index,
 * a lease, a component or a photograph. Synthetic bucket only.
 * Run: node tests/explorer-job-text-worker.mjs
 */
import worker from '../sync-worker/src/index.js';
import {
  buildJobText,
  findInText,
  queryWords,
  SECTIONS,
  MAX_BUILDS_PER_SEARCH,
} from '../sync-worker/src/job-text.js';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

let etagCounter = 0;
function createCabinet(seed) {
  const objects = new Map();
  const ops = [];
  const store = (key, body, options) => {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    objects.set(key, {
      bytes,
      etag: 'e' + (++etagCounter),
      contentType: options && options.httpMetadata && options.httpMetadata.contentType,
      customMetadata: (options && options.customMetadata) || undefined,
    });
  };
  seed.forEach((row) => store(row.key, row.body, { httpMetadata: { contentType: 'application/json' } }));
  const meta = (key, row) => ({
    key,
    size: row.bytes.byteLength,
    etag: row.etag,
    httpEtag: '"' + row.etag + '"',
    uploaded: new Date('2026-10-01T00:00:00Z'),
    httpMetadata: row.contentType ? { contentType: row.contentType } : {},
    customMetadata: row.customMetadata,
  });
  return {
    ops,
    objects,
    store,
    async list(opts) {
      const prefix = (opts && opts.prefix) || '';
      ops.push('list ' + prefix);
      const withCustom = !!(opts && Array.isArray(opts.include) && opts.include.indexOf('customMetadata') !== -1);
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      return {
        truncated: false,
        objects: keys.map((key) => {
          const row = meta(key, objects.get(key));
          if (!withCustom) delete row.customMetadata;
          return row;
        }),
      };
    },
    async head(key) {
      ops.push('head ' + key);
      const row = objects.get(key);
      return row ? meta(key, row) : null;
    },
    async get(key) {
      ops.push('get ' + key);
      const row = objects.get(key);
      if (!row) return null;
      const copy = new Uint8Array(row.bytes);
      return Object.assign(meta(key, row), {
        body: new ReadableStream({ start(c) { c.enqueue(copy); c.close(); } }),
        async text() { return new TextDecoder().decode(copy); },
        async json() { return JSON.parse(new TextDecoder().decode(copy)); },
        async arrayBuffer() { return copy.buffer; },
      });
    },
    async put(key, body, options) {
      ops.push('put ' + key);
      store(key, body, options);
      return { key };
    },
    async delete(key) {
      ops.push('delete ' + key);
      objects.delete(key);
    },
  };
}

const ID = 'job-sorenson';
const index = {
  id: ID,
  displayName: 'Rhonda Sorenson',
  propertyAddress: '4925 Edwards Dr NE, Albuquerque, NM 87111',
  fieldWorkDate: '2026-10-07',
  checkout: { email: 'tim@example.com', deviceId: 'device-a', checkedOutAt: '2026-10-01T00:00:00Z' },
  // Distress has been published: the current bytes are the candidate, and
  // the legacy key holds an OLDER version that must not be read.
  components: { distress: { key: `cf/${ID}/c/distress/tok1.json`, revision: '2026-10-07T00:00:00.000Z' } },
};
const customer = {
  firstName: 'Rhonda',
  lastName: 'Sorenson',
  propertyAddress: '4925 Edwards Dr NE, Albuquerque, NM 87111',
  cellPhone: '505-555-0100',
  notes: 'Gate code 4411',
};
const plans = { canvases: [{ id: 'cv-main', name: 'Main Level' }, { id: 'cv-base', name: 'Basement' }] };
const distressCurrent = {
  pins: [
    { num: 4, canvasId: 'cv-main', location: 'Hall', description: 'Half inch drywall crack over the door', photos: ['ph_1', 'ph_2'] },
    { num: 1, canvasId: 'cv-base', location: 'Utility', description: 'Hairline crack in slab', photos: ['ph_0'] },
  ],
  quickCapture: [{ id: 'ph_q', folder: 'Exterior', sourceName: 'porch.jpg' }],
};
const distressOld = { pins: [{ num: 1, description: 'stale words from a replaced survey' }] };
const floor = {
  byCanvasId: {
    'cv-main': {
      inspectionDate: '2026-10-07',
      points: [{ value: 0 }, { value: -0.5 }],
      areas: [{ name: 'Sunken den' }],
      transitions: [{ name: 'Den step', notes: 'Two inch drop at the den' }],
    },
  },
};
const report = {
  pages: [
    {
      title: 'Discussion',
      meta: { sectionId: 'discussion' },
      reportText: {
        body: { paragraphs: [
          { runs: [{ text: 'The drywall crack over the hall door is ' }, { text: 'consistent with', bold: true }, { text: ' differential settlement.' }] },
          { runs: [] },
          { runs: [{ text: 'Monitoring is recommended.' }] },
        ] },
      },
    },
    { title: 'Pictures', meta: { photoKeys: ['ph_1'] }, reportText: { captions: { ph_1: 'Drywall crack above hall door, half inch' } } },
    { title: 'Pictures', meta: { photoKeys: ['ph_1'] }, reportText: { captions: { ph_1: 'Drywall crack above hall door, half inch' } } },
  ],
  penLog: { notes: { pin4: 'Crack runs to ceiling' } },
};

function seedJob() {
  return createCabinet([
    { key: `cf/${ID}/index.json`, body: JSON.stringify(index) },
    { key: `cf/${ID}/customer.json`, body: JSON.stringify(customer) },
    { key: `cf/${ID}/plans.json`, body: JSON.stringify(plans) },
    { key: `cf/${ID}/distress.json`, body: JSON.stringify(distressOld) },
    { key: `cf/${ID}/c/distress/tok1.json`, body: JSON.stringify(distressCurrent) },
    { key: `cf/${ID}/floor.json`, body: JSON.stringify(floor) },
    { key: `cf/${ID}/report.json`, body: JSON.stringify(report) },
    { key: 'cf/job-other/index.json', body: JSON.stringify({ id: 'job-other', displayName: 'Marcus Yazzie', fieldWorkDate: '2026-10-02' }) },
    { key: 'cf/job-other/distress.json', body: JSON.stringify({ pins: [{ num: 1, description: 'Door sticks in bedroom' }] }) },
    { key: 'cf/job-gone/index.json', body: JSON.stringify({ id: 'job-gone', purged: { at: '2026-10-01' } }) },
    { key: 'media/ph_1', body: 'jpeg' },
  ]);
}

// ---- Access, as the other explore tests sign it.
const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
);
const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
Object.assign(publicJwk, { kid: 'text-test', alg: 'RS256', use: 'sig' });
const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid: 'text-test', typ: 'JWT' })));
const now = Math.floor(Date.now() / 1000);
const payload = b64url(new TextEncoder().encode(JSON.stringify({
  iss: 'https://toolbox-test.cloudflareaccess.com', aud: 'aud-text-test', exp: now + 600, nbf: now - 10, email: 'tim@example.com', sub: 's',
})));
const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(header + '.' + payload));
const token = header + '.' + payload + '.' + b64url(new Uint8Array(sig));
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/cdn-cgi/access/certs')) {
    return new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { 'content-type': 'application/json' } });
  }
  return realFetch(url);
};
async function call(path, cabinet, options) {
  const opts = options || {};
  const headers = new Headers();
  if (opts.auth !== false) headers.set('Cf-Access-Jwt-Assertion', token);
  return worker.fetch(new Request('https://sync.example/' + path, { method: opts.method || 'GET', headers }), {
    CABINET: cabinet, CF_ACCESS_TEAM_DOMAIN: 'toolbox-test.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-text-test',
  });
}

// ---------------------------------------------------------------- the text
const text = buildJobText(ID, index, { customer, plans, distress: distressCurrent, floor, report });
const sectionOrder = [...text.matchAll(/^== (.+) ==$/gm)].map((m) => m[1]);
check('sections are labelled by kind of statement', JSON.stringify(sectionOrder) === JSON.stringify([
  SECTIONS.customer, SECTIONS.pins, SECTIONS.photos, SECTIONS.floor,
  SECTIONS.discussion, SECTIONS.captions, SECTIONS.notes,
]), JSON.stringify(sectionOrder));
check('an observation and a conclusion sit under different headings',
  SECTIONS.pins.startsWith('Field observation') && SECTIONS.discussion.startsWith('Conclusion'));
check('pins carry their stored number, level and room',
  text.includes('Pin 4 · Main Level · Hall: Half inch drywall crack over the door [2 photographs]'));
check('pins are listed by their stored number',
  text.indexOf('Pin 1 · Basement') < text.indexOf('Pin 4 · Main Level'));
check('the customer summary is there', text.includes('Name: Rhonda Sorenson') &&
  text.includes('Property: 4925 Edwards Dr NE') && text.includes('Note: Gate code 4411') && text.includes('Contact: 505-555-0100'));
check('rich report text comes out as words',
  text.includes('The drywall crack over the hall door is consistent with differential settlement.'));
check('a caption repeated on two sheets is one line',
  text.split('Drywall crack above hall door, half inch').length === 2);
check('boundaries and transitions are searchable',
  text.includes('Main Level · Boundary: Sunken den') && text.includes('Den step — Two inch drop at the den'));
check('the text says it is not the record', /not\.?$/m.test(text.split('\n')[1]) || text.includes('this file is not'));
check('an absent component contributes no section',
  !buildJobText(ID, index, { customer }).includes('== ' + SECTIONS.pins));

// ---------------------------------------------------------------- matching
const words = queryWords('Half inch drywall crack');
const hits = findInText(text, words);
check('every word must be in the job', findInText(text, queryWords('basement flood')) === null);
check('the best hit is the line holding every word, with its heading',
  hits && hits[0].all && hits[0].section === SECTIONS.pins && /Half inch drywall crack/.test(hits[0].text),
  JSON.stringify(hits));
check('a hit in a caption says it is report wording',
  hits.some((h) => h.section === SECTIONS.captions));
check('matching ignores case', findInText(text, queryWords('HALF INCH')) !== null);

// ---------------------------------------------------------------- the routes
{
  const cabinet = seedJob();
  const indexBefore = new TextDecoder().decode(cabinet.objects.get(`cf/${ID}/index.json`).bytes);
  const res = await call('explore/search?q=' + encodeURIComponent('half inch drywall crack'), cabinet);
  const body = await res.json();
  check('search answers', res.status === 200, String(res.status));
  check('only the job that says it is found',
    body.results.length === 1 && body.results[0].id === ID, JSON.stringify(body.results.map((r) => r.id)));
  check('the result names the job', body.results[0].displayName === 'Rhonda Sorenson' &&
    body.results[0].fieldWorkDate === '2026-10-07');
  check('jobs with no text yet were read by the Worker to make one',
    body.built === 2 && body.notYetRead === 0 && body.total === 2, JSON.stringify(body));
  check('the text is read from the component the index names, not the legacy key',
    cabinet.ops.includes(`get cf/${ID}/c/distress/tok1.json`) && !cabinet.ops.includes(`get cf/${ID}/distress.json`));
  const stored = cabinet.objects.get(`cf/${ID}/search.txt`);
  check('the text is stored beside the job', !!stored &&
    new TextDecoder().decode(stored.bytes).includes('Half inch drywall crack'));
  check('the replaced survey\'s words are not in it',
    !new TextDecoder().decode(stored.bytes).includes('stale words'));
  const writes = cabinet.ops.filter((op) => /^(put|delete) /.test(op));
  check('the only writes are the job text files',
    writes.length === 2 && writes.every((op) => /^put cf\/[^/]+\/search\.txt$/.test(op)), writes.join(', '));
  check('the index is never rewritten and the lease never moves',
    new TextDecoder().decode(cabinet.objects.get(`cf/${ID}/index.json`).bytes) === indexBefore);
  check('a purged job is not described', !cabinet.objects.has('cf/job-gone/search.txt'));

  // A second search reads the stored text and builds nothing.
  cabinet.ops.length = 0;
  const again = await (await call('explore/search?q=door', cabinet)).json();
  check('a second search builds nothing', again.built === 0 && again.total === 2 &&
    !cabinet.ops.some((op) => op.startsWith('put ')), JSON.stringify(cabinet.ops));
  check('it reads no components either', !cabinet.ops.some((op) => /customer\.json|plans\.json|floor\.json/.test(op)));
  check('both jobs that say "door" are found, newest first',
    again.results.map((r) => r.id).join(',') === `${ID},job-other`, JSON.stringify(again.results.map((r) => r.id)));

  // The job changes: the index moves on, so the text is stale and rebuilt.
  const changed = Object.assign({}, distressCurrent, {
    pins: [{ num: 1, canvasId: 'cv-main', location: 'Kitchen', description: 'Diagonal crack at window corner', photos: [] }],
  });
  cabinet.store(`cf/${ID}/c/distress/tok2.json`, JSON.stringify(changed));
  const nextIndex = Object.assign({}, index, { components: { distress: { key: `cf/${ID}/c/distress/tok2.json` } } });
  cabinet.store(`cf/${ID}/index.json`, JSON.stringify(nextIndex));
  cabinet.ops.length = 0;
  const after = await (await call('explore/search?q=' + encodeURIComponent('diagonal crack'), cabinet)).json();
  check('a job whose index moved on is read again', after.built === 1 && after.results.length === 1 &&
    after.results[0].hits[0].section === SECTIONS.pins, JSON.stringify(after));

  // The single job text route.
  const one = await call(`explore/files/${ID}/text`, cabinet);
  const oneText = await one.text();
  check('one job\'s text can be opened', one.status === 200 &&
    /text\/plain/.test(one.headers.get('content-type')) && oneText.includes('Diagonal crack'));
  const none = await call('explore/files/job-nowhere/text', cabinet);
  check('a job that is not there has no text', none.status === 404);

  // The listing labels it rather than leaving a bare filename.
  const listing = await (await call(`explore/files/${ID}`, cabinet)).json();
  const row = listing.objects.find((o) => o.key === `cf/${ID}/search.txt`);
  check('the listing names the stored text for what it is', row && row.label === 'Job text' && row.purpose === 'job-text');
}

// ---- a permanent delete that lands while the text is being built
{
  const cabinet = seedJob();
  const realPut = cabinet.put.bind(cabinet);
  cabinet.put = async (key, body, options) => {
    const done = await realPut(key, body, options);
    if (key === `cf/${ID}/search.txt`) cabinet.objects.delete(`cf/${ID}/index.json`);
    return done;
  };
  await call(`explore/files/${ID}/text`, cabinet);
  check('text written for a job deleted meanwhile is taken back', !cabinet.objects.has(`cf/${ID}/search.txt`));
}

// ---- a big Cabinet is read a slice at a time, and says so
{
  const seed = [];
  for (let i = 0; i < MAX_BUILDS_PER_SEARCH + 5; i += 1) {
    seed.push({ key: `cf/bulk-${i}/index.json`, body: JSON.stringify({ id: `bulk-${i}`, displayName: 'Bulk ' + i }) });
  }
  const cabinet = createCabinet(seed);
  const first = await (await call('explore/search?q=bulk', cabinet)).json();
  check('one search builds at most the limit', first.built === MAX_BUILDS_PER_SEARCH && first.notYetRead === 5,
    JSON.stringify({ built: first.built, notYet: first.notYetRead }));
  check('jobs not yet read are counted, not hidden', first.searched === MAX_BUILDS_PER_SEARCH && first.total === MAX_BUILDS_PER_SEARCH + 5);
  const second = await (await call('explore/search?q=bulk', cabinet)).json();
  check('the next search reads the rest', second.built === 5 && second.notYetRead === 0 && second.results.length === MAX_BUILDS_PER_SEARCH + 5);
}

// ---- refusals
{
  const cabinet = seedJob();
  const empty = await call('explore/search?q=', cabinet);
  check('an empty search is refused', empty.status === 400);
  const anon = await call('explore/search?q=crack', cabinet, { auth: false });
  check('search needs a signed-in identity', anon.status === 401);
  const post = await call('explore/search?q=crack', cabinet, { method: 'POST' });
  check('search is GET only', post.status === 405);
  check('a refused request writes nothing', !cabinet.ops.some((op) => op.startsWith('put ')));
}

const failed = results.filter((row) => !row.ok);
if (failed.length) {
  console.error(`\n${failed.length} failed`);
  process.exit(1);
}
console.log(`\n${results.length} passed`);
