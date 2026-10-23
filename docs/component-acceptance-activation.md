# Component acceptance — what it is, and the exact way to switch it on

**This is not an authorization to deploy.** `AGENTS.md`: *"Creating Cloudflare
infrastructure, Access configuration, or deployment of sync services requires
explicit product-owner authorization beyond documentation updates."* Nothing
here is deployed or promoted. This document exists so that when Tim does
authorize it, the sequence is already decided and nobody has to work it out
under pressure.

---

## The defect it closes

Device A passes the ownership gate on a component upload. Device B takes the
Customer File over. A's in-flight PUT resumes, overwrites B's bytes at
`cf/{id}/{name}.json`, and answers **200** — while the index correctly names
B. The write was never conditional on the ownership that authorized it.

A real Floor Survey, accepted and acknowledged, replaced by a survey from a
device that no longer held the file. No error anywhere.

## Why the obvious fixes do not work

- **An R2 ETag is the MD5 of the bytes.** Re-writing identical bytes on
  takeover produces an identical ETag, so "touch every component to invalidate
  the stale writer" invalidates nothing. The test mocks compute ETags that way
  on purpose.
- **A component that does not exist yet has no version to invalidate.** A
  stale *create* is the same fault and the touch design cannot see it at all.

## The protocol

1. An upload writes an immutable **candidate** at a unique key, create-only.
   Accepted bytes are never overwritten, so a stale writer cannot destroy
   current work even if everything after that point goes wrong.
2. **Acceptance is a compare-and-swap on the index** — the same object that
   carries ownership. A takeover is itself an index write, so a stale
   publication loses the swap.
3. The reference and `<name>UpdatedAt` — the field `js/sync.js` actually
   compares — move together in that one swap, so they can never describe
   different bytes.
4. A failed swap **re-authorizes against the authority epoch**, never retries
   blind. The epoch is stamped from a sequence that never repeats, on every
   ownership change including a release, so a device that loses the file and
   gets it back cannot land a payload composed before the handoff.
5. Readers resolve the reference through one shared function. The legacy key
   is a fallback **only when no reference exists**, and a reference pointing at
   nothing is an error rather than a silent fall back to bytes an owner had
   already replaced.

It also refuses, each for a reason that was reachable:

| Refused | Because |
| --- | --- |
| No usable revision | The ordering check would be skipped and an old client could publish over newer content with a 200 |
| An older instant | Two uploads from one owner can complete out of order |
| The same instant, different bytes | The client's own comparison cannot tell them apart, so nothing would ever fetch the new bytes |
| A deleted file | Read from the index, inside the swap boundary, not from a separate tombstone |
| The sequence at its ceiling | Past `MAX_SAFE_INTEGER` a bump stops being a bump and the whole guarantee dies quietly |

## What it costs

**Storage grows.** Every accepted version stays in R2 as its own candidate
object, and so does every candidate that lost its publication. Nothing deletes
either. Component JSON only — media is unaffected and is still stored once.
A Customer File synced daily for a year therefore carries a few hundred small
JSON objects. Cleaning that up is a separate decision and was not taken here.

**A one-round-trip gap on a first sync.** `syncOneRecord` pushes components
first and the index after, so on a Customer File the Cabinet has never seen
the component route creates the index itself, create-only. Between that create
and the client's own index write, a Cabinet listing shows the file with no
customer name on it. The alternative was refusing the component, which would
mean a new Customer File could never reach the Cabinet at all.

---

## The activation sequence

### 1. One atomic switch. Never a gradual deployment.

Deploy the new version to **100% of traffic in one step**. Do not use a
gradual/percentage rollout and do not split traffic between versions.

A Workers version switch sends new requests to the new version and lets
requests already in flight finish on the old one, so the mixed window is the
lifetime of one request — seconds. A percentage rollout makes that window last
as long as the rollout, and the whole hazard below scales with it.

### 2. The one surviving hazard, and why it is not silent

An old-handler index PUT already in flight can complete after the switch. It
carries the client's own body forward and knows nothing about acceptance
references, so it keeps the client's `<name>UpdatedAt` and **drops the
`components` map**. The index then advertises a published revision with
nothing pointing at it, and the legacy object holds whatever the old handler
last wrote there.

Serving that quietly would be the corruption: another device would take stale
bytes as current, because the advertised revision says they are.

So the fallback is checked rather than trusted (`legacyIsStale`). When the
index advertises a revision **newer** than the legacy object's own, every
reader refuses:

- a component GET answers 500 rather than stale bytes,
- a permanent delete refuses rather than delete the wrong photographs and
  strand the right ones,
- the File Explorer listing says so in its reference notes.

**The owner's next Sync repairs it** — publishing restores the reference the
old write dropped. Tested, including the repair:
`tests/sync-component-acceptance-worker.mjs`.

### 3. After the switch, confirm on one real Customer File

In this order, on a file that can afford to be looked at:

1. Sync Now from the device that holds it. Expect **"Sync complete."**
2. Read the index through File Explorer. Expect a `components` map naming one
   object per component, and each `<name>UpdatedAt` equal to that component's
   own `updatedAt`.
3. Sync Now again with nothing changed. Expect **"Everything is already
   synced."** and no new candidate objects.
4. From a second device, Check Out and confirm the survey that arrives is the
   one the first device sent.

If step 2 shows an advertised revision with no reference, that is §2 above:
Sync Now from the owning device and it clears.

### 4. Rollback is forward-only once anything has published

**State this plainly rather than discover it.** The previous version's readers
do not know about references: they read `cf/{id}/{name}.json`, which still
holds whatever the old handler last wrote and may be far older than what the
index advertises. Rolling back after a component has published would serve
those stale bytes as current.

A rollback is therefore survivable **only** if every device Syncs again before
the Cabinet is trusted, which rewrites the legacy keys. The stale-legacy check
above means a rollback is at least loud rather than silent — the new readers
refuse the disagreement — but the old readers do not have that check, so the
check is gone the moment the old version is back.

If a rollback path matters more than the simplicity, the answer is for a
publication to also mirror the accepted bytes to the legacy key. That is five
lines and one extra write per publication. It was deliberately **not** added:
it makes the legacy key a second writer of component state, which is the exact
ambiguity this protocol removes. It should be added only as a decision, not as
a surprise.

---

## Where it lives

| File | What is in it |
| --- | --- |
| `sync-worker/src/components.js` | The protocol: revisions as instants, candidate keys, the shared resolution, the server-owned index fields, the sequence and its refusal |
| `sync-worker/src/index.js` | `publishComponent`, the component GET, the gate, `markIndexPurged`, `referencedMediaIds` |
| `sync-worker/src/explore.js` | Listing labels and media references, through the same resolution |
| `tests/sync-component-acceptance-model.mjs` | The model, and the attacks on it — 55 cases |
| `tests/sync-component-acceptance-worker.mjs` | The same attacks against the real handler — 50 cases |
| `tests/sync-client-through-worker.mjs` | `js/sync.js` driven against the real handler — 20 cases |

No client change was needed. The server derives each component's revision from
the same field `componentRevision()` reads, so the two cannot disagree.
