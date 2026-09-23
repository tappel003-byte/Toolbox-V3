# Issue #38 — File Cabinet trash investigation

**Status: STOP. Not product authority.** This note records the current local-vs-cloud Trash lifecycle and the smallest change that would match Tim's direction. It does not authorize implementation. No Worker, R2, IndexedDB, or Trash UI code was changed. No records were migrated or deleted. Nothing was merged or deployed.

VISION → AGENTS → MILESTONE → DECISIONS were read first. Current milestone is the File Cabinet (selective local sync, Check Out / Check In). Stage D already calls for soft Trash as shared recoverable state and durable permanent-delete tombstones. Stage E says Check In / Send remove the local working copy only and never cloud-delete. Remove From This Device is explicitly out of scope and is not Trash.

## What Tim asked for

Customer Files stays the local "On this device" working area. File Cabinet is the online cabinet. Trash belongs inside the File Cabinet, with a 120-day recovery window after a cabinet file is deleted. Restore returns that cabinet item. Empty Trash exists only there, behind a deliberate confirmation, not a new role system. No trash-count badge on the local Customer Files screen.

## Actual lifecycle today (mixed)

Trash is not a separate cloud bin and not a local-only flag. Soft-delete metadata lives on the Customer File itself, in two places that can disagree:

| Piece | Where it lives | What it does |
| --- | --- | --- |
| Soft trash | Local IndexedDB fields `deletedAt`, `purgeAfter` (+120 days), `trashUpdatedAt` | `moveCustomerFileToTrash` / `restoreCustomerFile` in `js/db.js` |
| Soft trash in the cabinet | R2 component `cf/{id}/trash.json` plus the same fields on `cf/{id}/index.json` | Pushed only when that **local** record is included in Sync Now (`js/sync.js` `extractComponent('trash')`, `buildIndex`) |
| Trash screen | `#/trash` in `js/app.js` | Lists **local** rows with `deletedAt` only. Badge is `trashed.length` on `#cabinet-trash-count` |
| Cabinet browse | `browseCabinet` + `cabinetInventoryEntries` | Remote indexes already include `deletedAt`. The File Cabinet list **drops** those indexes. `purgeAfter` is on the index but is not copied onto browse entries. There is no cabinet Trash screen |
| Permanent delete | `DELETE /files/:id` in `sync-worker/src/index.js` | Writes `purge/{id}.json`, then deletes `cf/{id}/*`. Does **not** delete `media/{mediaId}` objects. Does **not** look at checkout. Empty Trash calls this via `deleteRemoteCustomerFile` after the local hard delete |
| 120-day timer | `purgeExpiredCustomerFiles` | **No-op.** Comment in `js/db.js` says a background purge must not write a cloud tombstone. Expired rows stay recoverable until Empty Trash. The "Permanently deletes in N days" line is display-only |
| Check In / Send | `checkInCustomerFile`, `sendToFileCabinet` | Both refuse a record with `deletedAt`. Both remove the local copy only after the cabinet copy is verified. They never call DELETE |

So:

- A file moved to Trash on this phone stays on this phone, hidden from "On this device", until Sync Now pushes the trash component. Other devices learn about it only if they also hold that same id locally; Sync does not download remote-only files.
- A cloud-only cabinet file cannot be trashed or restored from current UI. The only cloud write that removes it is permanent DELETE.
- A cabinet index that already has `deletedAt` is invisible: hidden from File Cabinet, and absent from local Trash unless this device still has the row.

Empty-stub delete is a separate, already-shipped path: no name, address, plan, or survey data may be hard-deleted locally and then `DELETE`d in R2. Named files, addressed files, and files with plans go to local soft Trash instead, so one phone cannot wipe the shared cabinet.

## Why this cannot be a cosmetic move

Hiding `#/trash` and drawing the same list inside File Cabinet would still be a list of **local** `deletedAt` rows. That is not cabinet trash.

Doing the real thing with today's buttons would also be wrong:

- Check Out of a cloud file materializes the full file (and its media) onto the device. Using that as the delete path pulls a job into "On this device" in order to throw it away.
- Check In / Send refuse trashed records, so they cannot be the "remove local copy, leave cabinet trash" step.
- `DELETE /files/:id` skips the 120-day window. It is permanent. Pointing a cabinet Delete button at it would destroy the recoverable copy.

A client-only sequence that checkouts, trashes locally, syncs, then deletes the local row has crash windows (lease left behind, local trash left behind, remote still active) and contradicts selective-local storage. It should not be the design.

## What already exists (no new R2 schema)

These do not need a new bucket, key layout, or database:

- Trash component name is already allowed (`trash: true` in the Worker).
- Index JSON already stores `deletedAt`, `purgeAfter`, `trashUpdatedAt`.
- `GET /files` already returns full indexes, including trashed ones, plus purge tombstones.
- Component PUT and index PUT already work. If nobody holds a checkout lease, an Access user may write. If a lease exists, only that user+device may write (`assertWritableCheckout`).
- Permanent delete + tombstone already exist for an explicit Empty Trash.

No D1, KV, Durable Objects, Queues, or cron are required for the recoverable window. Do not add them in this slice.

## Protected changes that need a yes before code

1. **New client write: mark or clear cabinet trash without a local working copy.** GET index, PUT `trash.json`, re-GET index, PUT index trash fields, GET again to verify. Do not call DELETE. Do not download the file or its media. Write the component before the index, because File Cabinet browse filters on the index. If the index write fails, the file stays visible and can be retried. If a checkout lease exists for someone else, the existing 403 stands — do not trash or restore it.
2. **Empty Trash against cabinet indexes** expands today's blast radius. Today DELETE runs only for rows that are in **this device's** local trash (or for an empty stub). Cabinet Empty Trash would permanently tombstone cloud files this device may never have held.
3. **R2 media is not part of DELETE.** `deleteCustomerFilePrefix` removes `cf/{id}/*` only. Plan and Distress bytes live at `media/{id}` and would be orphaned. Deleting those bytes is a new destructive step: read plans + distress components first, delete those media keys, then write the tombstone and remove the prefix. That Worker/client change should ship in the same slice as cabinet Empty Trash or not at all.
4. **DELETE ignores checkout.** A lease holder can still have the file while another device permanently purges it. A Worker refusal while `index.checkout` is set is a small behavior change on an existing route. It should be part of the Empty Trash yes, not slipped in later.
5. **Local Trash destination.** Removing the button, the count, and `#/trash` before a cabinet restore path exists strands IndexedDB rows that already have `deletedAt`, including ones never synced. Do not migrate or delete those rows automatically.

Until those are authorized, leave the current Trash button, local soft-delete, restore, and Empty Trash exactly as they are.

## Proposed slice after authorization

Explainable in three sentences: Deleting a File Cabinet entry sets the existing trash fields on that cabinet copy and keeps the bytes for 120 days. Restore clears those fields so the file shows in the cabinet again, still not on the phone. Empty Trash is the only permanent delete, it lives only on that screen, and it still writes today's purge tombstone.

Concrete behavior:

- File Cabinet header gets a Trash control with **no count**. The active list remains indexes with no `deletedAt`. The trash list is indexes with `deletedAt`, using `purgeAfter` for the countdown line. Offline cabinet trash is unavailable, same as cabinet browse.
- Delete on a cloud-only, unlocked file uses the component-then-index write above. `purgeAfter` is 120 days from `deletedAt`. `trashUpdatedAt` is that same timestamp.
- Restore uses the same write with `deletedAt` and `purgeAfter` cleared and a newer `trashUpdatedAt`. It does not Check Out.
- If this device also has a local row for that id, trash/restore go through the existing local helpers and `syncOneRecord` so the next Sync cannot push the opposite state. The local row is not removed by this slice (Remove From This Device is still out of scope).
- Empty Trash lists only indexes that already have `deletedAt`. Confirmation requires typing `EMPTY` (Access stays the only login; no roles). Skip any id with a checkout lease. Server DELETE also refuses a leased file. Then delete referenced `media/*` keys, write the tombstone, delete `cf/{id}/*`.
- No scheduled purge. The countdown stays informational, matching `purgeExpiredCustomerFiles`. Expired cabinet files remain restorable until Empty Trash.
- Only after the cabinet list, restore, and the unsynced-local rule below work: remove the Customer Files Trash button and the count badge. Keep a quiet recovery link with no number, shown only when this device still has a `deletedAt` row that is not in the cabinet. Do not auto-delete it.

Tests to add with that slice, without production data:

- Active cabinet list hides `deletedAt`; trash list shows it and the countdown.
- Cloud-only trash write creates no local IndexedDB row and does not call DELETE.
- Restore clears remote `deletedAt` and does not Check Out.
- A foreign checkout blocks trash, restore, and Empty Trash.
- Empty Trash never selects an index with `deletedAt == null`.
- Check In / Send still never call DELETE.
- Existing local trash tests stay green until the local button is actually removed.

## Decisions needed before any of that code

1. **Local-only draft.** A file that was never sent has nowhere to go if the local Trash screen is removed, and Remove From This Device is out of scope. Preferred hold: keep today's local soft-delete for those drafts, with a quiet no-badge recovery link only while such rows exist. Trash of a file that is already in the cabinet happens only from File Cabinet.
2. **Checked out on this phone.** Preferred hold: File Cabinet Delete refuses while this device holds the working copy. The investigator Check In first, then deletes from the cabinet. Do not drop the working copy as a side effect of Trash.
3. **Empty Trash media.** Preferred hold: do not expose cabinet Empty Trash until media-key deletion and the checkout refusal are in the same change. Typed `EMPTY` confirmation, no new roles.
4. **120-day auto-delete.** Preferred hold: do not add a cron. Permanent delete remains the explicit Empty Trash action.

## This PR

Documentation only. Safe to review. Not safe to treat as permission to change `sync-worker/`, R2 contents, or the Trash UI.
