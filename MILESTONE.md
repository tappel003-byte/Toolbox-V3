# Cross-device Customer File synchronization

## Purpose

Make Customer Files created, imported, or edited on one authorized device available on the user’s other authorized devices, while preserving local-first offline field capture.

## Status

**Current milestone.** Cross-device synchronization is active infrastructure work and is intentionally ahead of Report Builder and Diagnostics. Older milestone language that deferred cloud sync is superseded.

## Controlling model (KISS)

Toolbox is the file cabinet. Each Customer File is one job container. Customer Information, Plans/Canvases, Distress, Floor Survey, and future Diagnostics/Report Builder are independently synchronizable components inside that container.

**Save** = safely stored on this device (local, immediate, offline-capable).  
**Sync Now** = exchange changed components and their required media with the private Cloudflare cabinet.

If a proposed change cannot be explained clearly in 2–3 sentences, stop and simplify it before implementation.

## Staged sequence

### Stage A — Foundations
- Component revision plumbing (independent change tracking per sub-file)
- Worker + private R2 + Cloudflare Access foundation
- Sync API / client foundation against existing local IndexedDB
- Visible **Sync Now** control + minimal status

### Stage B — Customer Information + Plans
- Synchronize Customer Information
- Synchronize Plans/Canvases
- Synchronize plan media (actual image bytes)
- Prove a Customer File can appear correctly on another device

### Stage C — Distress + Floor
- Synchronize Distress
- Synchronize Floor Survey
- Synchronize Distress photos (actual media bytes)
- Prove complete real Customer File transfer and offline use on the second device

### Stage D — Trash / recovery synchronization
- Preserve existing recoverable Trash and 120-day retention intent
- Deleted/restored state must synchronize so old copies do not silently resurrect active files

### Stage E — Later polish (only after A–D are trusted)
- Simple last-synced status (e.g. “Synced 2 min ago”)
- Optional quiet automatic synchronization — only after manual Sync Now is proven

## In scope

- Local-first sync plumbing around the existing Customer File / IndexedDB model
- Component-level push/pull (not whole-file last-write-wins)
- Shared Tim/Lee library across iPhone, iPad, installed PWA, and desktop
- Required media traveling with synchronized components
- Auth for Sync Now via Cloudflare Access without blocking offline local use

## Out of scope

- Redesigning Distress capture
- Redesigning Floor Survey capture
- Redesigning Customer File
- Building Report Builder or Diagnostics
- Building a Control Panel
- SaaS tenancy, roles, invitations, billing, per-file ACLs
- Live collaboration, presence, CRDTs, field-level merge UIs
- D1, KV, Durable Objects, Queues, Firebase, Supabase, or other extras unless Worker + R2 is concretely insufficient
- Making background auto-sync the only v1 mechanism

## Acceptance (owner-facing)

1. Device A: Customer File exists or is imported → Save locally → Sync Now.
2. Device B: Open Toolbox → Sync Now → same Customer File appears with required Customer Information, Plans/Canvases, applicable Distress/Floor data, and required media.
3. Device B goes offline → the synchronized Customer File and applicable field tools continue working from local storage.

Fred Keulen may be used as the real-world acceptance candidate.

Cross-check: a change to one component on one device must not overwrite a newer change to a different component on another device. Same-component conflict: newest component version wins for v1.
