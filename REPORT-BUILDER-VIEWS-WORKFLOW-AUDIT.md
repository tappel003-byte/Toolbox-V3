# Report Builder vs proposed multi-view compose workflow — read-only audit

**For:** Tim → ChatGPT handoff  
**Authority used:** VISION.md → AGENTS.md → MILESTONE.md → DECISIONS.md → current code  
**Audited commit:** `b6aea91f151adf3e187f532afbfaa0e6415329eb` (branch `cursor/fs-topo-control-hub-7b33`)  
**Method:** Code and test-source inspection only. **Tests were not run** this pass.  
**Scope:** Proposed workflow treated as an audit target only — not authorization to build.

---

## Proposed workflow (Tim)

> I compose a report sheet using views of my survey data, like arranging screenshots in PowerPoint.
>
> Each view can show the floor and display style I choose: main floor contours, main floor readings, second floor, etc. Selecting a view makes the controls apply to that view.
>
> I can add or copy views, then move and resize them. Side-by-side views should have matching heights and aligned top and bottom edges. Resizing one resizes linked views. Moving them snaps into alignment.
>
> Frames should fit the drawings closely so unnecessary white space does not dictate the layout.

---

## Bottom line

Today’s Floor Survey report sheet is **one level per page**, with optional **two side-by-side renditions of that same level** (shared camera, independent appearance).

It is **not** freeform multi-view PowerPoint compose (different floors on one sheet, N views, free move/resize of view frames, snap/align tools).

---

## 1. What Tim can do TODAY (exact path)

1. Open Report Builder. Floor Survey pages are assembled from source: each closed boundary, then Combined last (`js/report-source.js`).
2. **Import** (auto and/or `[data-rb-floor-import]`) mounts live topo for that page’s `canvasId` / `areaId`. Legend and H/L/Δ are separate movable chrome (`js/report-builder.js` ~6042–6115; `js/report-floor-layout.js` `renderPage`).
3. **Two views / One view** (`[data-rb-floor-twoup]`) sets `meta.floorTwoUp`. Second settings live on `meta.floorView2` (seeded as a clone of slot 0).
4. **Click a frame** → `page._floorSlot`. Rail Contours / Labels / Layers drive that slot’s `floorView` or `floorView2`.
5. **Pan / zoom** updates book `floorCamera` and pushes to both hosts (`pushCameraToTopoHosts`).
6. **Move** legend / pill / aerial; **resize** aerial corners; size legend/pill from rail scales. Imported topo frames are **fixed side-by-side slots**, not free boxes.
7. **Place this slide on its own** / **Use the shared placement** → `meta.ownLayout` vs book `floorLayout` (Combined use case).
8. **Duplicate** clones the whole page (`clonePage` copies `meta`, including two-up state).
9. **Present / Print** compose stills from camera + settings; chrome from saved layout (`composeFloorStills`, `cameraExtentFor`).

---

## 2. Capability table

| Proposed capability | Status | Notes / code |
|---|---|---|
| Same floor twice, different appearance | **Already working** | `floorTwoUp` + `floorView` / `floorView2`; click → `_floorSlot` |
| Different floors on one sheet | **Not implemented** | Both slots use the same `meta.canvasId` / `areaId` |
| More than two views | **Not implemented** | Hard cap: `Math.min(2, …)` / `frameShare` |
| Copy an individual view | **Partial** | Two-up seeds `floorView2` as a clone; no first-class “copy view” object |
| Duplicate a whole slide | **Already working** | `#rb-duplicate-page` → `clonePage` (meta includes two-up) |
| Select a view → controls apply to it | **Already working** | Frame click + rail remount on slot |
| Independent appearance per view | **Already working** | Per-slot render settings |
| Independent framing / camera per view | **Not implemented** | One book `floorCamera`; deliberately linked |
| Matching heights / top–bottom align (two-up) | **Working by construction** | Equal outer frames + shared camera — not free align tools |
| Linked resize of views | **Partial** | Equal width via `frameShare`; camera linked; frames not freely resized |
| Grid / alignment snapping | **Not implemented** | Not found |
| Reduce unnecessary white space | **Partial** | Pan/zoom; first-fit `frameForPlan`; print extent from camera. Plan-image margins remain |
| Preserve arrangement in Present / PDF | **Already working** | Layout + camera + views persist; stills match frames (test sources assert this; not re-run here) |
| Shared placement vs slide-own override | **Already working** | `floorLayout` / `meta.ownLayout` — chrome/aerial, not per-view frames |

### Status legend used above

- **Already working** — UI path exists and is wired in current code.
- **Present underneath but not exposed** — none called out as the main gap for this workflow (two-up is exposed).
- **Partial** — real behavior, short of the proposed capability.
- **Not implemented** — absent in current model.

---

## 3. What “same size” currently means

For two-up:

- **Same outer frame geometry:** each view gets `(100 − 2%) / 2` of stage width and **100% stage height** (`frameShare`, `FRAME_GUTTER = 2` in `js/report-floor-layout.js`).
- **Same plan region:** one shared `floorCamera`, so both windows show the same crop.

That is **same displayed crop and frame height**.

It is **not**:

- matching the visible building silhouette across different plan images, or
- the same physical drawing scale for different floors (different floors are different pages; camera is book-wide for flip-book registration).

Distinguish:

| Phrase | Current meaning |
|---|---|
| Same displayed height | Equal outer frames (two-up) |
| Same physical drawing scale across different floors/plans | Not what two-up does |
| Same plan-image rectangle | Shared camera crop of one plan |

---

## 4. Where white space comes from

Do not collapse this to one cause. Do not assume cropping evidence away.

| Source | Role |
|---|---|
| Plan image itself | Margins/padding baked into the scan |
| Camera / fit | What plan region fills the frame (`floorCamera`, `rel`) |
| Frame aspect | Imported: stage × `frameShare`; legacy/non-imported: `layout.topo` |
| Page chrome | Title rail on the right; stage ≈ sheet minus rail (`STAGE_SHARE_OF_SHEET`) |
| Data-extent fallback | `reportTopoDataExtent` adds ~4% pad when no camera (`floor-survey/src/lib/report-topo-figure.ts`) |
| Combined pages | No legend/pill on the page → left column freer; `ownLayout` for that case |

---

## 5. Smallest gaps vs the proposed workflow

1. **Different levels on one sheet** — absent; two-up is same level only.
2. **N > 2 or free-placed view frames** — absent; slots are fixed full-bleed.
3. **Independent cameras per view** — conflicts with current linked `floorCamera` (intentional for side-by-side register).
4. **Snap / align tools** — absent; two-up alignment is structural, not a tool.
5. **Copy view vs Duplicate page** — only page duplicate + two-up seed.
6. Soft load gap: `reviveFloorView` runs on `meta.floorView` only — **`floorView2` is not revived the same way** (`js/report-builder.js` ~8034–8040); the field still persists via meta clone.

### Material conflict with the shared-placement model

Book `floorLayout` + book `floorCamera` assume **one registered picture** across Floor Survey slides.

Free multi-object views with independent frames/cameras on one sheet fights that model.

`ownLayout` only exempts **chrome placement** for one slide — not multi-floor compose on one sheet.

(Decision record: DECISIONS.md “One layout record”, Oct 22–23, 2026.)

---

## Key files

| File | Role |
|---|---|
| `js/report-builder.js` | Import, two-up, camera, selection, Present/Print stills, duplicate |
| `js/report-floor-layout.js` | `floorLayout`, `frameShare`, `renderPage`, chrome boxes |
| `js/report-source.js` | Floor page outline (boundaries then Combined) |
| `floor-survey/src/lib/report-topo-figure.ts` | Still composition / data extent |
| `floor-survey/src/host/ReportTopoWorkspace.tsx` | Live hosted topo in the rail/sheet |
| `js/report-rail.js` | Title-block rail (identity/readings) — not two-view ownership |

---

## Relevant tests (source asserts; not run this pass)

- `tests/report-floor-framing.mjs` — two-up equal framing; linked pan; print still match
- `tests/report-mixed-view-extent.mjs` — print extent independent of which slide Print started from; `frameShare` gutter math
- `tests/report-bleed-figure-extent.mjs` — imported print uses stage/`frameShare`, not stale `layout.topo`
- `tests/report-floor-one-layout.mjs` — one shared `floorLayout` across slides
- `tests/report-floor-slide-own-layout.mjs` — `meta.ownLayout` exception + restore
- `tests/report-floor-drawing-movable.mjs` — pan persists; stale camera lock cleared
- `tests/report-floor-chrome.mjs` — legend/pill movable independent of pan
- `tests/report-present-no-chrome.mjs` — Present hides editor chrome
- `tests/report-print-matches-editor.mjs` — print sizing vs editor

---

## Data model cheat sheet

**Document-level**

- `reportBuilder.floorLayout` — shared topo/overview/overlays placement
- `reportBuilder.floorCamera` — book-wide camera
- `reportBuilder.floorView` — default render settings seed
- `reportBuilder.floorFramed` — first-fit already done

**Per-page `page.meta`**

- Identity: `canvasId`, `epochId`, `areaId`, `scope`, `scopeTitle`, `levelName`, `imported`, …
- Rendition: `floorView`, `floorView2`, `floorTwoUp`
- Placement override: `ownLayout`, `hideOverview`

**Runtime only (not saved)**

- `page._floorSlot` — which view the rail is driving

**Terminology in code**

- **View / slot** = one live Topo host on a slide (1 or 2)
- **Combined** = separate page with `scope === 'all'`, not a two-view mode
- **Figure frame** on imported slides = full-bleed stage slot from `frameShare`, not a freely placed `layout.topo` box

---

*End of audit. No implementation authorized by this document.*
