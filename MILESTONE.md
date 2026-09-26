# Report Builder — Pen Log

## Purpose

Assemble a native Pen Log in Report Builder from the Distress Survey already stored on the Customer File. One page per level that has pins. The floor plan image, numbered pin markers, schedule, and report wording are separate page elements. The investigator can correct wording on the report without changing the source survey.

## Status

**Current milestone**, set by the product owner on Sept 26, 2026. File Cabinet sync is largely functional. That milestone is preserved below as history and is not reopened here.

VISION §20 describes the milestone that was current when that paragraph was written: it records the sync model and does not build Report Builder. The owner changed which milestone is current. VISION §12 still governs this workspace. This slice does not change the sync model, Distress capture, or Floor Survey capture.

## This slice

- A 17×11 landscape Pen Log for each Distress level that contains pins.
- Measured first checkpoint from the 1515 Los Nietos figure, now called Pen Log: thin sheet border, figure title at the upper left, plan and pins on the left to about 9.5 inches, ruled schedule from about x=10 inches to about y=10.4 inches. Columns are Photo, pin #, Location, and Notes.
- Pin and photo numbers follow the Distress sequence across levels. Pins stay registered to the plan when the plan’s aspect ratio letterboxes inside the frame.
- A report note is stored on the Report Builder component (`record.reportBuilder.penLog`). Opening a report does not write the Customer File. The Distress description stays the source.
- Photographs stay reachable from the page. They are not stacked observation cards on the sheet.

## Out of scope — next reviewable slices

- Photo pages and editable captions
- Registered Floor Survey topo, data, legend, and high / low / delta pages
- Drawing tools, page-order drafts, and print packaging
- Diagnostics, File Cabinet changes, and deployment

The 1515 file is not in this repository. Figure numbers, company logos, and other details that need that reference stay open until an owner-approved redacted copy is available.

---

# Previous milestone — File Cabinet selective local sync foundation

Preserved as history. Not the current milestone.

## Purpose

Make Customer Files safely shareable through the Cloudflare File Cabinet while preserving local-first offline field capture. The active local device is the editing authority. The File Cabinet is the shared, transfer, and filed location and the device-loss mirror — not a second editor. Devices keep the local working Customer Files they need and may keep local safety copies of files they already hold. They do not keep a complete mirror of the entire Cabinet.

## Status

**Previous milestone, preserved.** The File Cabinet sync foundation, including Check Out / Check In in this repository, is the sync work this section tracks. The Sept 24, 2026 working-authority and Save-checkpoint decisions below control it. Report Builder is now the current milestone, above. Sync work must still not redesign Report Builder, Diagnostics, or field capture.

Quiet online mirroring of the active working Customer File is **decided**. It is not later polish. Sync Now remains the manual confidence action and must answer truthfully. The mirror is not a second editor.

Report Builder and Diagnostics are **not wholly future work**. This repository already has a Report Builder shell and a Diagnostics entry for Floor Survey 3D. Further integration is in active pull requests: #68 Diagnostics workbench, #69 Report Builder evidence, and #70 Report Builder skeleton. Those pull requests are separate work. This milestone does not build them, and sync work must not redesign them.

Post-release local-copy cleanup is **decided** and is a **later small slice**. Do not implement it here, and do not let it complicate normal capture, Save, Sync Now, or Check Out.

## Controlling model (KISS and Occam’s razor)

The active local device is the only editing/working authority for a Customer File being worked on. Cloudflare / File Cabinet is the shared, transfer, and filed location and the device-loss mirror. It is not the live editor.

Each Customer File is one job container. Customer Information, Plans/Canvases, Distress, Floor Survey, Diagnostics, and Report Builder are independently synchronizable components and obey the same lifecycle.

**Autosave** = ongoing local work, immediate, offline-capable.  
**Deliberate Save** (integrated Floor Survey or Distress Survey) = create or replace one protected field checkpoint for that survey. Replace in place. Write the new checkpoint successfully before retiring the previous one. Reference existing photos, plans, and other media. No Save 1/2/3 history. The checkpoint syncs as recovery material and is not auto-materialized as the working survey on Check Out. Floor Survey’s recovery PDF is the existing checkpoint. Distress follows the same principle without a change to protected capture flow.  
**Quiet online mirror** = when the working device is online, mirror the active Customer File to the File Cabinet for device-loss protection. Decided. Not a second editor.  
**Sync Now** = the manual confidence/safety action after poor signal. **“Sync complete.”** when changes upload. **“Everything is already synced.”** when nothing changed. Failures must not be reported as success. Does **not** download every remote Cabinet entry. Does **not** require local inventory == cloud inventory.  
**Check Out** = transfer exclusive editing authority to the receiving device. Other devices may keep complete local safety copies. Once they learn the file is checked out elsewhere, those copies are gray/read-only and cannot mutate or sync over it.  
**Check In** on the editing device = sync, verify the Cabinet copy, and release exclusive authority. Never cloud-delete. The foundation in this repository also removes that device’s own working copy. That removal is not Trash and does not delete another device’s safety copy.  
**File Explorer** = read-only server back door. Not an editor.

Any device may create a Customer File locally with no network. First placement into the Cabinet may still happen via Sync of that local file until an explicit Place/Check Out UI exists.

If a proposed change cannot be explained clearly in 2–3 sentences, stop and simplify it before implementation. Do not add complexity unless it solves a real problem. When two designs protect the data and satisfy the workflow equally well, prefer fewer states, buttons, decisions, assumptions, dependencies, and failure modes. Complexity that is invisible to the investigator still carries a burden of proof if it makes the code fragile.

## Superseded assumption

Full-cabinet convergence (“every authorized device’s local Cabinet must match Cloudflare after Sync Now”) is **not** the product model. Cloud-only Customer Files are normal. Local-only drafts are normal until placed in the Cabinet.

“Quiet automatic sync is later polish” is **superseded**. Quiet mirroring of the active working file is decided. Sync Now remains the manual confidence action.

Reading “Cloudflare is the authoritative File Cabinet” as “the cloud is the live editing authority” is **superseded**. Editing authority is the active local device.

## Staged sequence

### Stage A — Foundations (largely done)
- Component revision plumbing
- Worker + private R2 + Cloudflare Access
- Sync API / client against IndexedDB
- Visible Sync Now + status

### Stage B/C — Component + media integrity (in progress / hardening)
- Customer, plans, distress, floor + required media
- Manufactured-shell protection, media completeness failures, purge tombstones

### Stage D — Trash / permanent delete safety
- Soft Trash as shared recoverable state
- Durable permanent-delete tombstones (no stale resurrection)

### Stage E — File Cabinet checkout (in the repository)
- Cabinet browse from lightweight indexes (no full CF download)
- Authenticated user + device checkout ownership
- Check Out / Sync while checked out
- Customer Files screen = on-device working area; File Cabinet is a dedicated `#/cabinet` browse/manage screen (closed card entry, search by name/address, Check Out returns to working area)
- Check In / Send to File Cabinet from Customer Files ⋯ menu (sync/verify, release lease when checking in, remove that device’s own working copy — never cloud-delete). This does not delete another device’s local safety copy.
- Remove From This Device / Keep Local Copy / Archive as Revision — later small slice, not this stage
- Take Over (explicit recovery) — not in this foundation slice

### Stage F — Decided safety behavior (not “later polish”)

These items are the settled rule. They are outside the checkout-foundation in-scope list. Do not treat them as optional, and do not invent a different lifecycle for them.

- Quiet mirroring of the active working Customer File while online (device-loss protection only; not a second editor)
- Sync Now truthful wording: “Sync complete.” / “Everything is already synced.” / failures are not success
- A local copy that learns it is checked out elsewhere is gray/read-only and cannot mutate or sync over that file
- One protected field checkpoint on deliberate Floor Survey or Distress Survey Save. Record the Distress principle here; do not change protected Distress capture inside a sync slice

This branch implements the quiet online mirror, the Sync Now wording, and the gray/read-only foreign-checkout lock. It does not implement the field checkpoint.

### Later small slice — not this milestone
- After another device’s work is released and the File Cabinet copy is verified complete, the older device may offer Remove From This Device / Keep Local Copy / Archive as Revision
- Do not add that choice to ordinary capture, Save, Sync Now, or Check Out

## In scope (current checkout foundation slice)

- Stable deviceId persistence
- Verified Cloudflare Access JWT identity for checkout ownership
- Lightweight Cabinet browse + explicit Check Out materialize
- Atomic checkout acquire (R2 conditional put) + Sync ownership gate
- Check In / Send to File Cabinet using existing Sync write paths + local-only working-copy removal
- Preserve selective-local Sync Now / tombstone / shell-epoch protections

## Out of scope

- Post-release Remove From This Device / Keep Local Copy / Archive as Revision
- Take Over
- Explicit local-draft / Place-In-Cabinet product beyond Send to File Cabinet
- Redesigning Distress / Floor / Customer File capture, including building the Distress field checkpoint inside this sync foundation
- Building Report Builder or Diagnostics as part of this sync foundation. Their integration is active in separate pull requests (#68, #69, #70) and is not wholly future work
- SaaS tenancy, roles, invitations, billing, per-file ACLs
- Live collaboration, CRDTs, merge UIs
- D1/KV/DO/Queues/Firebase/Supabase unless Worker+R2 is proven insufficient

## Acceptance (owner-facing)

1. Device can create a Customer File offline, Save locally, and later Sync that local file into the File Cabinet without requiring other remote jobs to download.
2. Remote-only Cabinet entries do not auto-appear on the device after Sync Now, and do not make Sync fail merely by existing.
3. Media/component failures still fail Sync honestly for the affected local working file(s).
4. Permanent delete tombstones still prevent stale local resurrection.
5. Check Out foundation: browse cloud indexes → Check Out acquires user+device lease → materialize only that file → non-owner cannot push → owner can Sync while checked out.
6. Send to File Cabinet / Check In: verify remote write, release lease on Check In, remove the checking-in device’s own working copy only — the Cabinet copy survives. That Check In does not delete another device’s local safety copy.

Fred Keulen remains a real-world candidate after checkout is live — not for permanent-delete testing.
