# Toolbox — Session State

**Living handoff.** Update this file when the working picture changes so Tim, Cursor, or Claude Code can open it and know where things are — without depending on one long chat’s memory.

This does **not** replace authority docs. Read order for rules and vision:

1. `VISION.md`
2. `AGENTS.md`
3. `MILESTONE.md`
4. `DECISIONS.md`
5. **This file** — current working picture

Last updated: **Nov 11, 2026** (America/Denver)  
Updated by: Cursor — Initial Visit build on `cursor/initial-visit-2ac5`; Ball → Claude Code.

---

## Ball (ask “who has the ball?”)

| Field | Value |
|-------|--------|
| **Has the ball** | **Cursor** — small fixes to Initial Visit from CC's check of `a2c040c` / `7e29d9c` (list below), then Tim decides merge. Not merged. |
| Integration tip | `claude/milestone-1-customer-file-qv5ybf` @ `da63c08` (unchanged; not merged). |
| Feature branch | `cursor/initial-visit-2ac5` — Initial Visit (Job Walk rename + visit mark + Visits lists + Make CF move + offline `/` shell). |
| Not done | CC check → Tim decide merge. Do **not** merge, promote, or deploy Sync Worker from this branch unless Tim asks. |

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

## This turn — Initial Visit (Nov 11, 2026)

Authorized by Tim: "do the thing we added to the to-do list today."

- Same Customer File container with `status: 'visit'` (absent on ordinary files).
- Home `+ Initial Visit` → name/phone/address → visit card (`js/job-walk.js` UI renamed).
- Visits lists: device heading, File Cabinet group, File Explorer Visits folder.
- Make Customer File: MOVE same id; landing floor / distress / home from outcomes.
- Offline: SW mirrors `/` as well as `/index.html` (PWA `start_url`); `job-walk` is a mutating route.
- Tests: `tests/initial-visit.mjs` (22/22). TLS smoke still 33/33.
- Sync Worker source: `copyIdentity` passes `status` (not deployed this turn).

**Offline root cause (Nov 10 Job Walk):** PWA `start_url` is `/`, but the shell only cached `/index.html`. Cold offline open of `/` waited on network-first navigate and had no `/` cache mirror, so the yard open failed even though `js/job-walk.js` was in `STATIC_SHELL`.

---

## Outstanding — open only

1. **Initial Visit** — CC check on `cursor/initial-visit-2ac5`, then Tim merge decision.
2. **Sync Worker** — deployed (`9f211d74`). Tim's browser check of `/health` + one Sync Now. Redeploy later if Cabinet Explorer should receive `status` from Worker `copyIdentity` (client already handles index.status).
3. **App promote** — Tim only. Not `main` unless Tim asks promote-prep.
4. **Plan of Repair look check** vs MS Paint / PowerPoint (Tim’s screenshots).
5. **POR lows** — right-rail Format Shape duplicates the pickers and shows for text boxes; fill checkbox has no label.
6. **Open against `main` (not merged):** #97 topo figure pages, #86 Diagnostics ribbon, #85 RB drafts/print — leave until Tim asks promote-prep / bring-to-main.

Open product: video after visit→Customer File (Distress has no video); follow-up date as reminder — not decided.

---

## How any new agent should start

Read `VISION.md` → `AGENTS.md` → `MILESTONE.md` → `DECISIONS.md` → this file. Work only the current milestone. Push the branch; do not merge to `main`; do not deploy the Sync Worker unless Tim authorizes.
