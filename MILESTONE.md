# File Cabinet — selective local sync foundation

## Purpose

Make Customer Files safely shareable through an authoritative Cloudflare File Cabinet while preserving local-first offline field capture. Devices keep only the working Customer Files they need — not a complete mirror of the Cabinet.

## Status

**Current milestone.** File Cabinet sync foundation and data-integrity hardening are active. Exclusive Check Out / Check In is the **next** implementation slice (not complete in this transition). Work remains ahead of Report Builder and Diagnostics.

## Controlling model (KISS)

Cloudflare is the File Cabinet. Each Customer File is one job container. Customer Information, Plans/Canvases, Distress, Floor Survey, and future Diagnostics/Report Builder are independently synchronizable components inside that container.

**Save** = safely stored on this device (local, immediate, offline-capable).  
**Sync Now** = update the cloud copy of this device’s **local working** Customer Files and their required media. Does **not** download every remote Cabinet entry. Does **not** require local inventory == cloud inventory.  
**Check Out / Check In** (next slice) = exclusive edit authority + verified cloud completeness before release.

Any device may create a Customer File locally with no network. First placement into the Cabinet may still happen via Sync of that local file until an explicit Place/Check Out UI exists.

If a proposed change cannot be explained clearly in 2–3 sentences, stop and simplify it before implementation.

## Superseded assumption

Full-cabinet convergence (“every authorized device’s local Cabinet must match Cloudflare after Sync Now”) is **not** the product model. Cloud-only Customer Files are normal. Local-only drafts are normal until placed in the Cabinet.

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

### Stage E — File Cabinet checkout (IN PROGRESS)
- Cabinet browse from lightweight indexes (no full CF download)
- Authenticated user + device checkout ownership
- Check Out / Sync while checked out
- Customer Files screen = on-device working area; File Cabinet is a dedicated `#/cabinet` browse/manage screen (closed card entry, search by name/address, Check Out returns to working area)
- Check In with completeness verify / release — not in this foundation slice
- Remove From This Device (local only) — not in this foundation slice
- Take Over (explicit recovery) — not in this foundation slice

### Stage F — Later polish
- Clearer status wording
- Optional quiet auto-sync only after manual Sync + checkout are trusted

## In scope (current checkout foundation slice)

- Stable deviceId persistence
- Verified Cloudflare Access JWT identity for checkout ownership
- Lightweight Cabinet browse + explicit Check Out materialize
- Atomic checkout acquire (R2 conditional put) + Sync ownership gate
- Preserve selective-local Sync Now / tombstone / shell-epoch protections

## Out of scope

- Check In ceremony, Take Over, Remove From This Device
- Explicit local-draft / Place-In-Cabinet product
- Redesigning Distress / Floor / Customer File capture
- Report Builder or Diagnostics
- SaaS tenancy, roles, invitations, billing, per-file ACLs
- Live collaboration, CRDTs, merge UIs
- D1/KV/DO/Queues/Firebase/Supabase unless Worker+R2 is proven insufficient

## Acceptance (owner-facing)

1. Device can create a Customer File offline, Save locally, and later Sync that local file into the File Cabinet without requiring other remote jobs to download.
2. Remote-only Cabinet entries do not auto-appear on the device after Sync Now, and do not make Sync fail merely by existing.
3. Media/component failures still fail Sync honestly for the affected local working file(s).
4. Permanent delete tombstones still prevent stale local resurrection.
5. Check Out foundation: browse cloud indexes → Check Out acquires user+device lease → materialize only that file → non-owner cannot push → owner can Sync while checked out.

Fred Keulen remains a real-world candidate after checkout is live — not for permanent-delete testing.
