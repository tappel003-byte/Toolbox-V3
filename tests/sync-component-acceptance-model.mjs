/**
 * A MODEL of the component acceptance protocol, and the attacks on it.
 *
 * Run: node tests/sync-component-acceptance-model.mjs
 *
 * THIS IS NOT THE WORKER. It is an executable model of a protocol that has
 * not been implemented, written so the protocol can be attacked before any
 * application code is changed. Nothing here proves anything about the
 * shipped handler, production R2, or Cloudflare Access.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT, reproduced against the real handler separately:
 *   Device A passes the ownership gate. Device B takes the file over. A's
 *   in-flight component PUT resumes and overwrites B's accepted bytes,
 *   returning 200, while the index correctly names B.
 *
 * WHY THE OBVIOUS FIXES FAIL (GPT-008, and this model enforces both):
 *   - An ETag is the MD5 of the bytes. Re-writing identical bytes does NOT
 *     produce a new ETag, so "touch every component on takeover" invalidates
 *     nothing. The store below computes ETags that way on purpose.
 *   - Therefore an index whose body can REPEAT can have a repeating ETag, and
 *     a stale compare-and-swap could succeed long after it should have died.
 *     The protocol answers that with a sequence number that never repeats.
 *
 * THE PROTOCOL
 *   1. A component upload writes an immutable CANDIDATE at a unique key,
 *      create-only. It can never overwrite accepted bytes.
 *   2. Acceptance is a compare-and-swap on the INDEX -- the same object that
 *      carries ownership -- setting components[name] = { key, revision }.
 *      A takeover is itself an index write, so a stale publication loses.
 *   3. A failed CAS re-reads and RE-AUTHORIZES. It never retries blind.
 *   4. Readers resolve components[name].key, falling back to the legacy key
 *      only when no reference exists. A reference that points at a missing
 *      object is an error, never a silent fallback.
 */

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

import { createHash } from 'crypto';

/**
 * A store with CONTENT-ADDRESSED ETags, which is the hard case.
 * Identical bytes give an identical ETag, exactly as Cloudflare's own R2
 * emulator computes it. A design that needs "same bytes, new version" is
 * disqualified here rather than in production.
 */
function store() {
  const objects = new Map();
  const etagOf = (body) => createHash('md5').update(String(body)).digest('hex');
  // Keys whose next write fails outright. A create that did not happen is not
  // the same as a create that lost a collision, and both must stop a publish.
  const failing = new Set();
  return {
    objects,
    failNext(key) { failing.add(key); },
    get(key) {
      const body = objects.get(key);
      return body === undefined ? null : { body, etag: etagOf(body) };
    },
    /** onlyIf: { etagMatches } or { createOnly: true }. null means refused. */
    put(key, body, onlyIf) {
      if (failing.has(key)) { failing.delete(key); return null; }
      const existing = objects.get(key);
      if (onlyIf && onlyIf.createOnly && existing !== undefined) return null;
      if (onlyIf && onlyIf.etagMatches !== undefined) {
        if (existing === undefined) return null;
        if (etagOf(existing) !== onlyIf.etagMatches) return null;
      }
      objects.set(key, body);
      return { key, etag: etagOf(body) };
    },
  };
}

/**
 * The field the CLIENT actually orders by.
 *
 * js/sync.js indexRev() reads customerUpdatedAt / plansUpdatedAt /
 * distressUpdatedAt / floorUpdatedAt / diagnosticsUpdatedAt /
 * reportUpdatedAt / trashUpdatedAt from the index, and compares them with the
 * component's own updatedAt. An invented integer counter beside those would
 * be a second revision nobody reads. Publication therefore sets THIS field,
 * atomically with the reference, from the bytes being accepted.
 */
const revField = (name) => `${name}UpdatedAt`;

const indexKey = (id) => `cf/${id}/index.json`;
const legacyKey = (id, name) => `cf/${id}/${name}.json`;
const candidateKey = (id, name, token) => `cf/${id}/c/${name}/${token}.json`;
const purgeKey = (id) => `purge/${id}.json`;

function readIndex(db, id) {
  const got = db.get(indexKey(id));
  if (!got) return null;
  return { doc: JSON.parse(got.body), etag: got.etag };
}

/** Every index write bumps seq, so the body -- and the ETag -- never repeat. */
function writeIndex(db, id, doc, etag) {
  const next = { ...doc, seq: (doc.seq || 0) + 1 };
  return db.put(indexKey(id), JSON.stringify(next), { etagMatches: etag });
}

function ownerOf(doc) {
  const c = doc && doc.checkout;
  return c && c.deviceId ? c.deviceId : null;
}

/**
 * Which LEASE a write was authorized under, not merely which device.
 *
 * Re-authorizing on a failed publication is not enough on its own. A device
 * can lose the file and get it back, and its old in-flight payload was
 * composed before whatever the other device did in between. Republishing it
 * would discard that work silently.
 *
 * The lease is stamped with the index sequence at which it was granted, and
 * seq never repeats, so a lease epoch never repeats either -- which is also
 * what defeats an index body that repeats byte for byte.
 */
function authorityOf(doc) {
  const c = doc && doc.checkout;
  // The epoch is WHO may write and WHEN that was decided. Keying it on the
  // device alone gave every unleased moment the same name -- "none" -- so a
  // request authorized before a handoff was still authorized after one that
  // ended unleased. authoritySeq is stamped from the index sequence on every
  // authority change, including a release, so it never repeats.
  const who = c && c.deviceId ? c.deviceId : 'none';
  const when = doc && typeof doc.authoritySeq === 'number' ? doc.authoritySeq : 0;
  return `${who}@${when}`;
}

/** The gate: who may write, and the index version that authorized it. */
function gate(db, id, deviceId) {
  const read = readIndex(db, id);
  if (!read) return { ok: false, status: 404 };
  const owner = ownerOf(read.doc);
  if (owner && owner !== deviceId) return { ok: false, status: 403 };
  return { ok: true, doc: read.doc, etag: read.etag, authority: authorityOf(read.doc) };
}

/**
 * INVARIANT the implementation must hold: the checkout is server-owned and is
 * only ever stamped here, with the CURRENT sequence. Nothing copies an old
 * lease value forward -- not an ordinary client index PUT, not a retry, not a
 * release. Without that, an index body could be replayed verbatim and an old
 * lease would read as live again.
 */
function grantLease(db, id, deviceId) {
  const read = readIndex(db, id);
  if (!read) return { status: 404 };
  const next = { ...read.doc,
    checkout: deviceId ? { deviceId } : null,
    // Stamped on EVERY authority change, a release included.
    authoritySeq: (read.doc.seq || 0) + 1 };
  const put = writeIndex(db, id, next, read.etag);
  return { status: put === null ? 409 : 200 };
}

function takeover(db, id, deviceId) {
  const read = readIndex(db, id);
  if (!read) return { status: 404 };
  return grantLease(db, id, deviceId);
}

/**
 * The component upload. `pause` lets a test hold a device between the gate
 * and the publication, which is the whole window the defect lives in.
 */
function startComponentPut(db, id, name, deviceId, body, token, revision) {
  const g = gate(db, id, deviceId);
  if (!g.ok) return { authorized: false, status: g.status, finish: () => ({ status: g.status }) };
  const key = candidateKey(id, name, token);
  const bytes = JSON.stringify(body);
  const wrote = db.put(key, bytes, { createOnly: true });
  let candidateOk = wrote !== null;
  if (!candidateOk) {
    // A create that did not happen is NOT a licence to publish. The only way
    // on from here is proving this exact object already holds exactly these
    // bytes -- an idempotent retry of our own write. Anything else, including
    // an indeterminate failure, stops.
    const there = db.get(key);
    candidateOk = !!there && there.body === bytes;
  }
  return {
    authorized: true,
    candidate: key,
    wroteCandidate: candidateOk,
    finish: (attempts = 2) => {
      if (!candidateOk) {
        return { status: 409, published: false, reason: 'candidate not written' };
      }
      let etag = g.etag;
      let doc = g.doc;
      const authority = g.authority;
      for (let i = 0; i < attempts; i += 1) {
        // A file on its way out must not gain accepted bytes.
        if (db.get(purgeKey(id))) {
          return { status: 409, published: false, reason: 'permanently deleted' };
        }
        const accepted = (doc.components || {})[name];
        const acceptedRev = doc[revField(name)] || '';
        // ORDER BY THE SOURCE REVISION, not by who finished last. Two uploads
        // from one owner can complete out of order; the older edit must not
        // become current merely because its network call landed second.
        if (revision && acceptedRev && revision < acceptedRev) {
          return { status: 409, published: false, reason: 'superseded', acceptedRev };
        }
        const components = { ...(doc.components || {}) };
        components[name] = { key, revision: revision || acceptedRev || '' };
        const next = { ...doc, components };
        // The reference and the field the client orders by move TOGETHER, in
        // one compare-and-swap, so they can never describe different bytes.
        if (revision) next[revField(name)] = revision;
        const put = writeIndex(db, id, next, etag);
        if (put !== null) return { status: 200, published: true, accepted: accepted };
        const again = gate(db, id, deviceId);
        if (!again.ok) return { status: again.status, published: false };
        // Same AUTHORITY, not merely the same device.
        if (again.authority !== authority) {
          return { status: 403, published: false, reason: 'authority changed' };
        }
        etag = again.etag;
        doc = again.doc;
      }
      return { status: 409, published: false, reason: 'contended' };
    },
  };
}

/** What a reader -- sync, archive, delete -- must resolve. */
function acceptedBytes(db, id, name) {
  const read = readIndex(db, id);
  if (!read) return { error: 'no index' };
  const ref = (read.doc.components || {})[name];
  if (!ref) {
    const legacy = db.get(legacyKey(id, name));
    // Legacy fallback is explicit and only when no reference exists.
    return legacy ? { from: 'legacy', body: JSON.parse(legacy.body) } : { error: 'none' };
  }
  const got = db.get(ref.key);
  // A reference pointing at nothing is an ERROR. Never fall back silently:
  // falling back would serve bytes an owner had already replaced.
  if (!got) return { error: 'accepted object missing' };
  return {
    from: 'accepted', body: JSON.parse(got.body), revision: ref.revision,
    // What js/sync.js would actually read for its ordering decision.
    advertised: read.doc[revField(name)] || '',
  };
}

function seed(opts = {}) {
  const db = store();
  const id = 'cf1';
  const doc = { id, seq: 0, checkout: { deviceId: 'A', leaseSeq: 0 } };
  if (opts.accepted) {
    db.put(candidateKey(id, 'floor', 'seed'), JSON.stringify(opts.accepted), { createOnly: true });
    doc.components = { floor: { key: candidateKey(id, 'floor', 'seed'), revision: 1 } };
  }
  if (opts.legacy) db.put(legacyKey(id, 'floor'), JSON.stringify(opts.legacy));
  db.put(indexKey(id), JSON.stringify(doc));
  return { db, id };
}

// ---------------------------------------------------------- the defect
{
  const { db, id } = seed({ accepted: { note: 'A work' } });
  const a = startComponentPut(db, id, 'floor', 'A', { note: 'A stale work' }, 'a1');
  check('A is authorized while it holds the file', a.authorized);
  const took = takeover(db, id, 'B');
  check('B takes the file over', took.status === 200, String(took.status));
  const done = a.finish();
  const now = acceptedBytes(db, id, 'floor');
  check('A’s stale publication is refused after the takeover',
    done.status === 403 && done.published === false, JSON.stringify(done));
  check('and the accepted bytes are the ones from before it',
    now.body.note === 'A work', JSON.stringify(now));
  check('A’s candidate exists but was never accepted',
    db.objects.has(a.candidate) &&
    JSON.parse(db.get(indexKey(id)).body).components.floor.key !== a.candidate,
    a.candidate);
}

// ------------------------------- the file comes back to A after a takeover
//
// GPT-008: "an old authority must not become valid again merely because an
// ETag/body repeats." A device that loses the file and gets it back is
// holding a payload composed BEFORE whatever the other device did, so
// re-authorizing on the device alone is not enough -- the lease must match.
{
  const { db, id } = seed({ accepted: { note: 'A work' } });
  const a = startComponentPut(db, id, 'floor', 'A', { note: 'A stale' }, 'a2');
  takeover(db, id, 'B');
  grantLease(db, id, null);          // B checks in
  grantLease(db, id, 'A');           // A takes it back
  const done = a.finish();
  const now = acceptedBytes(db, id, 'floor');
  check('a payload from a previous lease is refused even back in A\u2019s hands',
    done.status === 403 && now.body.note === 'A work',
    JSON.stringify({ done, now }));
  check('because every authority change is stamped with a sequence that never repeats',
    JSON.parse(db.get(indexKey(id)).body).authoritySeq > 0 &&
    JSON.parse(db.get(indexKey(id)).body).seq > 2,
    db.get(indexKey(id)).body);
}

// The same attack by replay: an index body written back byte-for-byte. The
// model refuses to express it, because a lease is only ever stamped by
// grantLease with the current sequence -- which is the invariant the
// implementation has to carry.
{
  const { db, id } = seed({ accepted: { note: 'A work' } });
  const a = startComponentPut(db, id, 'floor', 'A', { note: 'A stale' }, 'a2b');
  const original = db.get(indexKey(id)).body;
  takeover(db, id, 'B');
  grantLease(db, id, 'A');
  const replayed = db.get(indexKey(id)).body;
  check('an authority epoch can never be replayed',
    authorityOf(JSON.parse(original)) !== authorityOf(JSON.parse(replayed)),
    `${authorityOf(JSON.parse(original))} vs ${authorityOf(JSON.parse(replayed))}`);
  const done = a.finish();
  check('and the stale publication stays refused',
    done.status === 403, JSON.stringify(done));
}

// -------------------------------------------- the absent-component case
// This is the hole that sank the ETag-touch design. A component that does
// not exist has no version to invalidate.
{
  const { db, id } = seed({});
  const a = startComponentPut(db, id, 'floor', 'A', { note: 'A stale' }, 'a3');
  takeover(db, id, 'B');
  const done = a.finish();
  const now = acceptedBytes(db, id, 'floor');
  check('a stale CREATE of a component that never existed is refused too',
    done.status === 403 && now.error === 'none',
    JSON.stringify({ done, now }));
}

// ------------------------------------ B accepts first, then A resumes
{
  const { db, id } = seed({ accepted: { note: 'old' } });
  const a = startComponentPut(db, id, 'floor', 'A', { note: 'A stale' }, 'a4');
  takeover(db, id, 'B');
  const b = startComponentPut(db, id, 'floor', 'B', { note: 'B accepted' }, 'b1');
  const bDone = b.finish();
  const aDone = a.finish();
  const now = acceptedBytes(db, id, 'floor');
  check('B’s write is accepted', bDone.status === 200, JSON.stringify(bDone));
  check('and A resuming afterwards cannot replace it',
    aDone.status === 403 && now.body.note === 'B accepted',
    JSON.stringify({ aDone, now }));
}

// ------------------------------- two uploads from the SAME owner overlap
{
  const { db, id } = seed({ accepted: { note: 'old' } });
  const one = startComponentPut(db, id, 'floor', 'A', { note: 'first' }, 'a5', '2026-10-23T10:00:00Z');
  const two = startComponentPut(db, id, 'floor', 'A', { note: 'second' }, 'a6', '2026-10-23T11:00:00Z');
  const r1 = one.finish();
  const r2 = two.finish();
  const now = acceptedBytes(db, id, 'floor');
  check('both same-owner uploads succeed', r1.status === 200 && r2.status === 200,
    JSON.stringify({ r1, r2 }));
  check('the newer EDIT is accepted and advertised',
    now.body.note === 'second' && now.advertised === '2026-10-23T11:00:00Z',
    JSON.stringify(now));
}

// ---------------------------------------- check in, then re-acquire
{
  const { db, id } = seed({ accepted: { note: 'A work' } });
  const a = startComponentPut(db, id, 'floor', 'A', { note: 'A stale' }, 'a7');
  grantLease(db, id, null);          // check in
  grantLease(db, id, 'B');           // B acquires
  const done = a.finish();
  const now = acceptedBytes(db, id, 'floor');
  check('a write authorized before a check-in cannot land after the re-acquire',
    done.status === 403 && now.body.note === 'A work',
    JSON.stringify({ done, now }));
}

// ------------------------------- legacy baseline, and its first publication
{
  const { db, id } = seed({ legacy: { note: 'legacy bytes' } });
  const before = acceptedBytes(db, id, 'floor');
  check('with no reference, a reader falls back to the legacy object',
    before.from === 'legacy' && before.body.note === 'legacy bytes',
    JSON.stringify(before));
  const a = startComponentPut(db, id, 'floor', 'A', { note: 'first accepted' }, 'a8');
  const done = a.finish();
  const after = acceptedBytes(db, id, 'floor');
  check('the first publication takes over from the legacy object',
    done.status === 200 && after.from === 'accepted' &&
    after.body.note === 'first accepted', JSON.stringify(after));
  check('and the legacy object is left in place as recovery material',
    db.objects.has(legacyKey(id, 'floor')), 'kept');
}

// ------------------------------------- an interrupted upload is inert
{
  const { db, id } = seed({ accepted: { note: 'A work' } });
  const a = startComponentPut(db, id, 'floor', 'A', { note: 'never published' }, 'a9');
  // the device dies here: candidate written, publication never attempted
  const now = acceptedBytes(db, id, 'floor');
  check('an unpublished candidate changes nothing',
    now.body.note === 'A work' && db.objects.has(a.candidate),
    JSON.stringify(now));
}

// ------------------------------- a reference pointing at nothing is an error
{
  const { db, id } = seed({ accepted: { note: 'A work' } });
  const ref = JSON.parse(db.get(indexKey(id)).body).components.floor.key;
  db.objects.delete(ref);
  const now = acceptedBytes(db, id, 'floor');
  check('a missing accepted object errors rather than serving older bytes',
    now.error === 'accepted object missing', JSON.stringify(now));
}

// ----------------------- an ordinary index PUT must not roll acceptance back
{
  const { db, id } = seed({ accepted: { note: 'old' } });
  const a = startComponentPut(db, id, 'floor', 'A', { note: 'accepted' }, 'b2',
    '2026-10-23T12:00:00Z');
  a.finish();
  const read = readIndex(db, id);
  // A client sends an index body with no components map at all, exactly as a
  // client that has never heard of them would.
  const clientBody = { id, displayName: 'renamed' };
  const serverKept = {
    ...clientBody,
    seq: read.doc.seq,
    checkout: read.doc.checkout,
    authoritySeq: read.doc.authoritySeq,
    components: read.doc.components,          // server-owned, like checkout
    // The advertised revision is server-owned TOO. Preserving the reference
    // while letting a client set this field would let it announce a version
    // that does not describe the accepted bytes -- and this is the field
    // js/sync.js actually compares.
    [revField('floor')]: read.doc[revField('floor')],
  };
  writeIndex(db, id, serverKept, read.etag);
  const now = acceptedBytes(db, id, 'floor');
  check('an ordinary index write preserves the accepted reference',
    now.body.note === 'accepted' && now.advertised === '2026-10-23T12:00:00Z',
    JSON.stringify(now));
  check('and still carries the client’s own change',
    JSON.parse(db.get(indexKey(id)).body).displayName === 'renamed', 'renamed');
}

// ============================ GPT-009's counterexamples ====================

// 1. A handoff that passes through NO checkout at all.
//    The old epoch was the device name, so every unleased moment was called
//    "none" and a request authorized before the handoff was still authorized
//    after it. assertWritableCheckout permits unleased writes, so this is
//    reachable under the existing contract, not a fabricated state.
{
  const { db, id } = seed({ accepted: { note: 'old' } });
  grantLease(db, id, null);                       // released: unleased
  const a = startComponentPut(db, id, 'floor', 'A', { note: 'pre-handoff stale' },
    'u1', '2026-10-23T09:00:00Z');
  check('a write is authorized while the file is unleased', a.authorized);
  grantLease(db, id, 'B');
  const b = startComponentPut(db, id, 'floor', 'B', { note: 'B accepted' }, 'u2',
    '2026-10-23T10:00:00Z');
  check('B acquires and is accepted', b.finish().status === 200);
  grantLease(db, id, null);                       // B checks in: unleased again
  const done = a.finish();
  const now = acceptedBytes(db, id, 'floor');
  check('a write from the PREVIOUS unleased moment cannot land in the next one',
    done.status === 403 && now.body.note === 'B accepted',
    JSON.stringify({ done, now }));
}

// 2. The candidate create FAILED. Publishing anyway accepted bytes this
//    request never wrote.
{
  const { db, id } = seed({ accepted: { note: 'old' } });
  db.put(candidateKey(id, 'floor', 'x1'), JSON.stringify({ note: 'unrelated bytes' }),
    { createOnly: true });
  const a = startComponentPut(db, id, 'floor', 'A', { note: 'intended bytes' }, 'x1',
    '2026-10-23T10:00:00Z');
  const done = a.finish();
  const now = acceptedBytes(db, id, 'floor');
  check('a lost create-only write refuses to publish',
    a.wroteCandidate === false && done.published === false,
    JSON.stringify({ wrote: a.wroteCandidate, done }));
  check('and never accepts bytes this request did not write',
    now.body.note === 'old', JSON.stringify(now));
}

// 2b. The same, by outright failure rather than collision.
{
  const { db, id } = seed({ accepted: { note: 'old' } });
  db.failNext(candidateKey(id, 'floor', 'x2'));
  const a = startComponentPut(db, id, 'floor', 'A', { note: 'intended' }, 'x2',
    '2026-10-23T10:00:00Z');
  const done = a.finish();
  check('an outright failed candidate write refuses to publish too',
    done.published === false && acceptedBytes(db, id, 'floor').body.note === 'old',
    JSON.stringify(done));
}

// 2c. A genuine idempotent retry -- our own bytes already there -- may go on.
{
  const { db, id } = seed({ accepted: { note: 'old' } });
  db.put(candidateKey(id, 'floor', 'x3'), JSON.stringify({ note: 'mine' }),
    { createOnly: true });
  const a = startComponentPut(db, id, 'floor', 'A', { note: 'mine' }, 'x3',
    '2026-10-23T10:00:00Z');
  check('a retry whose candidate already holds exactly these bytes may publish',
    a.wroteCandidate === true && a.finish().status === 200 &&
    acceptedBytes(db, id, 'floor').body.note === 'mine', 'idempotent');
}

// 3. REVERSE COMPLETION. The older edit's network call finishes last.
{
  const { db, id } = seed({ accepted: { note: 'old' } });
  const older = startComponentPut(db, id, 'floor', 'A', { note: 'older edit' }, 'r1',
    '2026-10-23T10:00:00Z');
  const newer = startComponentPut(db, id, 'floor', 'A', { note: 'newer edit' }, 'r2',
    '2026-10-23T11:00:00Z');
  const rNew = newer.finish();
  const rOld = older.finish();
  const now = acceptedBytes(db, id, 'floor');
  check('the newer edit is accepted', rNew.status === 200, JSON.stringify(rNew));
  check('and the older edit finishing LAST is refused, not accepted',
    rOld.published === false && rOld.reason === 'superseded',
    JSON.stringify(rOld));
  check('so the current component is the newer edit either way',
    now.body.note === 'newer edit' && now.advertised === '2026-10-23T11:00:00Z',
    JSON.stringify(now));
}

// 4. The advertised revision and the accepted bytes cannot disagree.
{
  const { db, id } = seed({ accepted: { note: 'old' } });
  const a = startComponentPut(db, id, 'floor', 'A', { note: 'accepted bytes' }, 'v1',
    '2026-10-23T10:00:00Z');
  a.finish();
  const now = acceptedBytes(db, id, 'floor');
  check('publication moves the reference and the advertised revision together',
    now.body.note === 'accepted bytes' &&
    now.advertised === '2026-10-23T10:00:00Z' &&
    now.revision === now.advertised, JSON.stringify(now));
}

// 5. A file on its way out does not gain accepted bytes.
{
  const { db, id } = seed({ accepted: { note: 'old' } });
  const a = startComponentPut(db, id, 'floor', 'A', { note: 'after the purge' }, 'd1',
    '2026-10-23T10:00:00Z');
  db.put(purgeKey(id), JSON.stringify({ id, reason: 'permanent-delete' }));
  const done = a.finish();
  check('a publication after a permanent delete is refused',
    done.published === false && done.reason === 'permanently deleted',
    JSON.stringify(done));
}

// 6. A legacy index with no authoritySeq at all.
{
  const db = store();
  const id = 'cf1';
  db.put(legacyKey(id, 'floor'), JSON.stringify({ note: 'legacy bytes' }));
  db.put(indexKey(id), JSON.stringify({ id, seq: 0, checkout: { deviceId: 'A' } }));
  const a = startComponentPut(db, id, 'floor', 'A', { note: 'first accepted' }, 'L1',
    '2026-10-23T10:00:00Z');
  check('a legacy index without an authority stamp still authorizes', a.authorized);
  const took = takeover(db, id, 'B');
  const done = a.finish();
  check('and the first handoff after it still kills the stale write',
    took.status === 200 && done.status === 403, JSON.stringify(done));
  check('the legacy bytes are still what a reader sees',
    acceptedBytes(db, id, 'floor').from === 'legacy', 'legacy');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
