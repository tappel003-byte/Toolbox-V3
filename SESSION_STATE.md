# Toolbox — Session State

**Living handoff.** Update this file when the working picture changes so Tim, Cursor, or Claude Code can open it and know where things are — without depending on one long chat’s memory.

This does **not** replace authority docs. Read order for rules and vision:

1. `VISION.md`
2. `AGENTS.md`
3. `MILESTONE.md`
4. `DECISIONS.md`
5. **This file** — current working picture

Last updated: **Nov 10, 2026** (America/Denver)  
Updated by: Claude Code — Sync Worker deployed (token added by Tim); Ball to Tim.

---

## Ball (ask “who has the ball?”)

| Field | Value |
|-------|--------|
| **Has the ball** | **Tim** — Sync Worker **deployed** Nov 10 by Claude Code (version `9f211d74-bc47-45c1-bda9-1904e884c214`, from integration `08e154c`). Tim: open https://sync.sandiageotoolbox.com/health in a browser and do one Sync Now; then app promote when ready. |
| Integration tip | `claude/milestone-1-customer-file-qv5ybf` @ `08e154c` (includes #208 merge `706176f`; shell `v452`). |
| Not done | Sync Worker deploy → CC confirm live Worker → app **promote** (Tim). Not merged to `main`. |

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

## Sync Worker deploy — done Nov 10, 2026

- Deployed by Claude Code with Tim's Cloudflare API token (saved as a network secret on Tim's Default cloud environment).
- Version `9f211d74-bc47-45c1-bda9-1904e884c214` from `claude/milestone-1-customer-file-qv5ybf` @ `08e154c`. Previous version `b7ddc1af-d896-4f2c-bf82-e1e11ca968b0` (rollback target).
- Live now: streaming raw media PUT (Job Walk video); File Explorer lists Job Walk audio + video. Confirmed in the live script.
- Bindings unchanged after deploy: R2 `CABINET` → `toolbox-cabinet`, `IMAGES`, secret `CF_ACCESS_AUD`, var `CF_ACCESS_TEAM_DOMAIN`. Custom domain `sync.sandiageotoolbox.com` still attached.
- **Always deploy with `--config sync-worker/wrangler.toml`.** Run from inside `sync-worker/` without it, wrangler picked up the app's root `wrangler.jsonc` (the toolbox-v3 app — that is a promote) and only failed because `publish/` was missing.
- Not verified from the agent (its network cannot reach the host): `/health` and a live Sync Now — Tim's browser check.

---

## Outstanding — open only

1. **Sync Worker deploy** — done (`9f211d74`). Tim's browser check of `/health` + one Sync Now.
2. **PR #207** docs cleanup — still open for Tim merge after CC if needed.
3. **Plan of Repair look check** vs MS Paint / PowerPoint (Tim’s screenshots).
4. **POR lows** — right-rail Format Shape duplicates the pickers and shows for text boxes; fill checkbox has no label.
5. **App promote** — Tim only. Not `main` unless Tim asks promote-prep.

Open product (safer defaults already shipped; Tim has not decided): keep video on phone after upload; Job Walk audio still travels with the file.

---

## How any new agent should start

1. Read `VISION.md` → `AGENTS.md` → `MILESTONE.md` → `DECISIONS.md` → **`SESSION_STATE.md`**.
2. Branch from `claude/milestone-1-customer-file-qv5ybf`.
3. PRs base = that branch. Merge there when Tim asks. Do not promote. Do not deploy Sync Worker without Tim’s go (this deploy was authorised; auth was the blocker).
