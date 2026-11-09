# Toolbox — Session State

**Living handoff.** Update this file when the working picture changes so Tim, Cursor, Claude Code, or ChatGPT can open it and know where things are — without depending on one long chat’s memory.

This does **not** replace authority docs. Read order for rules and vision:

1. `VISION.md`
2. `AGENTS.md`
3. `MILESTONE.md`
4. `DECISIONS.md`
5. **This file** — current working picture

Last updated: **Nov 8, 2026** (America/Denver)  
Updated by: Cursor agent — TLS workspace QA/QC corrections on `cursor/tls-workspace-2ac5` (Claude Code recheck next; do not merge).

---

## Who is working / which chat

| Role | Detail |
|------|--------|
| Product owner | Tim (`tappel003`) |
| Long Cursor thread (archive + continuity) | https://cursor.com/agents/bc-eddcce18-c57b-423f-b2f4-6f17f8662ac5 — “Toolbox V3 continued” |
| Preference | Stay with Cursor; Tim wants less fighting over process. Other idle side-agents are optional; one good working context is enough. |

Long chats cost more tokens and do **not** give the model continuous human-like memory. Durable facts belong here and in the authority docs.

---

## Shipping — same page for every agent

| Act | Who | Where |
|-----|-----|--------|
| Build | Implementer (agent) | Feature branch off the integration branch |
| Merge | Implementer, **only when Tim asks** | **`claude/milestone-1-customer-file-qv5ybf`** |
| Promote / live Production | **Tim only** | Cloudflare |

**Hard facts (do not re-litigate):**

- Integration branch name is fixed in `AGENTS.md` / `DECISIONS.md` (merged #196, tip includes `ff424f2`).
- Bot merge into `main` **can publish live** (verified Nov 5, 2026 — `toolbox-shell-v439` went live without Tim promoting). Treat merge-to-`main` as promote risk. Warn and stop if it would publish.
- Never deploy Sync Worker, change Access, or promote without Tim’s explicit go.
- Discussion is not a work order. “Go” / “do it” / “build it” = authorization. Describing UI is not authorization.
- Never tell Tim what to do with his time.
- When Tim says “Merge I promote,” that is merge to the **integration** branch only. Promote is still Tim. Prefer the agent Tim is talking to for the merge when that is clear; the merge itself is still valid if another authorized agent lands it on the right branch and Tim accepts the result.
- **Not the path (closed Nov 8, 2026):** GitHub protection so “bots cannot merge `main`.” Tim: that is not the correct path. Do not reopen it as outstanding work. The shipping table above is the path — merge to integration only; Tim promotes.

---

## Branch tips (as of last update)

| Branch | Tip (approx) | Notes |
|--------|----------------|-------|
| `claude/milestone-1-customer-file-qv5ybf` | `1a4e672` | **Integration tip.** Includes #200 SESSION_STATE repair, #199 address two lines, #198 delete gate, #197–#194 prior. |
| `main` | `a4336df` | Has #193 floor/share/toolbar; **behind** milestone on #195–#200. Live site already had `v439` from the main merge of #193. |

Always re-check with `git fetch` before claiming tip SHAs.

---

## Recently finished (code on integration branch unless noted)

| Item | State |
|------|--------|
| Floor open seed: prefer book `reportBuilder.floorLayout`; legacy slide `meta.layout` only if book absent | Done — #194 on milestone. Also on `main` via #193 (that merge published). |
| Verification: both / legacy-only / neither; H/L offsets unchanged | Passed (`tests/report-floor-legacy-vs-book.mjs`) |
| Share lookbook = **link only** (no ZIP download) | Done on milestone |
| RB toolbar regroup: format \| Fit+Present \| Draft/Print/Share/Export | Done on milestone |
| Plan of Repair as RB-style drawing template | On milestone; earlier bring-to-main for promote |
| Engineer lookbook packager + Worker routes in repo | In tree; floor sheet capture fix #195 on milestone |
| Lookbook product intent | **Keep it.** Tim does not think it’s a bad idea. Gap is ops/Access, not the idea. |
| On-this-device ••• Delete gate | Done — #198. No DS pin-photos and no FS points → local Delete on •••; otherwise Explorer note. Floor plan alone does not block. Was shell `v441`; tip now `v442`. |
| Library / home card address on two lines | Done — #199 (`1e786f8`, merge `f055fed`). Street on line 1; city/state/ZIP on line 2 (envelope style). Display only — does not rewrite `propertyAddress`. Shell `toolbox-shell-v442`. Built by Claude Code; Tim accepted (“good”); Cursor repairing this handoff. |

---

## Outstanding — real open work

1. **TLS workspace integrated build** — PR #204 on `cursor/tls-workspace-2ac5`. Builds: `1adaf3b` → QA fix `09b6879` → second recheck fixes (H4 multi-view frame/pan/zoom + print match, N1 missing import print warn, Job Walk `getStoredMedia`, Blob→dataURL on read, shell `v445`). **Claude Code recheck on the newest tip**, then ChatGPT vision, then merge to integration only when Tim’s process completes. See `docs/tls-build-and-review-brief.md` and `VISION.md` §4a. Do **not** merge until both reviews pass on the same SHA.

2. **Cloudflare Access path bypass for `lookbook/*`** on `sync.sandiageotoolbox.com`  
   - Without this, engineer (and private-window) opens hit Cloudflare login.  
   - Tim’s ops action.  
   - Create/upload/finalize stay Access-gated; only public GET needs the bypass.

3. **Confirm Sync Worker deploy has lookbook create routes**  
   - If Share still shows **“Not found”**, `POST /lookbook` is not on the live Worker.  
   - Deploy (when Tim authorizes / from an authenticated machine):  
     `npx wrangler@4 deploy --config sync-worker/wrangler.toml`  
   - Runtime secrets attach when an agent **starts**. An already-running VM may not see `CLOUDFLARE_API_TOKEN` even when it is set in Cursor Secrets.

4. **Stale / unrelated open PRs** (don’t confuse with current tip)  
   - #165 older promote-rules docs (intent largely covered by #196)  
   - #151, #139, #120, and older main-based #97 / #86 / #85  
   - Triage when Tim wants; not blockers for lookbook Access.

---

## How any new agent (Cursor / Claude Code / ChatGPT) should start

1. Read `VISION.md` → `AGENTS.md` → `MILESTONE.md` → `DECISIONS.md` → **`SESSION_STATE.md`**.
2. `git fetch origin claude/milestone-1-customer-file-qv5ybf` and branch from that tip.
3. Open PRs with **base = `claude/milestone-1-customer-file-qv5ybf`**. Merge there when Tim asks. Do **not** promote. Do **not** merge to `main` unless Tim explicitly asked for promote-prep **and** you warned about publish risk.
4. Do not scrap lookbook. Finish Access bypass (Tim) + confirm Worker if Share 404s.
5. After meaningful progress, **update this file** (date, tips, done/outstanding) in the same PR or a small follow-up — so the next handoff stays true. #199 landed without that update; that gap is what this repair closes.

---

## Update checklist (when you change this file)

- [ ] Date / timezone label  
- [ ] Integration + `main` tip SHAs (after fetch)  
- [ ] Done vs outstanding still accurate  
- [ ] Lookbook / Access / Worker status  
- [ ] Any new “do not repeat” process lesson Tim just enforced  
