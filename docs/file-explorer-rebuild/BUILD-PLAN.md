# File Explorer — build plan

**This is a proposal for review. Nothing in it is built, and none of it is
authorized to build.** It is the output of a design conversation with Tim on
Oct 29, 2026, written so GPT/Codex can challenge it before any of it starts.

Base: `claude/milestone-1-customer-file-qv5ybf` at `248b89d` — PR #145 merged.

---

## Where things stand

**Built and merged (#145).** A job leads with what it records — levels,
readings, pins, photographs, survey date, elevation range. Every folder says
what is inside it before you walk in. Open on a stored record leads with that
sentence and puts the record syntax behind one closed line. Download job copy
hands over a readable folder with a readings CSV, a pin list, named
photographs, the contour layer, and `Technical/` with the raw records and a
mapping from storage id to file. The desktop has the tree, list and details
panes from drawings four and six.

**Of the seven drawings, three are built**: the two desktop job screens and
the desktop list with its details pane.

**Not built**: the phone entry screen (drawing one), the phone map (two), the
desktop map (five).

---

## The device question, now settled

Tim, Oct 29: *"it's not a phone first scenario — if I need to really get into
the file and look for things I'll look for it on the desktop. I just want the
functionality on the phone."*

And: *"If I need to go look at a job, yeah, I will probably query it on my
phone."*

So the rule for this work is **desktop-first in layout, genuinely capable on
the phone**. Nothing is desktop-only except what physically cannot work there
— the Save As dialog is desktop Chrome and Edge only, and that is a browser
limit, not a design choice.

What the phone must be able to do: find a job quickly, see what is in it,
query by content, look at its pictures without a punishing download, and Take
Over a job when a device has died. What it does not need to be is the place
deep work happens.

This also fills a gap: File Explorer was never given a device classification.
Report Builder and Diagnostics are desktop-only, Distress Edit is
desktop-first/mobile-capable, capture is field-first — Explorer is on none of
those lists, which is why its phone view has drifted.

---

## How existing jobs get covered — settled

There are roughly **15 jobs on the server today**, and Tim wants all of them
searchable and on the map — not just jobs created from here on (Tim, Oct 29:
*"I would like those to be searchable going forward because that's what
populates our map right now, so I guess I want those included somehow"*).

Two separate things were being conflated in the conversation that produced
this plan, and the distinction is the whole decision:

**Rewriting jobs — rejected.** A pass that opens each job's index and writes
to it. Tim said no, and he was right: index writes are where the ownership
races live, and PR #145 was largely about closing them.

**Reading jobs — this is what we do.** The Worker reads `customer.json`,
`distress.json` and `floor.json` for each job — objects it already holds —
and writes **one** catalogue file. No job index is opened for writing. No
component is modified. No checkout lease moves. At 15 jobs it is 45 reads and
one write, and it takes seconds.

### Why not do it by hand instead

Syncing each job manually was considered and is worse. A job has to be on a
device to sync, so any job that lives only on the server would have to be
**checked out first** — which transfers the lease to that device and then
needs checking back in. That is about thirty real state changes, each with
consequences, to achieve what a read-only pass does in seconds.

### The two pieces

1. **Once:** the Worker builds the catalogue from the jobs already in the
   Cabinet. Covers everything that exists today.
2. **Ongoing:** a job adds itself as it syncs. Covers everything after.

For (2) there is a catch worth stating, because it would otherwise be found
the hard way. `syncOneRecord` pushes the index only when `(changed ||
!remote)` — so a job opened and synced without being edited is skipped. And
**opening a job in File Explorer writes nothing at all**: Explorer only reads,
which is deliberate and is a guarantee PR #145 tightened a test around. So (2)
needs the push condition to also fire when the stored index lacks the new
information:

```
if ((changed || !remote || indexLacksNewFields(remote)) && mayPush) { … }
```

`mayPush` is unchanged, so a job checked out on another device is still left
alone and is picked up when it returns.

### What keeps this safe

The catalogue is **derived, never authoritative**. It is only ever built from
the jobs; nothing exists solely inside it. If it is wrong, stale, or lost, the
fix is to rebuild it — the jobs always win. That is what makes a rebuild a
non-event rather than a risk, and it is why rebuilding is the answer to any
later drift rather than patching the catalogue in place.

**Two small decisions inside this:**

- A job with **no coordinates at all** — address typed by hand, no suggestion
  picked, no location captured — has nothing to plot. It must be shown as
  absent from the map rather than guessed at or silently dropped. How many of
  the 15 that affects is not known from here and is worth checking before the
  map is built.
- A job in **Cabinet Trash** is recoverable, so it keeps its catalogue entry
  and its pin, with the map and search filtering it rather than the catalogue
  omitting it.

---

## Slice 1 — Thumbnails that do not cost 70 MB

**The problem, measured.** The contact sheet downloads the *entire*
full-size photograph to draw each 320px tile (`watchTile` in
`js/file-explorer.js` fetches the whole object and shrinks it in the browser).
A folder of 38 phone photographs is roughly 70–100 MB pulled down to look at a
sheet of small pictures. On cell service that is the single worst thing about
Explorer on a phone.

**The fix.** Cloudflare's Images binding transforms from an R2 source inside
the Worker. Verified from their docs: R2 is a valid source; input limit 20 MB
(4032×3024 phone JPEGs are well under); output WebP/AVIF/JPEG.

**Cost.** 5,000 unique transformations per month free, then $0.50 per 1,000.
Billed once per unique source+parameters per calendar month, so a thumbnail is
paid for once and then free for the rest of that month however often it is
viewed. Because the photographs stay in R2 rather than moving into Cloudflare
Images storage, there is no storage or delivery charge on top. Realistic usage
is free. On the free plan, exceeding the allowance stops transformations
rather than billing — the failure mode is "thumbnails stop", not a surprise
invoice.

**Expected effect.** A 38-photo folder goes from roughly 70 MB to about 1 MB.

**Risk.** Low. It is an additional read path; the original bytes are untouched
and the existing full-size fetch stays as the fallback when a transformation
fails or is unavailable. Needs the Images binding enabled on the account.

**Pairs with**: edge caching. A photograph never changes once stored, so the
transformed result is trivially cacheable. Cloudflare's own docs note the
binding does not cache by itself and recommend Workers Cache with
`Cache-Control`. Included, no extra charge.

**Why first**: highest value per unit of risk, costs nothing, and it is the
change that makes the phone usable at all.

---

## Slice 2 — The searchable catalogue

**Tim's idea, Oct 29**, and it is better than the engineering default: a text
file holding the searchable content of a job — customer summary, report text,
pin and picture descriptions — so that querying *"half inch drywall crack"*
scans text rather than opening jobs.

Why it is the right answer: no search service, no database. D1, KV, Durable
Objects and Queues are forbidden by `AGENTS.md` without explicit
authorization, and this needs none of them. A text file is also still readable
in 2031, which the archive goal asks for.

**Sizes.** A job with 38 pins is roughly 4 KB of descriptions; with the
customer block and report prose, call it 10–15 KB. All 187 jobs is 2–3 MB. One
year is about half a megabyte.

**Shape proposed.**

- One file per job is authoritative and lives with the job. One combined file
  per **year** is what a query reads — a single fetch, then searched in the
  browser. Splitting by year falls out of the filing rule we already follow
  and matches the map's year range, so "Santa Fe, around 2022" narrows before
  it searches.
- **Sections are labelled.** Tim drew the distinction himself: the pin
  description is what was *observed*, the report text is what was *concluded*.
  A hit that cannot say which it came from loses that difference exactly when
  it matters.
- **Derived, never authoritative.** It is rebuilt from the components;
  nothing exists only in it. A stale or missing catalogue is a rebuild, not
  lost data.

**Why this works well on a phone**: one small file downloaded once, then
instant and still working on poor signal. A database would need a round trip
per search.

**Open**: whether the catalogue is built for existing jobs (see the question
above), and whether the report's full text or only its headings go in.

---

## Slice 3 — The phone entry screen

Drawing one, minus the parts that rest on things we have since parked.

**Build:**

- Year and month grouping, newest first. The filing-date rule
  (`fieldWorkSurveyDate`: floor survey date, else distress survey date, no
  third fallback) is already implemented and the desktop tree already reads
  it — it simply is not rendered below 1100px.
- Today the list is flat and alphabetical, Chalmers → Walt. On a phone the
  job wanted is almost always a recent one.
- **Download job** on the row. The builder exists.
- **Town** on the meta line. An address splitter already exists in Report
  Builder.
- Trim the five-line explanatory paragraph that currently sits between the
  title and the first job.
- Search placeholder to match the drawing: "name, address or town".

**Raise, do not decide:** Delete currently sits at thumb height on every row,
beside Open. Tim was explicit that Delete lives in Explorer and nowhere else,
and that is not in question. Where it sits on a phone row is a separate
question from whether it exists — on a desktop with a pointer the same layout
is fine.

**Not built, and why:** the Working/Filed drawers and the ✓ Completed ticks
both need a completion mark written at Check In. Nothing writes one. Creating
it is a sync and lifecycle change, not Explorer work, and inventing one here
was explicitly out of bounds.

---

## Slice 4 — The map

**What it is for.** Tim, Oct 29: *"Five years from now we might not remember
an address, but we might remember that it was in Santa Fe in the area, and so
we can go back and query those jobs."*

That is sharper than the drawings implied. It is not a display — it is a
**query tool for a job you cannot name**. Tapping an area must hand back the
jobs in it; the year range matters; clustering is not optional at a few
hundred pins.

**Decided:** it does not need to work offline (Tim, Oct 29). Explorer is
already online-only because it reads the server, and the offline requirement
is about field capture, not the back door.

**Provider:** Geoapify, already wired into Toolbox for address autocomplete
and reverse geocoding with a live key in `js/config.js`. They serve standard
`{z}/{x}/{y}` tiles. Free tier is 3,000 credits/day at 0.25 credits per tile —
roughly 12,000 tiles a day, far beyond two people browsing. Attribution is
required and is automatic when loading through their style URL. One thing to
confirm: their docs say a key covers "map tile services and other APIs" but do
not explicitly confirm the existing geocoding key does, so it may need
enabling on the same account.

**A correction to something said earlier in the conversation**, recorded so it
is not carried forward: tiles were described as "job data going to a third
party on every pan". That was overstated. A tile request asks for the image of
a map square — it carries the viewport, not the jobs. Job coordinates stay in
the browser and pins are drawn on top. Geoapify already receives addresses
during autocomplete, so the map adds no new category of exposure.

**Coordinates.** `propertyAddressLat` / `propertyAddressLon` are already
captured on every job where an address suggestion was picked or Use My
Location was tapped. They live in the customer component and are **not** in
the Cabinet index, which is what a map must read — it cannot open every job to
find out where they are. Adding the pair to `buildIndex` is two lines; getting
them onto jobs that already exist is the one-time read above.

**A job with no coordinates at all** — an address typed by hand with no
suggestion picked and no location captured — has nothing to plot and must be
shown as absent from the map rather than guessed at or quietly dropped. How
many of Tim's jobs that affects is not known from here.

**Work:** index field (small), the map itself (about a day), clustering and
the year range (about a day, and not optional under this use case).

---

## Slice 5 — Simplification candidates

Tim asked to talk about simplifying. These are candidates, not
recommendations, listed for GPT to challenge:

1. **Ten folder groups** (`GROUPS` in `js/file-explorer.js`): customer, plans,
   distress, quick-capture, other-photos, floor, diagnostics, report, other,
   technical. Three of them — Quick Capture, Other photos, Other stored files
   — are near-identical photograph buckets. Empty groups are already hidden,
   so this is about whether the populated ones are too finely split.
2. **Two download routes.** The readable job copy and the raw server copy.
   GPT's review of #145 said keep both, with the raw one once under Technical
   details, and that is where it is. Noted here only because it is one more
   decision on the screen.
3. **Three overlapping summaries.** The facts panel, the line under each
   folder, and the component summary inside a folder all say related things.
   On a phone that is a lot of scrolling before reaching contents.
4. **The facts panel sits between the phone and the contents.** If the phone
   is for "find it and look at it", a collapsed-by-default facts panel on
   small screens may serve better than an expanded one.

---

## Deferred, with the reason

| Item | Why |
| --- | --- |
| Working / Filed drawers, ✓ Completed | Needs a completion mark at Check In that nothing writes. A lifecycle change, not Explorer work. |
| R2 lifecycle rules for the 120-day Trash | Would mean Cloudflare deleting Tim's files on a timer with Toolbox having no part in it. Raised, not recommended, wants a deliberate decision. |
| Rewriting existing job indexes in bulk | Tim's decision, Oct 29. The one-time catalogue build is a different operation — it only reads. |
| Semantic / "find jobs like this one" search | Would mean Vectorize or Workers AI. Real, but a large step beyond a text file, and forbidden without authorization. |

---

## Open questions

The largest one — whether the jobs already on the server get covered — is
**answered**: yes, by a one-time read-only build of the catalogue, plus the
sync trigger change for everything after. What is left:

1. Should the catalogue carry the report's full text, or only its headings
   plus the pin and picture descriptions? Full text makes more findable; it
   also means a search hit can land on a conclusion rather than an
   observation, which is why the sections are labelled either way.
2. Is the existing Geoapify key valid for map tiles, or does that need
   enabling on the same account?
3. Does the Images binding need enabling, and is Toolbox on Cloudflare's free
   or paid plan? It changes the over-allowance behaviour from "thumbnails stop
   working" to "it bills".
4. Where should Delete sit on a phone row? It stays in Explorer either way —
   this is only about it being at thumb height next to Open.
5. Is the sync trigger condition (`indexLacksNewFields`) better keyed on the
   map coordinates, the catalogue entry, or a single version number on the
   index that both hang off? A version number is one check instead of two and
   survives the next field being added; it is also one more thing on the
   index.
6. What triggers a catalogue rebuild after the first one — every sync that
   changes a job, a periodic rebuild, or only on request? Rebuilding is cheap
   at this scale and always safe, so the question is about when rather than
   whether.

---

## Not in this plan

Diagnostics, Report Builder, capture changes, sync optimisation, any new
cloud infrastructure, any Access or deployment configuration change, and
anything that deploys or promotes. One small unrelated defect worth someone's
two minutes: `explorer-mockups.html` has no `<meta charset="utf-8">`, so the
✓ and ‹ in the preserved drawings render as mojibake when the file is opened.

---

## Suggested order

1. **The write side**, together: map coordinates and the catalogue entry into
   `buildIndex`, the sync trigger change, and the one-time Worker build of the
   catalogue from the ~15 jobs already in the Cabinet. Small, and nothing
   downstream is worth building until the jobs actually carry the
   information.
2. **Thumbnails**, with caching. Highest value per unit of risk, costs
   nothing, and it is the change that makes the phone usable at all.
3. **The phone entry screen.**
4. **The map**, once coordinates have been landing long enough to show
   something worth looking at.
5. **The simplification pass**, last, once there is something to simplify
   against.

Steps 2 and 3 are independent of each other and of step 1, and could be
reordered or run in parallel. Step 4 is the only one with a real dependency.
