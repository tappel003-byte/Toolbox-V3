# Toolbox — Session State

**Living handoff.** Update this file when the working picture changes so Tim, Cursor, or Claude Code can open it and know where things are — without depending on one long chat’s memory.

This does **not** replace authority docs. Read order for rules and vision:

1. `VISION.md`
2. `AGENTS.md`
3. `MILESTONE.md`
4. `DECISIONS.md`
5. **This file** — current working picture

Last updated: **Nov 11, 2026** (America/Denver)  
Updated by: Cursor — merge-everything into integration (Initial Visit + clear-red). Ball → Tim.

---

## Ball (ask “who has the ball?”)

| Field | Value |
|-------|--------|
| **Has the ball** | **Tim** — merge-everything landed on `claude/milestone-1-customer-file-qv5ybf`. Promote when ready. Not on `main`.
| Integration tip | `a373a59` (`a373a596c84693a28c08bd04394473de108d505a`) |
| Stage tip SHAs | Stage 1 `dcf590e` · Stage 2 `60298d8` · Stage 3 `b6318df` · Stage 4 `b151d54` · CC-fix `63584a9` · CC2 `ab7e903` · CC3 `5c4d240` · Chrome `14bd97e` · Chrome-layout `56787b2` · **Chrome-collapse** `e423a01` |
| Fabric | **5.3.0** MIT vendored at `js/vendor/fabric.min.js` (+ `STATIC_SHELL`) |
| Shell | `toolbox-shell-v461` |
| Not done | Do not merge to `main`. Do not deploy Sync Worker. Do not promote. |

When an agent finishes its turn of work, it **must** update this table to name who has the ball next. Tim can ask “who has the ball?” anytime; the answer is this row.

---

## Review loop (Tim, Nov 9, 2026)

**ChatGPT is out — permanently for this work.** Do not use ChatGPT for this build.

| Role | Who |
|------|-----|
| Build | **Cursor** |
| Check | **Claude Code (CC)** |
| Decide and promote | **Tim** |

---

## Shipping

| Act | Who | Where |
|-----|-----|--------|
| Build | Implementer | Feature branch off integration |
| Merge | When Tim asks | **`claude/milestone-1-customer-file-qv5ybf`** |
| Promote / live Production | **Tim only** | Cloudflare |
| Sync Worker deploy | **Tim only** (or agent with `CLOUDFLARE_API_TOKEN`) | `npx wrangler@4 deploy --config sync-worker/wrangler.toml` |

Hard fact: merge to `main` can publish live. Do not merge to `main` unless Tim asks promote-prep.

---

## Plan of Repair on Fabric.js (Nov 10–11, 2026)

Tim decided: rebuild Plan of Repair drawing on vendored Fabric.js 5.3.0 (MIT), PowerPoint-style. Scope: Plan of Repair only — Report Builder / `js/report-overlay.js` untouched.

Merged: `cursor/por-fabric-stages-2ac5` → integration (Nov 11).

| Stage | SHA | What |
|-------|-----|------|
| 1 | `dcf590e` | Fabric engine swap at parity |
| 2 | `60298d8` | Format/text |
| 3 | `b6318df` | Arrange / guides / zoom / selection pane |
| 4 | `b151d54` | Page thumbs, pictures, export |
| CC fix | `63584a9` | Real mouse draw; rect/circle no drift; arrowheads; bold flag; Print visible |
| CC2 | `ab7e903` | Absolute multi-select save; arrow pin; rich bold; Insert Text typing; arrowhead pixels |
| CC3 | `5c4d240` | Style save; undo/redo; Print first row; colour pop hit-testing |
| Chrome | `14bd97e` | PowerPoint look-and-feel pass |
| Chrome-layout | `56787b2` | Insert+Print pinned; app-view under app-bar |
| **Chrome-collapse** | `e423a01` | PPT ribbon group collapse; Editing+Insert+Print pinned; height fit; chip sync; reachability tests |

### CC recheck of chrome layout `e423a01` (Nov 11, 2026) — PASSES

Real mouse at 1280×800 and 1440×900: every ribbon and status-bar control reachable. `tests/plan-of-repair.mjs` green on that tip.

---

## Initial Visit (Nov 11, 2026)

Authorized by Tim: "do the thing we added to the to-do list today." Merged into integration this turn (`cursor/initial-visit-2ac5`).

- Same Customer File container with `status: 'visit'` (absent on ordinary files).
- Home `+ Initial Visit` → name/phone/address → visit card (`js/job-walk.js` UI renamed).
- Visits lists: device heading, File Cabinet group, File Explorer Visits folder.
- Make Customer File: MOVE same id; landing floor / distress / home from outcomes.
- Offline: SW mirrors `/` as well as `/index.html` (PWA `start_url`); shell `v461` after merge.
- Tests: `tests/initial-visit.mjs`.

**Offline root cause (Nov 10 Job Walk):** PWA `start_url` is `/`, but the shell only cached `/index.html`. Cold offline open of `/` waited on network-first navigate and had no `/` cache mirror, so the yard open failed even though `js/job-walk.js` was in `STATIC_SHELL`.

**CC found four small defects (fix on a new branch off integration — do not hold this merge):**
1. Button order on the home screen
2. Phone not on the card
3. No gap above the Visits heading
4. Wording of the offline cause

---

## Clear-red suites A (Nov 11, 2026)

Merged `cursor/clear-red-suites-2ac5` into integration this turn. Triage A clears: `tests/customer-file-trash.mjs` + `tests/customer-file-cross-record.mjs` (Floor Survey path). CC checked the A tip; remaining 16 red suites are still open (floor-survey / report-floor / report-highlow / sizing / sw-update-ready).

---

## Sync Worker deploy — done Nov 10, 2026

- Deployed by Claude Code with Tim's Cloudflare API token (saved as a network secret on Tim's Default cloud environment).
- Version `9f211d74-bc47-45c1-bda9-1904e884c214` from `claude/milestone-1-customer-file-qv5ybf` @ `08e154c`. Previous version `b7ddc1af-d896-4f2c-bf82-e1e11ca968b0` (rollback target).
- **Always deploy with `--config sync-worker/wrangler.toml`.**

---

## Outstanding — open only

1. **Initial Visit CC polish** — four small defects (new branch after merge-everything).
2. **Red suites** — 16 remaining after clear-red A clears of trash + cross-record (floor-survey / report-floor / report-highlow / sizing / sw-update-ready).
3. **Sync Worker** — Tim's browser check of `/health` + one Sync Now. Redeploy later if Cabinet Explorer needs Worker `copyIdentity` status passthrough.
4. **App promote** — Tim only. Not `main` unless Tim asks promote-prep.
5. **Plan of Repair look check** vs MS Paint / PowerPoint (Tim’s screenshots).
6. **Open against `main` (not merged):** #97 / #86 / #85 — leave until Tim asks promote-prep.

---

## How any new agent should start

1. Read `VISION.md` → `AGENTS.md` → `MILESTONE.md` → `DECISIONS.md` → **`SESSION_STATE.md`**.
2. Branch from `claude/milestone-1-customer-file-qv5ybf`.
3. PRs base = that branch. Merge there when Tim asks. Do not promote. Do not deploy Sync Worker without Tim’s go.
