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
  return {
    objects,
    get(key) {
      const body = objects.get(key);
      return body === undefined ? null : { body, etag: etagOf(body) };
    },
    /** onlyIf: { etagMatches } or { createOnly: true }. null means refused. */
    put(key, body, onlyIf) {
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

const indexKey = (id) => `cf/${id}/index.json`;
const legacyKey = (id, name) => `cf/${id}/${name}.json`;
const candidateKey = (id, name, token) => `cf/${id}/c/${name}/${token}.json`;

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
function leaseOf(doc) {
  const c = doc && doc.checkout;
  return c && c.deviceId ? `${c.deviceId}@${c.leaseSeq}` : 'none';
}

/** The gate: who may write, and the index version that authorized it. */
function gate(db, id, deviceId) {
  const read = readIndex(db, id);
  if (!read) return { ok: false, status: 404 };
  const owner = ownerOf(read.doc);
  if (owner && owner !== deviceId) return { ok: false, status: 403 };
  return { ok: true, doc: read.doc, etag: read.etag, lease: leaseOf(read.doc) };
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
    checkout: deviceId ? { deviceId, leaseSeq: (read.doc.seq || 0) + 1 } : null };
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
function startComponentPut(db, id, name, deviceId, body, token) {
  const g = gate(db, id, deviceId);
  if (!g.ok) return { authorized: false, status: g.status, finish: () => ({ status: g.status }) };
  // The candidate is written immediately and can never collide: unique key,
  // create-only. Accepted bytes are not reachable from here.
  const wrote = db.put(candidateKey(id, name, token), JSON.stringify(body), { createOnly: true });
  return {
    authorized: true,
    candidate: candidateKey(id, name, token),
    wroteCandidate: wrote !== null,
    /** Publication, attempted against the index version the gate read. */
    finish: (attempts = 2) => {
      let authorizedEtag = g.etag;
      let authorizedDoc = g.doc;
      const authorizedLease = g.lease;
      for (let i = 0; i < attempts; i += 1) {
        const components = { ...(authorizedDoc.components || {}) };
        const prev = components[name];
        components[name] = {
          key: candidateKey(id, name, token),
          revision: (prev && prev.revision ? prev.revision : 0) + 1,
        };
        const put = writeIndex(db, id,
          { ...authorizedDoc, components }, authorizedEtag);
        if (put !== null) return { status: 200, published: true };
        // Lost the CAS. RE-AUTHORIZE -- never retry blind -- and require the
        // SAME LEASE, not merely the same device. A device that lost the file
        // and got it back is holding a payload composed before whatever
        // happened in between; republishing it would discard that work.
        const again = gate(db, id, deviceId);
        if (!again.ok) return { status: again.status, published: false };
        if (again.lease !== authorizedLease) return { status: 403, published: false };
        authorizedEtag = again.etag;
        authorizedDoc = again.doc;
      }
      return { status: 409, published: false };
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
  return { from: 'accepted', body: JSON.parse(got.body), revision: ref.revision };
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
  check('because every lease is stamped with a sequence that never repeats',
    JSON.parse(db.get(indexKey(id)).body).checkout.leaseSeq > 0 &&
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
  check('a lease value can never be replayed, so the epoch cannot repeat',
    JSON.parse(original).checkout.leaseSeq !== JSON.parse(replayed).checkout.leaseSeq,
    `${JSON.parse(original).checkout.leaseSeq} vs ${JSON.parse(replayed).checkout.leaseSeq}`);
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
  const one = startComponentPut(db, id, 'floor', 'A', { note: 'first' }, 'a5');
  const two = startComponentPut(db, id, 'floor', 'A', { note: 'second' }, 'a6');
  const r1 = one.finish();
  const r2 = two.finish();
  const now = acceptedBytes(db, id, 'floor');
  check('both same-owner uploads succeed', r1.status === 200 && r2.status === 200,
    JSON.stringify({ r1, r2 }));
  check('the later one is accepted, and the revision moved twice',
    now.body.note === 'second' && now.revision === 3, JSON.stringify(now));
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
  const a = startComponentPut(db, id, 'floor', 'A', { note: 'accepted' }, 'b2');
  a.finish();
  const read = readIndex(db, id);
  // A client sends an index body with no components map at all, exactly as a
  // client that has never heard of them would.
  const clientBody = { id, displayName: 'renamed' };
  const serverKept = {
    ...clientBody,
    seq: read.doc.seq,
    checkout: read.doc.checkout,
    components: read.doc.components,     // server-owned, preserved like checkout
  };
  writeIndex(db, id, serverKept, read.etag);
  const now = acceptedBytes(db, id, 'floor');
  check('an ordinary index write preserves the accepted reference',
    now.body.note === 'accepted' && now.revision === 2, JSON.stringify(now));
  check('and still carries the client’s own change',
    JSON.parse(db.get(indexKey(id)).body).displayName === 'renamed', 'renamed');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
