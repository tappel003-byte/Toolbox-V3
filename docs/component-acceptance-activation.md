# Component acceptance — what it is, and the exact way to switch it on

**This is not an authorization to deploy.** `AGENTS.md`: *"Creating Cloudflare
infrastructure, Access configuration, or deployment of sync services requires
explicit product-owner authorization beyond documentation updates."* Nothing
here is deployed or promoted. This document exists so that when Tim does
authorize it, the sequence is already decided and nobody has to work it out
under pressure.

**Accepted-reference WRITES are gated OFF by default.** The Worker only runs
`publishComponent` (candidates + index CAS) when `COMPONENT_ACCEPTANCE_WRITES`
is `1` or `true` in the Worker environment. Unset or any other value keeps the
legacy component PUT (`cf/{id}/{name}.json`). The document alone is not a gate;
the env flag is. No production activation is authorized.

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
mean a new Customer File could never reach the Cabinet at all. If the later
index write fails, that blank browse metadata can last longer than one round
trip; recovery is Sync again from the owning device, not new UI.

---

## Preparatory state (always on) vs write activation (gated)

### Always on — safe to serve mixed storage

These paths do **not** require `COMPONENT_ACCEPTANCE_WRITES`:

- Component GET, File Explorer listing/archive/download, and permanent-delete
  media discovery all go through `resolveAcceptedComponent`.
- When a reference exists, readers use it. When it does not, they fall back to
  the legacy key.
- `legacyIsStale` refuses to serve a legacy object older than an advertised
  revision (loud fault, not silent corruption).

So a Cabinet that already has some accepted references can be **read** safely
while writes remain on the legacy path.

### Gated OFF (default) — ordinary Sync preserved

With the flag unset, component PUT writes `cf/{id}/{name}.json` exactly as
before acceptance. It does not reject normal saves, strip legacy timestamps,
or invent acceptance references. Client Sync continues to work.

Executable proof: `tests/sync-client-through-worker.mjs` gate-OFF block.

### Gated ON — accepted-reference writes

Only when `COMPONENT_ACCEPTANCE_WRITES=1` (or `true`) does PUT run
`publishComponent`. Suites that prove the protocol set that flag in their
Worker env. Production must not set it until the activation sequence below is
authorized and completed.

---

## The activation sequence

### 1. External condition that repository code cannot guarantee

A Workers version switch sends **new** requests to the new version and lets
requests **already in flight** finish on the old one. An old-handler index PUT
already running can still complete after the switch: it carries the client's
body forward, keeps `<name>UpdatedAt`, and **drops the `components` map** it
never knew about.

A "100% traffic switch in seconds" does **not** eliminate those in-flight old
acknowledgments. It only bounds how long *new* requests can hit the old
handler. The remaining drain — confirming no old Worker isolate is still
finishing a write, or an equivalent operational hold — is an **external
Cloudflare/runtime condition**. It is not verified by this repository. Keep
the write gate **OFF** until that condition is established under Tim's
deployment authorization. That is a release limitation, not a reason to expand
this task.

Do not use a gradual/percentage rollout for the write-activation deploy: that
lengthens the mixed-handler window.

### 2. The dropped-`components` hazard is loud, not self-healing via Sync

When the index advertises a published revision with no reference, and the
legacy object is older than that revision:

- a component GET answers 500 rather than stale bytes,
- a permanent delete refuses rather than delete the wrong photographs,
- the File Explorer listing says so in its reference notes.

**The owner's next Sync does not automatically repair this.** Equal timestamps
make `decideComponentAction` return `skip`; the client issues no component PUT.
Proven by the equal-revision probe in `tests/sync-client-through-worker.mjs`
(GPT-012 Fix 2). A **newer** component publication can restore the reference;
that is a deliberate push of newer bytes, not ordinary "everything is already
synced" Sync. Do not claim automatic Sync repair. Do not add an unreviewed
general auto-repair or force unconditional pushes to paper over unsafe
activation.

### 3. After write activation is authorized and the drain condition is met

In this order, on a file that can afford to be looked at:

1. Set `COMPONENT_ACCEPTANCE_WRITES=1` on the Worker (product-owner
   authorization required; not done from this repository alone).
2. Sync Now from the device that holds a real Customer File. Expect
   **"Sync complete."**
3. Read the index through File Explorer. Expect a `components` map naming one
   object per component, and each `<name>UpdatedAt` equal to that component's
   own `updatedAt`.
4. Sync Now again with nothing changed. Expect **"Everything is already
   synced."** and no new candidate objects.
5. From a second device, Check Out and confirm the survey that arrives is the
   one the first device sent.

If step 3 shows an advertised revision with no reference, that is the §2
hazard: it will not clear on equal-revision Sync. Repair requires a reviewed
path (for example a newer save/publish), not a hope that Sync heals it.

### 4. Rollback once accepted references exist

**Do not roll back to a legacy-only reader** after anything has published under
acceptance. Old readers open `cf/{id}/{name}.json`, which may be far older than
what the index advertises, and they lack `legacyIsStale`.

Forward / read-compatible rollback must **preserve accepted bytes** (keep
serving through `resolveAcceptedComponent`). Turning writes back OFF while
leaving readers on the shared resolver is the safe direction if a write
rollback is required.

Do **not** add dual-write legacy mirroring as an unreviewed shortcut. Mirroring
accepted bytes onto the legacy key would make that key a second writer of
component state — the ambiguity this protocol removes. It remains a separate
product decision, not part of activation.

---

## Where it lives

| File | What is in it |
| --- | --- |
| `sync-worker/src/components.js` | The protocol: revisions as instants, candidate keys, the shared resolution, the server-owned index fields, the sequence and its refusal |
| `sync-worker/src/index.js` | `acceptanceWritesEnabled`, legacy PUT, `publishComponent`, component GET, the gate, `fenceIndexForPurge`, `referencedMediaIds` |
| `sync-worker/src/explore.js` | Listing labels and media references, through the same resolution |
| `tests/sync-component-acceptance-model.mjs` | The model, and the attacks on it |
| `tests/sync-component-acceptance-worker.mjs` | The same attacks against the real handler (writes ON) plus GPT-012 purge fence races |
| `tests/sync-client-through-worker.mjs` | `js/sync.js` against the real handler; equal-revision non-repair probe; gate-OFF legacy Sync |

No client change was required for the protocol itself. The server derives each
component's revision from the same field `componentRevision()` reads, so the
two cannot disagree when writes are activated.
