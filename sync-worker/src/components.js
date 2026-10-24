/**
 * Component acceptance: the one place that decides which bytes are current.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT this closes
 *   Device A passes the ownership gate. Device B takes the file over. A's
 *   in-flight component PUT resumes, overwrites B's bytes at
 *   cf/{id}/{name}.json, and answers 200 -- while the index correctly names
 *   B. Nothing in the write was conditional on the ownership it was
 *   authorized by.
 *
 * WHY THE OBVIOUS FIXES DO NOT WORK
 *   An R2 ETag is the MD5 of the bytes. Re-writing identical bytes on
 *   takeover produces an identical ETag, so "touch every component to
 *   invalidate the stale writer" invalidates nothing. And a component that
 *   does not exist yet has no version to invalidate at all.
 *
 * THE PROTOCOL (modelled and attacked in tests/sync-component-acceptance-model.mjs
 * before any of this was written; GPT/Codex got past three earlier versions)
 *   1. An upload writes an immutable CANDIDATE at a unique key, create-only.
 *      It can never overwrite accepted bytes.
 *   2. Acceptance is a compare-and-swap on the INDEX -- the same object that
 *      carries ownership. A takeover is itself an index write, so a stale
 *      publication loses the swap.
 *   3. The reference and the field the client orders by move together in that
 *      one swap, so they can never describe different bytes.
 *   4. A failed swap re-reads and RE-AUTHORIZES against the authority epoch,
 *      never retries blind.
 *   5. Readers resolve the reference. The legacy key is a fallback only when
 *      no reference exists; a reference pointing at nothing is an error, never
 *      a silent fall back to bytes an owner already replaced.
 *
 * STORAGE, stated honestly: every accepted version stays in R2 as its own
 * candidate object, and so does every candidate that lost its publication.
 * Nothing here deletes either. A Customer File's component history therefore
 * GROWS with each Sync -- component JSON only, not media. Cleaning it up is a
 * separate decision and is not taken here.
 */

/** The field the CLIENT orders by, in the index. js/sync.js indexRev(). */
export function revField(name) {
  return name + 'UpdatedAt';
}

/**
 * Where a component's own revision lives INSIDE its body.
 *
 * These mirror js/sync.js componentRevision() exactly, which is the point:
 * the server derives the revision from the same field the client compares, so
 * the two can never disagree and no client change or new header is needed.
 */
const REVISION_IN_BODY = {
  customer: 'customerUpdatedAt',
  plans: 'updatedAt',
  distress: 'updatedAt',
  floor: 'updatedAt',
  diagnostics: 'updatedAt',
  report: 'updatedAt',
  trash: 'trashUpdatedAt',
};

/**
 * A revision is an INSTANT, not a string.
 *
 * js/sync.js iso() runs Date.parse and re-emits new Date(t).toISOString() on
 * both sides of its comparison, and newerIso() compares parsed milliseconds.
 * So 2026-10-23T19:00:00+02:00 is 17:00Z to the client and OLDER than
 * 18:00Z -- while as a string it sorts AFTER it. A server comparing strings
 * would accept it and roll the component back an hour.
 *
 * Date.parse alone is not the test either: Date.parse(1) coerces to "1" and
 * answers 2001-01-01, so an integer revision would read as a date twenty-five
 * years old rather than be refused. componentRevision() only ever produces an
 * empty string or a full ISO instant, so that shape is what is required.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function revMs(value) {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** The form iso() itself produces, so the advertised field is byte-identical. */
export function canonicalRev(ms) {
  return new Date(ms).toISOString();
}

/** The revision a component body carries, or null when it carries none. */
export function bodyRevisionMs(name, body) {
  const field = REVISION_IN_BODY[name];
  if (!field || !body || typeof body !== 'object') return null;
  return revMs(body[field]);
}

export function legacyComponentKey(id, name) {
  return 'cf/' + id + '/' + name + '.json';
}

/**
 * A candidate key. The token makes it unique per upload, so create-only can
 * never collide with an earlier accepted version -- which is what lets the
 * candidate be immutable.
 */
export function candidateComponentKey(id, name, token) {
  return 'cf/' + id + '/c/' + name + '/' + token + '.json';
}

/** True for any key the protocol owns under a Customer File's prefix. */
export function isCandidateKey(key, id) {
  return typeof key === 'string' && key.indexOf('cf/' + id + '/c/') === 0;
}

/** A fresh token. Unique per request; never derived from the bytes. */
export function newCandidateToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/**
 * THE SHARED RESOLUTION. Component GET, archive, listing, download, media
 * discovery and the purge all come through here, so none of them can read a
 * different version of a component than another.
 *
 * `from` says which rule answered, because the three cases are not the same
 * fault when something is wrong:
 *   'accepted' -- the index names it. The only normal answer once a file has
 *                 synced under this protocol.
 *   'legacy'   -- no reference at all. A file last written by the old handler.
 *   null + error -- the index names an object that is not there. NOT a
 *                 fallback: serving the legacy bytes here would serve a
 *                 version the owner had already replaced.
 */
export function resolveAcceptedComponent(index, id, name) {
  const refs = index && index.components;
  const ref = refs && typeof refs === 'object' ? refs[name] : null;
  if (ref && typeof ref === 'object' && typeof ref.key === 'string' && ref.key) {
    return { key: ref.key, revision: ref.revision || '', from: 'accepted' };
  }
  return { key: legacyComponentKey(id, name), revision: '', from: 'legacy' };
}

/**
 * IS THE LEGACY OBJECT STALE against what the index advertises?
 *
 * This exists for one window and one window only. During a version switch,
 * requests already in flight finish on the old handler. An old-handler index
 * PUT carries the client's own body forward and knows nothing about
 * acceptance references, so if it completes after a publication it drops the
 * components map -- while still writing the client's <name>UpdatedAt. The
 * index then ADVERTISES the published revision with no reference to it, and
 * a reader falling back to cf/{id}/{name}.json would serve whatever the old
 * handler last wrote there as though it were that revision. Another device
 * would take it as current, because the advertised revision says it is.
 *
 * So the fallback is checked rather than trusted. When the index advertises a
 * revision NEWER than the legacy object's own, the two disagree and that is
 * said out loud -- a refusal rather than silent corruption. Equal advertised
 * timestamps make js/sync.js decideComponentAction skip, so the owner's next
 * Sync does NOT automatically repair a dropped components map; only a newer
 * component publication (or another reviewed repair path) can restore the
 * reference. See docs/component-acceptance-activation.md and GPT-012.
 *
 * It is not a merge rule and not an ordering rule. It is a consistency check
 * on one specific disagreement.
 */
export function legacyIsStale(index, name, body) {
  const advertised = revMs(index && index[revField(name)]);
  if (advertised === null) return false;
  const own = bodyRevisionMs(name, body);
  if (own === null) return true;
  return own < advertised;
}

/**
 * The index fields the SERVER owns. A client index PUT may not set, change or
 * drop any of them: the lease, the acceptance references, the revisions those
 * references advertise, the sequence that makes an index version
 * unrepeatable, the authority epoch stamped from it, and the deletion state.
 *
 * Letting a client write <name>UpdatedAt while the server owned the reference
 * would let it announce a revision that does not describe the accepted bytes
 * -- and that field is the one js/sync.js actually compares.
 */
/** Always server-owned, whether acceptance writes are on or off. */
export const SERVER_OWNED_INDEX_CORE = [
  'checkout',
  'components',
  'seq',
  'authoritySeq',
  'purged',
];

/**
 * Revision advertisements the acceptance publisher owns together with the
 * reference. While COMPONENT_ACCEPTANCE_WRITES is OFF these stay client-
 * authored so ordinary Sync does not strip legacy timestamps (GPT-012).
 */
export const SERVER_OWNED_REVISION_FIELDS = [
  'customerUpdatedAt',
  'plansUpdatedAt',
  'distressUpdatedAt',
  'floorUpdatedAt',
  'diagnosticsUpdatedAt',
  'reportUpdatedAt',
  'trashUpdatedAt',
];

export const SERVER_OWNED_INDEX_FIELDS =
  SERVER_OWNED_INDEX_CORE.concat(SERVER_OWNED_REVISION_FIELDS);

/**
 * Carry the server's own fields across a client's index body.
 *
 * Anything the server owns is taken from what is actually stored, and
 * anything absent there is removed from the body rather than left at whatever
 * the client sent.
 *
 * Pass `{ includeRevisionFields: false }` while acceptance writes are gated
 * OFF so client `<name>UpdatedAt` values survive the index PUT.
 */
export function applyServerOwnedIndexFields(stored, body, options) {
  const fields = options && options.includeRevisionFields === false
    ? SERVER_OWNED_INDEX_CORE
    : SERVER_OWNED_INDEX_FIELDS;
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    const value = stored ? stored[field] : undefined;
    if (value === undefined || value === null) delete body[field];
    else body[field] = value;
  }
  return body;
}

/**
 * The sequence that never repeats, and the refusal when it could.
 *
 * Every index write bumps it, so an index body -- and therefore its
 * content-addressed ETag -- can never repeat, and an authority epoch stamped
 * from it can never be replayed. Past Number.MAX_SAFE_INTEGER a bump stops
 * being a bump: seq + 1 === seq, the body repeats, and the whole guarantee
 * quietly dies. So it refuses instead, loudly, while there is still room.
 *
 * At one write per millisecond it would take about 285,000 years to reach
 * this. The refusal is here because a silent wrap is not survivable, not
 * because it is expected.
 */
export const SEQ_CEILING = Number.MAX_SAFE_INTEGER - 1024;

export function nextSeq(stored) {
  const current = stored && typeof stored.seq === 'number' && Number.isFinite(stored.seq)
    ? Math.floor(stored.seq)
    : 0;
  if (!(current < SEQ_CEILING)) return { error: 'index sequence exhausted', seq: current };
  return { seq: current + 1 };
}

/** Stamp a new authority epoch. Called on EVERY ownership change, release included. */
export function stampAuthority(stored, next) {
  const bumped = nextSeq(stored);
  if (bumped.error) return bumped;
  next.seq = bumped.seq;
  next.authoritySeq = bumped.seq;
  return { seq: bumped.seq };
}

/** Which lease a write was authorized under: who, and when that was decided. */
export function authorityOf(index) {
  const checkout = index && index.checkout;
  const who = checkout && checkout.deviceId ? String(checkout.deviceId) : 'none';
  const when = index && typeof index.authoritySeq === 'number' ? index.authoritySeq : 0;
  return who + '@' + when;
}
