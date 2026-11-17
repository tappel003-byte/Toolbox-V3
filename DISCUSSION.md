# Toolbox — Parked discussions

**Living discussion file.** Open product talks that are not being built yet live here so Tim, Cursor, and Claude Code can pick them up without re-litigating the chat that produced them.

This does **not** replace authority docs and does **not** authorize work:

1. `VISION.md` — product
2. `AGENTS.md` — how to work
3. `MILESTONE.md` — what may be built now
4. `DECISIONS.md` — what is settled
5. `SESSION_STATE.md` — who has the ball / current working picture
6. `TODO.md` — parked reminders
7. **This file** — discussion prompts and context, still undecided

Nothing here is approved to build until Tim says go. When a discussion lands, write the outcome into `DECISIONS.md` (and update `TODO.md` / `SESSION_STATE.md` as needed), then clear or archive the entry here.

**Active build right now:** TLS / Plan of Repair — see `SESSION_STATE.md` “who has the ball.” Do not let an entry in this file steal that ball.

---

## D-001 — File Cabinet at ~50–100 jobs/year (close-out vs organize)

| Field | Value |
|-------|--------|
| **Status** | Parked — discussion only |
| **Opened** | Nov 17, 2026 (America/Denver) |
| **From** | Tim + Cursor talk; Tim taking the talk to Claude Code |
| **Related parked work** | `TODO.md` “The File Explorer list” / “Where the Cabinet is heading”; mockups in `docs/file-explorer-rebuild/` (Working vs Filed drawers — decide nothing on their own) |
| **Not this discussion** | Server-native Report Builder (separate rework); Drop Box changes; field-capture redesign |

### Why it is parked

Tim is aiming for ~1–2 jobs a week → ~50–100 Customer Files a year. The File Cabinet is fine with a small list; live jobs will get buried under paid/done ones unless close-out and/or Cabinet organization is settled before the list gets long. TLS has the ball today — keep this prompt, do not build it in the middle of POR/TLS work.

### Already settled in the talk (do not reopen)

- Field capture (Distress / Floor Survey) stays **on the phone, local-first**. That was never in dispute.
- Downloading a file to the desk you work on, then uploading later, is OK. Check Out is the lock so two people do not edit the same file — not wasted busywork.
- **Report Builder living entirely on the server** is a coherent desk idea, but it **is a rework**. Not this conversation.
- Drop Box stays “send these files for this job,” not a dump for everything. The Print → Save PDF → drop step is awkward but acceptable for now.
- The live report is further along than “still chasing Mitchell formatting” implied; Export for AI → Grok → paste works. Do not treat Report Builder as the big unfinished hole here.

### Fork not picked yet

1. Finished jobs **leave** the Active Cabinet (Filed shelf / Explorer / similar) and can be put back, **or**
2. Finished jobs **stay** in the Cabinet but we organize/filter better (Active / Completed / Paid, year groups, Active-only default).

Hybrid is on the table.

### Open questions

- What marks a job done — Tim marks it, paid, both?
- Does close-out drop local copies on phones/iPads?
- After close-out, opening Report Builder still via Check Out / download is OK unless decided otherwise.
- Who can reopen?
- Phone Cabinet: Active-only by default?

### Constraints for anyone joining the talk

- Read `VISION.md`, `AGENTS.md`, `MILESTONE.md`, `DECISIONS.md`, and current Cabinet / Explorer / Check Out behavior before advising.
- Explorer today is the server back door (Take Over / Delete), not a second survey editor — say if filing should change that.
- Prefer KISS. Do not invent SaaS tenancy, roles, billing systems, or CRDTs.
- Do not redesign Distress, Floor Survey, Drop Box, or sync-as-a-whole.

### Paste-ready prompt for Claude Code (discussion only)

```
I want a discussion only — no code, no PR, no implementation until I say go.

**Context from a Cursor talk (Tim, Nov 17, 2026):**

Scale is coming: I'm aiming for ~1–2 jobs a week → ~50–100 Customer Files a year. The File Cabinet is fine with a small list; it will get noisy when live jobs sit mixed with paid/done ones from months ago.

**What we already settled in that talk (don't reopen):**
- Field capture (Distress / Floor Survey) stays on the phone, local-first. That was never in dispute.
- I'm OK downloading a file to the desk I'm working on, then uploading later. That Check Out step is the lock so two people don't edit the same file — not wasted busywork.
- Report Builder living entirely on the server is a coherent desk idea, but it is a rework. Not this conversation. Don't mix it in.
- Drop Box is fine as "send these files for this job." Not a dump for everything. The Print→Save PDF→drop step is awkward but acceptable for now.
- I'm happier with the live report than "still chasing Mitchell formatting" implies; Export for AI → Grok → paste works. Don't treat Report Builder as the big unfinished hole here.

**What this discussion is about:**
Closing out / organizing jobs so the Cabinet stays usable at ~100 files/year — without losing history, and with the ability to bring a job back.

**Fork we didn't pick yet:**
1. Finished jobs leave the Active Cabinet (Filed shelf / Explorer / similar) and can be put back, or
2. Finished jobs stay in the Cabinet but we organize/filter better (Active / Completed / Paid, year groups, Active-only default).

Hybrid is on the table.

**Open questions I still need to think through (with you and maybe Melody):**
- What marks a job done — I mark it, paid, both?
- Does close-out drop local copies on phones/iPads?
- After close-out, opening Report Builder still via Check Out / download is OK unless we decide otherwise.
- Who can reopen?
- Phone Cabinet: Active-only by default?

**Constraints:**
- Read VISION.md, AGENTS.md, MILESTONE.md, DECISIONS.md, and current Cabinet / Explorer / Check Out behavior before advising.
- Explorer today is the server back door (Take Over / Delete), not a second survey editor — say if filing should change that.
- Prefer KISS. Don't invent SaaS tenancy, roles, billing systems, or CRDTs.
- Don't redesign Distress, Floor Survey, Drop Box, or sync-as-a-whole.
- Related parked material (not decisions): TODO.md File Explorer / Cabinet sections; docs/file-explorer-rebuild/.

**What I want from you:**
Talk it through with me in plain language. Help me choose a direction (leave Active vs organize in place vs hybrid). Ask the few questions that actually matter. When we land something, write a short design note I can keep — still no build until I say go. The durable copy of this prompt is DISCUSSION.md (D-001).
```

### When this discussion ends

- Write the chosen direction into `DECISIONS.md`.
- Update `TODO.md` so Explorer/Cabinet parked lines match.
- Set who has the ball in `SESSION_STATE.md` if build is authorized.
- Mark this entry **Resolved** (or move the prompt body to an archive section) so it is not re-opened by accident.
