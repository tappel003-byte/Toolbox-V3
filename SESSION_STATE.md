# Toolbox — Session State

**Living handoff.** Update this file when the working picture changes so Tim, Cursor, or Claude Code can open it and know where things are — without depending on one long chat’s memory.

This does **not** replace authority docs. Read order for rules and vision:

1. `VISION.md`
2. `AGENTS.md`
3. `MILESTONE.md`
4. `DECISIONS.md`
5. **This file** — current working picture

Last updated: **Nov 10, 2026** (America/Denver)  
Updated by: Cursor — Tim authorised Sync Worker deploy; this agent has no Cloudflare auth. Ball with Tim to run the deploy (or attach `CLOUDFLARE_API_TOKEN`).

---

## Ball (ask “who has the ball?”)

| Field | Value |
|-------|--------|
| **Has the ball** | **Tim** — Sync Worker deploy authorised but **not run** (no Cloudflare token / `wrangler whoami` unauthenticated). After Tim deploys, Ball → Claude Code to confirm the live Worker. |
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

## Sync Worker deploy (authorised Nov 10 — blocked here)

Tim authorised deploy from integration tip (includes #208). This Cloud Agent:

- Has **no** `CLOUDFLARE_API_TOKEN` / `CF_API_TOKEN` in the environment
- `npx wrangler@4 whoami --config sync-worker/wrangler.toml` → **You are not authenticated**

**What the deploy would bring live** (Worker files changed on integration since pre-#208, tip includes these):

1. `sync-worker/src/index.js` (`6cfaefb`) — raw media PUT streams into R2 when `x-toolbox-encoding: raw` (Job Walk video); no full `arrayBuffer` buffer first.
2. `sync-worker/src/explore.js` (`1152eeb`) — File Explorer lists Job Walk audio (`vm_`) and video (`vid_`) from distress `jobWalk`.

Bindings declared in `sync-worker/wrangler.toml` (must stay on deploy): R2 `CABINET` → `toolbox-cabinet`; Images `IMAGES`.

**Tim’s steps (from repo root, authenticated machine):**

```bash
git fetch origin claude/milestone-1-customer-file-qv5ybf
git checkout claude/milestone-1-customer-file-qv5ybf
git pull origin claude/milestone-1-customer-file-qv5ybf
npx wrangler@4 deploy --config sync-worker/wrangler.toml
npx wrangler@4 deployments list --config sync-worker/wrangler.toml   # note version id
curl -sS https://sync.sandiageotoolbox.com/health   # imagesBinding true
```

Optional verify: PUT a tiny body to `/media/vid_deploy-test-…` with `x-toolbox-encoding: raw`, GET it back, then DELETE if the API allows (or leave a clearly named test object and remove from R2). Confirm Sync Now / File Explorer still read.

After a successful deploy: update this file with version id / time / commit, then **Ball → Claude Code** to confirm the live Worker.

---

## Outstanding — open only

1. **Sync Worker deploy** — Tim (or re-run agent after `CLOUDFLARE_API_TOKEN` is available). Then CC confirm live.
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
