# Toolbox — Session State

**Living handoff.** Update this file when the working picture changes so Tim, Cursor, or Claude Code can open it and know where things are — without depending on one long chat’s memory.

This does **not** replace authority docs. Read order for rules and vision:

1. `VISION.md`
2. `AGENTS.md`
3. `MILESTONE.md`
4. `DECISIONS.md`
5. **This file** — current working picture

Last updated: **Nov 11, 2026** (America/Denver)  
Updated by: Cursor — POR chrome layout blockers (Insert + window height); Ball to Claude Code.

---

## Ball (ask “who has the ball?”)

| Field | Value |
|-------|--------|
| **Has the ball** | **Claude Code** — recheck chrome layout fix tip below (Insert reachable at 1440/1280 via elementFromPoint; editor fits under app-bar). Function KEEP must stay green. Not merged. |
| Integration tip | `claude/milestone-1-customer-file-qv5ybf` @ `da63c08` (pre-POR-Fabric). Feature PR bases there; not merged. |
| Stage tip SHAs | Stage 1 `dcf590e` · Stage 2 `60298d8` · Stage 3 `b6318df` · Stage 4 `b151d54` · CC-fix `63584a9` · CC2 `ab7e903` · CC3 `5c4d240` · Chrome `14bd97e` · **Chrome-layout** `56787b2` |
| Fabric | **5.3.0** MIT vendored at `js/vendor/fabric.min.js` (+ `STATIC_SHELL`) |
| Not done | CC recheck (incl. full suite) → Tim decide/merge into integration. Do not merge to `main`. Do not deploy/promote. |

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

Branch: `cursor/por-fabric-stages-2ac5` → PR #210 into `claude/milestone-1-customer-file-qv5ybf`.

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
| **Chrome-layout** | `56787b2` | Insert+Print pinned; app-view fits under 56px app-bar; Format pane gets a column; outline chip tracks selection |

### CC check of chrome `14bd97e` (Nov 11) — look right; two layout blockers → Cursor fixed

**Held:** draw, outline, dash, move, undo/redo, handles, mini toolbar, ribbon labels, shape gallery, request-only Format Shape, page thumbs.

**Blockers fixed this tip:**
1. Insert unreachable at 1440/1280 — Insert+Print now pinned in `.por-ribbon__end` outside the scroll; `elementFromPoint` hits `#por-insert-btn`; Insert sits left of Print.
2. Editor 56px taller than the window — `#app-view` is `calc(100dvh - 56px)` under the app-bar; status bar bottom equals `innerHeight`.

**Smaller also touched:** Format Shape pane takes a real grid column when open; Fill labeled; Transparency labeled; blank-sheet hint hides once marks exist; outline chip follows applied outline colour.

Tests: `node tests/plan-of-repair.mjs` → **88/88** (includes Insert reachable + no overflow at 1440/1280 via elementFromPoint).

---

## Sync Worker deploy — done Nov 10, 2026

- Deployed by Claude Code with Tim's Cloudflare API token (saved as a network secret on Tim's Default cloud environment).
- Version `9f211d74-bc47-45c1-bda9-1904e884c214` from `claude/milestone-1-customer-file-qv5ybf` @ `08e154c`. Previous version `b7ddc1af-d896-4f2c-bf82-e1e11ca968b0` (rollback target).
- **Always deploy with `--config sync-worker/wrangler.toml`.**

---

## Outstanding — open only

(unchanged from prior handoff unless Tim says otherwise)
