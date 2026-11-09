# TLS in Toolbox — integrated build and review brief

Read the entire current Toolbox-V3 repository before changing anything. Read VISION.md → AGENTS.md → MILESTONE.md → DECISIONS.md, then SESSION_STATE.md and the current source. Use VISION.md §4a and Tim's direction here for the TLS work. The repository is the shared handoff.

## Delivery

Tim wants **one integrated build** of the TLS side, Job Walk, and Plan of Repair, followed by one review of the complete result. **Cursor builds. Claude Code (CC) independently reviews the actual diff and tests. Tim owns product decisions and promotion.** ChatGPT is out of this loop (Tim, Nov 9, 2026 — that workspace/chat is not workable).

Cursor can sequence implementation, tests, and fixes internally. Deliver the capabilities below together. Resolve routine implementation choices without asking Tim to approve individual screens, controls, or fixes. Bring a material product conflict to Tim in a single focused question if it blocks a decision. Use the milestone integration branch as the base and follow its existing shipping rules.

## Product contract

One Customer File holds the customer's information for the property. Sandia Geo and TLS are two sides of the same job with different tools, branding, and authored work. A side switch retains the job and its information. Each tool opens independently. A file can start with name, address, and phone and gain plans, photos, notes, surveys, or drawings in any order.

Use [TLS Foundations](https://www.tlsfoundations.com/) as the visual reference for TLS chrome. Use the TLS wordmark, deep navy, gold accents, and warm sand surfaces where appropriate. Keep the familiar Toolbox workspace layout and compact controls. Preserve a clear working canvas. Brand the finished repair sheet for TLS.

## What to build

### Customer File and TLS home

- Keep normal Customer File opening on the familiar Sandia Geo home with Distress Survey, Floor Survey, Diagnostics, and Report Builder.
- Add **Open in TLS** to the Customer File's three-dot menu. Open the same file in a TLS-branded home patterned on the existing workspace cards, with **Job Walk** and **Plan of Repair** available even before a plan exists.
- Use a labeled company switch on the Customer File home rail as the working design for moving between sides. Keep customer identity and property address visible. Keep shared photos, notes, and available plans and documents within reach from either side.
- Make the saved property address tappable for directions and remember the user's Apple Maps or Google Maps preference. Use the saved property address as the destination, with a fallback when the preferred option is unavailable. Keep address editing a separate action.

### Job Walk

- Phone-friendly capture for an open Customer File with or without a plan. Put **Take Photos**, a photo grid, **Videos** (Take Video + clips), and **Visit Notes** on the screen. Allow a description on a photo or video and a dated note for the visit. Make it easy to distinguish what the homeowner said from what the investigator saw.
- Reuse the shared Quick Capture collection and existing photo persistence. Both sides can open the same photos and descriptions. Videos stay on `distress.jobWalk.videos` (not Quick Capture). Preserve the link between Distress photos and their pins and preserve existing numbering.
- Delete controls on photos, visit notes/audio clips, and videos remove the metadata and the stored media bytes.
- In Visit Notes, support typing and audio recording with the homeowner's permission. Make recording status and Stop visible. Allow playback from the saved visit. Handle permission refusal and recording failure with clear feedback and keep typed notes available. Reuse the existing voice memo path where it fits. Verify actual local persistence, media transfer, and playback before calling recording complete. Transcription can follow later.
- Keep visit context with the shared Customer File. Verify photo, audio, and video capture survive leaving, reopening, and the existing check-in/check-out transfer. Apply the existing edit authority and missing-media behavior.

### Plan of Repair

- Open the existing desktop POR workspace from TLS. Reuse Report Builder's familiar layout and drawing controls: slides on the left, sheet and Fit/zoom in the middle, and a right rail for the selected sheet, view, or object. Keep the repair document in record.planOfRepair and the existing repair sync component. Maintain separate report and survey data.
- Allow a blank sheet, a job plan or contour, or an imported drawing. Support multiple sheets and an overall/detail arrangement with multiple views on one sheet. Reuse established Report Builder view controls where they fit. Keep source references and marks stable as the view is zoomed or reframed. Flag missing or changed source media before output and give the user a deliberate way to review a replacement.
- Give Tim a flexible drawing surface. He decides what to draw, where marks go, how to style them, and how to arrange each sheet and its views. Offer ordinary editable lines, shapes, arrows, freehand marks, and text. Make selection, movement, resize, copy, duplicate, nudge, stacking, and undo/redo dependable. Keep selected-object styling separate from tool defaults. Text must survive redraw, reopen, and print. A pier sketch is one example of what Tim might draw. It does not define a required stamp, symbol vocabulary, placement tool, or sheet template.
- Print **11 × 17, landscape** with a TLS title block, property, title, date, sheet identifier, and preliminary status. Correct the existing multi-page output path so sheets print in list order with their own complete backgrounds, views, marks, and notes. A sheet that intentionally starts blank is valid. An unresolved referenced background should identify the affected sheet.
- Keep the first release focused on the above drawing and visit functions. Excel proposal export, replacing Excel, engineering calculators, a stamp library or prescribed repair layout, and general capture redesign are outside this build.

## Complete-build check

Claude Code reviews the implementation and reports blockers against the following checks. Cursor fixes findings and reruns relevant checks before the complete preview is handed back to Tim.

| Case | Evidence |
|---|---|
| Shared job and both doors | Create a file with name/address/phone. Open normally and via **Open in TLS**. Verify the same identity, side switch, shared information, and directions action. |
| TLS with no plan | On a phone, take and describe photos, take and delete a walk-around video, enter a visit note, record and play audio, delete a photo and an audio clip, then reopen. Find the same material on the Sandia Geo side. Exercise denied microphone permission. |
| TLS with a plan | On desktop, build a drawing of the user's choosing over a plan with ordinary editable marks and text. Duplicate, nudge, move, resize, and undo marks, then reopen. Zoom and Fit preserve the saved drawing. |
| Drawing flexibility | Open a blank drawing, import an outside drawing, and compose an overall plan with a detail view. Use another sheet with a contour. Verify source changes are surfaced. |
| Professional output | From the second sheet, generate and visually inspect the complete PDF in page-list order. Check backgrounds, views, marks, text, and TLS title blocks. |
| Local and Cabinet integrity | Verify local reopen and a check-in/check-out transfer with a fixture or authorized test file. Verify the existing Sandia Geo capture, report, and checkout behavior still works. |

Show Tim the complete preview and representative evidence in one review. Report the exact files changed, what changed, decisions or assumptions made, the base and build commit SHAs, the test and review results, and any remaining blockers. Keep implementation, review, merge, and promotion status distinct.
