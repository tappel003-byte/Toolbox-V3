# Toolbox — Session State

**Living handoff.** Update this file when the working picture changes so Tim, Cursor, or Claude Code can open it and know where things are — without depending on one long chat’s memory.

This does **not** replace authority docs. Read order for rules and vision:

1. `VISION.md`
2. `AGENTS.md`
3. `MILESTONE.md`
4. `DECISIONS.md`
5. **This file** — current working picture

Last updated: **Nov 10, 2026** (America/Denver)  
Updated by: Claude Code — recheck of POR Fabric `ab7e903`: style-save and undo broken; Ball to Cursor.

---

## Ball (ask “who has the ball?”)

| Field | Value |
|-------|--------|
| **Has the ball** | **Cursor** — CC recheck of `ab7e903`: multi-select align/group coords, arrow round-trip, legacy bold, Insert Text typing all fixed. Still open: (1) style changes on a selected shape (outline colour, dash) are not saved; (2) Undo/Redo (Ctrl+Z, Ctrl+Y, toolbar) do nothing to the drawing; (3) Print/PDF wraps to a second toolbar row at 1440 px. Next: Claude Code recheck, then Tim. |
| Integration tip | `claude/milestone-1-customer-file-qv5ybf` @ `da63c08` (pre-POR-Fabric). Feature PR bases there; not merged. |
| Stage tip SHAs | Stage 1 `dcf590e` · Stage 2 `60298d8` · Stage 3 `b6318df` · Stage 4 `b151d54` · CC-fix `63584a9` · CC2 `ab7e903` |
| Fabric | **5.3.0** MIT vendored at `js/vendor/fabric.min.js` (+ `STATIC_SHELL`) |
| Not done | CC recheck → Tim decide/merge into integration. Do not merge to `main`. Do not deploy/promote. |

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

Tim decided: rebuild Plan of Repair drawing on vendored Fabric.js 5.3.0 (MIT), PowerPoint-style. Scope: Plan of Repair only — Report Builder / `js/report-overlay.js` untouched.

Branch: `cursor/por-fabric-stages-2ac5` → PR #210 into `claude/milestone-1-customer-file-qv5ybf`.

| Stage | SHA | What |
|-------|-----|------|
| 1 | `dcf590e` | Fabric engine swap at parity |
| 2 | `60298d8` | Format/text |
| 3 | `b6318df` | Arrange / guides / zoom / selection pane |
| 4 | `b151d54` | Page thumbs, pictures, export |
| CC fix | `63584a9` | Real mouse draw; rect/circle no drift; arrowheads; bold flag; Print visible |
| CC2 | `ab7e903` | Absolute multi-select save; arrow pin; rich bold; Insert Text typing; arrowhead pixels |

**CC2 fixed (this turn):**
1. Multi-select align/group/distribute/nudge save absolute sheet coords (discard ActiveSelection before serialize; move via `setPositionByOrigin`).
2. Line/arrow `porPctEnds` pin — open/close exact; sync skips rewrite when unchanged.
3. Legacy `{paragraphs:[{runs:[{bold:true}]}]}` → Fabric bold + plain text.
4. Insert Text enters edit mode with placeholder selected; typed text saves.
5. Arrowhead ink verified on lower canvas + print snapshot size.

Tests: `node tests/plan-of-repair.mjs` → **73/73** (real mouse/keyboard for CC2 cases).

---

## Sync Worker deploy — done Nov 10, 2026

- Deployed by Claude Code with Tim's Cloudflare API token (saved as a network secret on Tim's Default cloud environment).
- Version `9f211d74-bc47-45c1-bda9-1904e884c214` from `claude/milestone-1-customer-file-qv5ybf` @ `08e154c`. Previous version `b7ddc1af-d896-4f2c-bf82-e1e11ca968b0` (rollback target).
- **Always deploy with `--config sync-worker/wrangler.toml`.**

---

## Outstanding — open only

1. **CC recheck** of POR Fabric tip `ab7e903` on `cursor/por-fabric-stages-2ac5`.
2. **Tim decide/merge** into integration when ready. Not `main`. No deploy/promote.
3. **Open against `main` (not merged):** #97 / #86 / #85 — leave until Tim asks promote-prep.

---

## How any new agent should start

Read `VISION.md` → `AGENTS.md` → `MILESTONE.md` → `DECISIONS.md` → this file. Work only the current milestone. Ball is named above.
