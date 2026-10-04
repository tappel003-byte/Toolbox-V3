# Repository Protection

This is the integrated Toolbox copy of Distress Survey. It is also the reference
implementation of proven field behavior — its drawing tools, pin numbering, and plan
annotation are the pattern other Toolbox workspaces are matched against.

**Changes are allowed, case by case, and must be named and approved first.**

The ecosystem evolves and this tree evolves with it. What is protected is proven field
behavior, not the files.

Before changing anything an investigator would notice in the capture app — a gesture, a
default, a visible size, a control's placement, how data is written — name the specific
change and get Tim's approval. Record approved changes in `DECISIONS.md`.

Plumbing that leaves field behavior identical does not need approval: an optional prop
defaulting to current behavior, a shared function extracted, an existing component hosted
somewhere new. "Identical" is a claim — show the diff, don't assert it.

Two things carry an especially high burden, because other work is measured against them:

- **Distress photograph / pin numbering** must preserve the exact proven recomputation
  behavior across all canvases and levels. Never simplify it into permanent per-pin or
  per-canvas numbering.
- **The drawing toolbar** — tool set, order, the five colours and three weights — is the
  reference other workspaces copy. Changing a colour or a weight here changes what a
  finished report looks like.

The standalone repositories `field-reporter-pro` and `floorplan-topo-maker` remain untouched.

**Preserve proven behavior. This repository is the reference.**
