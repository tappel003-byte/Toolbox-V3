# Toolbox — Product Vision

## Status and Authority

This document is the durable product vision for **Toolbox**.

**"Toolbox-V3"** is the repository / development-generation name only. It must never become product branding. The product itself, as it will be known to the people who use it, is **Toolbox**.

The **Customer File** is the central organizing object inside Toolbox. Toolbox is the file cabinet. A Customer File is the customer/job file inside that cabinet. Distress Survey, Floor Survey, Diagnostics, and Report Builder are the specialized workspaces that operate inside an already-open Customer File.

The product owner and final decision-maker is Tim. This document exists so the product vision does not depend on any one conversation, developer, or AI model.

Implementers and AI collaborators are encouraged to challenge decisions when they see a real problem or a better approach. They must not silently substitute a different product while implementing the one described here.

This document distinguishes among:

- **DECIDED** — part of the intended product.
- **PROTECTED** — proven behavior or a core principle carrying a high burden of proof for change.
- **NOT YET DECIDED** — an idea, possibility, or unresolved question. It is not an implementation requirement, and no answer should be invented for it here.

Nothing is absolutely frozen forever. Better ideas are welcome. But proven behavior should not be changed merely for code convenience, consistency, modernization, stylistic preference, or because an implementer would have designed it differently.

---

## 1. Why Toolbox Exists

Toolbox is an internal professional instrument for field investigation, evidence organization, interpretation, technical communication, and report production.

Its guiding rule is:

> **Make the tool so easy to use you'd be a fool not to use it.**

That does not mean making professional work simplistic. The investigation is sophisticated because of the knowledge and judgment of the investigator. Toolbox should make it as easy as possible to perform that investigation properly and communicate what was found.

> **Toolbox should remove work without removing thought.**

The investigator should spend time looking at the building, talking with the client, observing conditions, taking measurements, understanding patterns, applying professional experience, and communicating findings, conclusions, limitations, and uncertainty.

The investigator should not spend unnecessary time entering information Toolbox already knows, transferring data between applications, exporting and re-importing files between Toolbox workspaces, finding photographs already associated with observations, rebuilding figures, copying and pasting customer information, sorting evidence already organized during field capture, manually assembling a report from information already inside the system, or administering software.

### Governing UX principles — DECIDED

- The correct workflow should be the path of least resistance.
- Information already known by Toolbox should not be requested again.
- Do not expose implementation complexity to the investigator merely because it is convenient for the code.
- Common actions should be obvious without instruction. Advanced or unusual functions may exist without cluttering the normal workflow.
- Simple capture does not mean simplistic output.
- **Protect the canvas.** The primary working surface — a plan, a topo view, a diagnostic view, or a report page — takes priority over application chrome. Favor compact pills, collapsed or contextual toolbars, and controls that expand when needed and collapse when finished.
- Mobile success is not merely controls fitting on the screen. Enough of the working canvas must remain visible for the investigator to actually perform the work.
- Common controls must remain obvious. Compact must not mean buried or hard to find.

If using Toolbox requires substantially more thought or effort than doing the same field task manually, the design has failed.

---

## 2. Professional Judgment

Toolbox does not create the investigator's expertise. It removes friction around that expertise.

The professional advantage behind Toolbox comes from decades of foundation-repair, geotechnical, forensic, and field experience — from experienced people, professional judgment, relationships, reputation, and trust. Software amplifies those strengths; it does not replace them.

> **Toolbox exists to compress the time between field investigation and professional communication without compressing the professional judgment in between.**

A recurring principle behind Toolbox is **understanding before action**. Observation and interpretation are related but not the same thing. A floor-elevation map, a crack, a sticking door, a distress pin, or a photograph is evidence — it does not by itself establish cause, whether movement is active, whether repair is required, or what future performance will be.

Observation/data and interpretation must remain distinguishable:

- A floor-level survey and observational report is not automatically a geotechnical investigation.
- A measured pattern is not automatically a diagnosis.
- A potential cause is not automatically a repair recommendation.
- A practical field observation is not automatically a formal engineering conclusion.

Toolbox should make those distinctions easier to preserve. It should not erase them for convenience.

A useful conceptual progression is: **Capture → Review/Edit → Understand → Communicate.** AI and Diagnostics may assist with understanding and communication. Neither replaces professional judgment, and AI must not become the system of record or manufacture professional judgment on the investigator's behalf.

---

## 3. The Product Model

### DECIDED

The central object inside Toolbox is the **Customer File**. The working metaphor is a file cabinet: Toolbox is the cabinet, each customer/job is a file, and specialized workspaces operate inside the already-open Customer File.

The four principal workspaces are:

1. **Distress Survey**
2. **Floor Survey**
3. **Diagnostics**
4. **Report Builder**

The user opens the Customer File first. Every workspace entered from that Customer File already knows which customer/job it belongs to — the user never selects a workspace and then has to locate or recreate the customer inside it.

The long-term system should feel like **one professional instrument with four specialized workspaces**, not four unrelated applications connected by export buttons.

---

## 4. The Customer File Owns Shared Context

### DECIDED

Information that belongs to the customer/job is entered once and made available wherever it's needed. The Customer File owns shared information such as: property address; customer/homeowner name and contact information; billing information where needed; general job information; the plan(s)/survey surface(s); customer-level voice memos; interview information; and other genuinely shared job context.

Individual workspaces own information specific to their own work.

> **Information already known by Toolbox should not be requested again.**

If the Customer File is already open, a workspace should not ask which customer it belongs to. If a plan is already associated with the Customer File, the normal workflow should not ask the investigator to upload it again.

---

## 5. Multiple Named Surfaces — Distress Survey

### DECIDED

Distress Survey supports **multiple user-named surfaces within one continuous survey.**

Do not hard-code specific surface names such as "Basement" or "Main Level." A surface may be a Ground Floor, a Basement, a Second Floor, an Exterior, a Patio, a Roof Parapet, a Rear Addition, or any other user-defined area or plane.

Behavior:

- During setup, the first surface defaults to the name **"Floor Plan."**
- It may be renamed using a simple pencil/edit affordance.
- Additional surfaces may be added and named from the existing Floor Plan setup area.
- On the main Distress capture canvas, a compact active-surface pill (for example, "Ground Floor ▾") shows the current surface. Selecting another surface switches the canvas to that surface's plan and associated Distress information.
- The normal, common one-surface job remains almost identical in simplicity to today's single-plan workflow. Additional surfaces should appear only when actually needed.
- **Pin numbering is one continuous chronological sequence across the entire survey.** For example: Ground Floor pins 1–12, Basement 13–17, and returning to Ground Floor afterward, the next new pin is 18 — not a renumbered or regrouped sequence.
- Existing assigned pin numbers remain stable. Pins are never later renumbered or regrouped by surface.
- Surface identity must remain associated with each observation and propagate downstream through Diagnostics and Report Builder — a report or analysis must be able to show which surface an observation belongs to.

This section describes required product behavior only. It does not specify a persistence model, data shape, or migration mechanism — how surfaces, pins, and numbering are actually stored and implemented is an implementation decision, made separately from this Vision.

---

## 6. Floor Survey

### DECIDED

Floor Survey operates inside an open Customer File. It does not need a redundant "New Project" workflow for information Toolbox already knows — customer context, address, and project information are already known, and the plan/surface comes from the Customer File. A manual plan-upload back door may remain available for resilience and unusual cases.

**Survey Date** is required measurement/dataset metadata belonging to the Floor Survey dataset. It is not a generic job date — it identifies when a particular set of measurements was collected, and it must remain associated with that dataset and its resulting figures.

**Topo Boundary** is Floor-Survey-specific information. It is not the same thing as the shared Customer File plan/surface — it defines the area of a plan that a topo survey actually measures, and it belongs to Floor Survey.

Floor Survey's existing support for multiple topo areas on the same physical plan is valuable, proven, and should not be reinvented. This is a different concept from multiple named building surfaces, and the two must not be confused with each other.

### Multiple named surfaces / levels — DECIDED

Floor Survey supports multiple user-named surfaces/levels within the same Customer File. Each surface/level represents its own measured plane and owns its own Floor Survey dataset.

Examples include:

- Basement
- Ground Floor
- Second Floor
- other user-named surfaces where a separate floor-level survey is appropriate

A normal one-level survey remains simple.

The investigator may complete one level and then move to another level within the same Customer File. For example:

- Ground Floor → complete its floor-level survey
- Second Floor → complete a separate floor-level survey

These are separate measured datasets belonging to the same Customer File.

Do not confuse multiple building levels/surfaces with Floor Survey's existing multiple topo areas on the same physical plan. Those remain separate concepts.

This section describes required product behavior only. It does not specify the underlying persistence architecture — how levels and their datasets are actually stored and implemented is an implementation decision, made separately from this Vision.

---

## 7. Edit — Two Different Things Under One Name

Both Distress Survey and Floor Survey have an "Edit" concept. They are decided differently, and must not be confused with each other.

### 7a. Distress Edit — DECIDED

Distress post-field Edit operates on the **live source survey**, not a flattened export. Pins, descriptions, room/location information, photographs, and notes remain reviewable and editable as appropriate. Source corrections happen upstream, in Distress. Report Builder wording changes do not silently change these source observations. The normal internal workflow should not depend on exporting and re-importing files between Toolbox workspaces.

### 7b. Floor Survey "three-dots → Edit" — DECIDED

Keep the existing concept of three-dots → Edit in Floor Survey. This is **presentation editing, not measurement-data editing.**

It may change how a completed survey figure is presented: font sizes, high/low emphasis, visibility of points, decluttering, labels, and similar visual or display choices, so the investigator can produce a clean figure suitable for Report Builder.

It must not silently alter the underlying measured survey data. If the actual measurement/source data needs correction, the investigator returns to Floor Survey's own data-input/capture functionality to correct it there.

---

## 8. Normal Data Flow — No Internal Export/Import Choreography

### DECIDED

The normal Toolbox workflow does not require exporting information from one workspace and importing it into another. The Customer File provides shared context; the owning workspace preserves its authoritative source data; downstream workspaces read the appropriate information.

Conceptually: **Customer File → Field Capture → Source Review/Edit → Interpretation/Diagnostics → Report Builder.**

Corrections occur at the source — a wrong Distress pin is corrected in Distress; a wrong Floor Survey point is corrected in Floor Survey. The investigator should never have to wonder where information belongs, whether it was transferred, which copy is current, or which workspace now owns it.

---

## 9. Field Resilience and the Standalone Safety Net

### PROTECTED

A software problem must never cost the investigator the day's opportunity to collect field data.

The standalone field applications remain independent, known-working field fallbacks. They are explicitly named:

- **field-reporter-pro** (standalone Distress Survey)
- **floorplan-topo-maker** (standalone Floor Survey)

These repositories are **not modified as part of Toolbox.** They are reference implementations of proven field behavior and an intentional operational safety net — not merely historical artifacts.

Integrated copies of this capture behavior, and the plumbing that connects them to the Customer File, live inside Toolbox itself and **may evolve** as Toolbox develops. This is a different thing from the standalone repositories, and evolving the integrated copy does not license touching the standalone repositories.

Three paths:

- **Normal path:** Customer File → integrated Distress/Floor → capture → persistence → downstream workflow.
- **Field fallback:** if integrated Toolbox cannot reliably perform the field work, the investigator uses the appropriate standalone application and completes the investigation there instead.
- **Recovery path:** the standalone dataset is later imported into the correct Customer File and the normal workflow continues.

This recovery/import path is **permanent operational resilience, not temporary migration scaffolding.** It must keep working for as long as the standalone applications remain the field fallback — not just during Toolbox's early development.

---

## 10. Live, Cloud, and Offline; Access

### DECIDED

Toolbox should be **continuously deployed live** during development, so the product owner can inspect the real, current application on phone, iPad, and desktop at meaningful checkpoints. Live deployment does not mean every routine implementation detail requires product-owner approval before it ships.

Toolbox is intended to be cloud-backed and usable across multiple devices, but **cloud-backed must not mean cloud-dependent for field capture.** Loss of internet at the property must remove synchronization, not the ability to perform the investigation. Offline behavior must be tested continuously throughout development, not bolted on at the end. PWA / home-screen installation is part of the intended product from early on.

Initial access is simple: **two known internal users**, both with access to the Customer Files their work requires. Do not introduce SaaS-style roles, billing, invitations, or enterprise administration unless a real future need requires it. Authentication should not become the product.

---

## 11. Professionalism Should Be Visible in the Field

### DECIDED

Toolbox is not merely a back-office efficiency system. It should help the investigator communicate useful information while still at the property when appropriate — for example, after completing a Floor Survey, showing the resulting topographic representation to the property owner before leaving, when practical.

The technology should support the investigator's interaction with the building and the client. It should not compete for attention with either of them.

---

## 12. Report Builder

### DECIDED

Report Builder is fundamentally a **PowerPoint-like report workspace**, not a rigid report-generation form. "PowerPoint-like" describes the interaction philosophy — direct page composition and hands-on control — not a literal clone of Microsoft PowerPoint.

Toolbox should automatically assemble a strong standard report from information already in the Customer File and its workspaces. After that automatic assembly, **the investigator owns the pages.** The investigator can add, delete, duplicate, and reorder pages; add additional discussion; add unusual or custom information; include something like a blank floor plan when useful; and otherwise adapt the report to the particular job. The standard template is a starting point, not a cage.

Direct page composition and meaningful content manipulation are required. **Basic drawing/annotation capability is required in Report Builder** so the investigator can annotate report content without leaving Toolbox. The exact drawing toolbar and tools are **NOT YET DECIDED.** Drawing controls follow the same canvas-first principle as the rest of Toolbox: compact and collapsed when not needed, available when needed — not a giant, permanent, desktop-style ribbon that consumes the working canvas.

Automation assembles evidence. It does not replace investigator judgment.

### 12a. Build baseline — DECIDED

The **1515 Los Nietos** report is the primary initial Report Builder baseline. Toolbox should initially preserve and reproduce what already works about its professional structure, information hierarchy, figures, photo presentation, and overall appearance, before any substantial redesign.

This is a **build baseline, not an immutable permanent template.** It may evolve over time.

---

## 13. Diagnostics

### DECIDED DIRECTION

Diagnostics is a future technical workbench between source evidence and authorship/reporting. It should help an experienced investigator understand and communicate evidence. It should not become an automated professional-judgment engine.

**Report Builder comes before Diagnostics.** An operational Toolbox should be possible with Customer File → Distress/Floor → Report Builder before Diagnostics becomes a required part of the system. Diagnostics is not a mandatory gate for every report.

### NOT YET DECIDED

The exact Diagnostics analytical tools and methods are not yet decided. Do not promote a specific analytical method, screen, or existing V2 experiment into a V3 requirement merely because it was discussed or previously built.

---

## 14. Model-Agnostic AI Collaboration

### DECIDED DIRECTION

Toolbox should anticipate model-agnostic AI collaboration. The architecture must not make any single AI provider a permanent dependency.

Eventually, Report Builder should be able to provide an authorized AI collaborator with relevant Customer File context — without the investigator manually exporting, packaging, or uploading it first.

AI-generated or AI-edited language remains reviewable and editable by the investigator, and under the investigator's control. AI is not the system of record; source observations and measurements remain owned by the workspaces that created them.

This capability is **architecturally anticipated. It is not an early build milestone.**

---

## 15. Spatial Continuity and Report Figures

### DECIDED PRINCIPLE

Spatial registration should be preserved where it provides professional value, not imposed universally. For example, multiple topo datasets derived from the same physical floor plan should preserve enough common geometry, scale, and position that the building does not unnecessarily jump, resize, or recenter between related report sheets — supporting a flip-chart style comparison where appropriate.

Different information types do not all require identical registration. Photographs, narrative pages, unrelated diagnostic figures, and different physical surfaces may appropriately use different layouts.

### NOT YET DECIDED

The exact technical method for establishing real-world scale and registration is not settled. Do not freeze an implementation before the problem has been solved and tested.

---

## 16. Closeout and Long-Term Usefulness

### DECIDED PRINCIPLE

Live Toolbox optimizes for ease of work. Closeout optimizes for permanence. Completed professional work must remain useful even if the software that created it changes completely.

The final report is preserved as **PDF** — the durable professional closeout record. Useful source material should also be preserved where practical, in durable, ordinary, human-readable form (for example, photographs as JPEG; tabular or source data as CSV/JSON or another appropriate format at the time).

The goal is not to guarantee Toolbox's internal database can be perfectly resurrected decades later. The goal is to preserve the professional record, and enough underlying evidence, that the important work remains understandable and reconstructable.

> **Automatic future reconstruction is desirable. Manual reconstruction must remain possible.**

### NOT YET DECIDED

The exact archive packaging mechanism — ZIP structure, storage organization, year/month folders, naming convention, or other archival mechanics — is not yet decided.

---

## 17. What Toolbox Is Not

Toolbox is not: a generic SaaS product; a customer-facing CRM; a foundation-repair sales system; an automated diagnosis engine; a replacement for professional judgment; a reason to add administrative work; an employee-surveillance system; or an excuse to expose implementation complexity to the investigator.

Do not add enterprise complexity merely because enterprise software commonly contains it. The sophistication that matters belongs in field capture, investigation workflow, evidence integrity, spatial relationships, offline reliability, cross-device continuity, analysis, professional communication, and rapid report production — not in software administration.

If dropping a pin, taking a photograph, entering a description, or taking a measurement already documents that work, Toolbox generally should not require another administrative action merely to prove that it happened.

---

## 18. Proven Behavior and the Burden of Proof for Change

### PROTECTED

Toolbox is allowed to evolve. Plumbing and architecture may change substantially when better architecture requires it. Even capture may eventually change if a genuinely better method, or a genuinely required new capability, is identified and proven.

> **Proven field behavior is presumed correct** and carries a high burden of proof before it is changed.

It should not be changed merely because another implementation would be cleaner, another framework prefers a different pattern, consistency would be easier, an AI or developer would have designed it differently, or modernization makes another approach fashionable.

> **Preserve proven behavior, not inherited architecture.**

The behavior that is protected is the field-tested interaction — how capture actually works for the investigator. The architecture that produced it in any previous system is not itself protected, and does not need to be inherited.

High-risk changes affecting proven field behavior require design review before implementation. For any proposed change to proven field interaction, ask:

1. What actual problem does the existing behavior create?
2. What becomes better for the investigator?
3. Was changing the proven behavior actually necessary?
4. How will the replacement be proven before relying on it?

> **Diff is proof.** Claims that protected behavior was preserved must be checked against the actual code changes rather than accepted from an implementation summary.

---

## 19. Toolbox V3 vs. Toolbox V2

### DECIDED

Toolbox V3 is a **rebuild from the beginning** — not a bolt-on to V2, and not an evolution constrained by V2's existing architecture.

Toolbox V2 remains available as **evidence, reference, and a source of proven or reusable work** — valuable solved problems, useful data structures, proven field behavior, offline techniques, and prior experiments. It is not V3's product authority, and **V3 architecture must not be forced around V2's existing architecture.**

V3 may temporarily contain fewer features than V2 while each workflow earns its way into the new system, one deliberately built and proven vertical slice at a time.

Existing completed professional reports, and materials from related professional/business work, may provide context for the philosophy behind Toolbox. They are not automatically Toolbox feature specifications.

---

## 20. Build Order

### DECIDED

The full vision can be large. The current implementation task must be small.

> **Build and prove one vertical slice at a time.** At any point, the repository should have one current milestone. Do not work ahead merely because later functionality is already understood conceptually.

**Milestone 0 — tiny live foundation.** Durable project documentation and guardrails; a shared visual foundation; live Cloudflare deployment; PWA manifest/installability; the same deployed application accessible on phone, iPad, and desktop.

**Milestone 1 — Customer File.** Create/open a Customer File; shared customer/contact information; plan/surface ownership required by the first field workflow; persistence; close and reopen correctly. Build only what the first real field workflow actually requires.

**Milestone 2 — Distress Survey end-to-end.** Customer File → only necessary Distress-specific setup → multiple named surfaces (Section 5) → proven capture behavior → offline capability from the beginning.

**Milestone 3 — Distress Edit.** Live source review/edit; correct pins, descriptions, photo relationships, and room/location information; persist changes; close/reopen correctly; the permanent emergency standalone-import recovery path (Section 9).

**Milestone 4 — Shared/cloud Distress proof.** Cloud persistence/synchronization; cross-device access; a second authorized internal user sees the same Customer File; offline local capture; reconnect and synchronize safely; standalone Distress remains available as fallback throughout.

**Then Floor Survey**, integrated using the Customer File/cloud/offline architecture already proven through Distress — not reinvented.

**Then Report Builder** — an operational Toolbox should be possible with Customer File → Distress → Floor → Report Builder before Diagnostics exists.

**Then Diagnostics.**

Do not build infrastructure for a future workspace merely because it may someday need it. Build the smallest shared infrastructure the current vertical slice actually needs, while avoiding obvious dead ends.

---

## 21. Development Process

### DECIDED

The working roles are:

- **Product owner / field authority / final decision-maker:** Tim.
- **Project manager / architect / vision keeper / code reviewer:** ChatGPT.
- **Primary implementation engineer:** Claude Code.
- **Project consultant / technical-writing and UX sounding board:** Grok.
- **Common source of truth:** the GitHub repository.

These are practical working roles, not a statement that one AI model is inherently superior to another. The product owner remains the authority. Cross-checking is encouraged: any collaborator may challenge assumptions, identify contradictions or missing requirements, propose better methods, or point out risks. No model's idea automatically outranks another's.

Working rules:

- The product owner makes product decisions. Routine implementation details do not require product-owner approval.
- If ambiguity would materially affect workflow, data ownership, proven behavior, architecture, or the professional deliverable, **stop and ask for clarification rather than silently choosing.** Non-blocking questions should be batched for a meaningful review checkpoint when practical, rather than interrupting constantly.
- **Brainstorming is not implementation authorization.** A stated need is not an approved architecture.
- **One implementer modifies a given problem at a time.** Multiple AI collaborators may independently analyze a high-risk issue before implementation begins.
- Read the actual current source or diff before making a factual claim about current or protected behavior. Do not answer from memory of an earlier read.
- When a shared data field changes, identify and check its relevant downstream consumers as part of the same unit of work.
- When a recurring bug class is discovered, search the relevant codebase for structurally similar occurrences rather than patching only the one instance that was reported.
- Data acknowledged as saved must actually persist before navigation, reload, close, a connectivity change, or synchronization is allowed to silently discard it.

The development loop: **Decide → document → build a small slice → deploy live → review at a meaningful checkpoint → inspect the actual diff → accept or correct → move to the next slice.**

---

## 22. Vision Versus Implementation

### DECIDED

This document describes the product and the principles that protect it. It is not intended to specify every technical mechanism. Detailed implementation decisions belong in the appropriate milestone, decision record, technical specification, or code — not here.

Examples of things that should not automatically become permanent Vision requirements: exact database schema; exact persistence architecture for multiple named surfaces (for example, whether or how something like `project.plans[]` is implemented); exact Cloudflare storage service; exact synchronization algorithm; exact CSS implementation; exact authentication mechanism; exact Diagnostics mathematical method; exact screen/tab arrangement that has not been approved; or speculative future features.

This distinction is intentional. The Vision should be durable enough to survive major changes in implementation. Toolbox may look and work differently, on completely different technology, years from now, while still honoring this Vision.

---

## 23. Governing Tests

When considering a feature, workflow, abstraction, or implementation change, ask:

> Does this help the investigator look at the building, understand the building, communicate what they are seeing, or produce the deliverable — or is it just more software?

> Does this remove work, or does it remove thought?

> Does this require the investigator to provide information Toolbox already knows?

> Are we changing proven behavior because the investigator benefits, or because the implementation benefits?

> If the internet disappears at the property, can the investigation still be completed?

> If Toolbox changes completely in ten years, will the closed professional record still be understandable?

> Is this a stated need being treated as an approved architecture, or an architecture that was actually confirmed first?

The desired answers define the product: remove unnecessary work; preserve professional thought; preserve the evidence; keep fieldwork reliable; make the correct workflow obvious; make sophisticated professional work operationally simple. And above all:

> **Make Toolbox so easy to use you'd be a fool not to use it.**
