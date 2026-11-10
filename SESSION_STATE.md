# Toolbox — Session State

**Living handoff.** Update this file when the working picture changes so Tim, Cursor, or Claude Code can open it and know where things are — without depending on one long chat’s memory.

This does **not** replace authority docs. Read order for rules and vision:

1. `VISION.md`
2. `AGENTS.md`
3. `MILESTONE.md`
4. `DECISIONS.md`
5. **This file** — current working picture

Last updated: **Nov 10, 2026** (America/Denver)  
Updated by: Claude Code — review of POR Fabric `b151d54`: blockers found; Ball to Cursor.

---

## Ball (ask “who has the ball?”)

| Field | Value |
|-------|--------|
| **Has the ball** | **Cursor** — fix Claude Code findings on POR Fabric `b151d54`: real mouse cannot draw (pointerdown is preventDefault-ed, Fabric never gets mousedown; tests only pass with synthetic events); shapes drift on every open/close; arrows lose arrowheads; rich text loses bold; Print button overflows the toolbar. Next: Claude Code recheck, then Tim. |
| Integration tip | `claude/milestone-1-customer-file-qv5ybf` @ `da63c08` (pre-POR-Fabric). Feature PR bases there; not merged. |
| Stage tip SHAs | Stage 1 `dcf590e` · Stage 2 `60298d8` · Stage 3 `b6318df` · Stage 4 / branch tip `b151d54` |
| Fabric | **5.3.0** MIT vendored at `js/vendor/fabric.min.js` (+ `STATIC_SHELL`) |
| Not done | CC check → Tim decide/merge into integration. Do not merge to `main`. Do not deploy/promote. |

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

## Plan of Repair on Fabric.js (Nov 10, 2026)

Tim decided: rebuild Plan of Repair drawing like PowerPoint on vendored Fabric.js (not hand-built behaviours). Scope: Plan of Repair only — Report Builder / `js/report-overlay.js` untouched.

Branch: `cursor/por-fabric-stages-2ac5` → PR into `claude/milestone-1-customer-file-qv5ybf`.

| Stage | SHA | What |
|-------|-----|------|
| 1 | `dcf590e` | Fabric engine swap at parity: selection, group/rotate, shapes, view-pan, print PNG, legacy→schemaVersion 3 |
| 2 | `60298d8` | Format/text: shade grid, custom/recent, opacity, dash, Format Painter, set-default, mini toolbar, text strip |
| 3 | `b6318df` | Align/distribute, snap guides, grid/rulers, zoom slider + Ctrl+wheel, hand/Space pan, selection pane |
| 4 | `b151d54` | Page thumbs + drag reorder, insert/paste picture (`porimg_*` repair media), export selection/page, colour hover preview |

Tests: `node tests/plan-of-repair.mjs` → **61/61**. Also TLS smoke 33/33, report-drawing-tools 12/12, sync-component-acceptance-model 55/55.

Artifacts under `/opt/cursor/artifacts/`: blank sheet, multi-select, stage2 text, stage3 align+grid, stage4 picture, multiview + 11×17 PDFs.

---

## Sync Worker deploy — done Nov 10, 2026

- Deployed by Claude Code with Tim's Cloudflare API token (saved as a network secret on Tim's Default cloud environment).
- Version `9f211d74-bc47-45c1-bda9-1904e884c214` from `claude/milestone-1-customer-file-qv5ybf` @ `08e154c`. Previous version `b7ddc1af-d896-4f2c-bf82-e1e11ca968b0` (rollback target).
- Live now: streaming raw media PUT (Job Walk video); File Explorer lists Job Walk audio + video. Confirmed in the live script.
- Bindings unchanged after deploy: R2 `CABINET` → `toolbox-cabinet`, `IMAGES`, secret `CF_ACCESS_AUD`, var `CF_ACCESS_TEAM_DOMAIN`. Custom domain `sync.sandiageotoolbox.com` still attached.
- **Always deploy with `--config sync-worker/wrangler.toml`.** Run from inside `sync-worker/` without it, wrangler picked up the app's root `wrangler.jsonc` (the toolbox-v3 app — that is a promote) and only failed because `publish/` was missing.
- Not verified from the agent (its network cannot reach the host): `/health` and a live Sync Now — Tim's browser check.

---

## Outstanding — open only

1. **CC check** of POR Fabric Stages 1–4 (`cursor/por-fabric-stages-2ac5` @ `b151d54`).
2. **Tim decide/merge** into integration when ready. Not `main`. No deploy/promote.
3. **Sync Worker** — deployed (`9f211d74`). Tim's browser check of `/health` + one Sync Now still open from earlier.
4. **Open against `main` (not merged):** #97 topo figure pages, #86 Diagnostics ribbon, #85 RB drafts/print — leave until Tim asks promote-prep / bring-to-main.

---

## How any new agent should start

Read `VISION.md` → `AGENTS.md` → `MILESTONE.md` → `DECISIONS.md` → this file. Work only the current milestone. Ball is named above.
