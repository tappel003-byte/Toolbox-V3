# Repository Protection

This is the integrated Toolbox copy of Floor Survey. It is also the reference implementation
of proven field behavior.

**Changes are allowed, case by case, and must be named and approved first.**

The ecosystem evolves and this tree evolves with it. What is protected is proven field
behavior, not the files.

Before changing anything an investigator would notice in the capture app — a gesture, a
default, a visible size, a control's placement, how data is written — name the specific
change and get Tim's approval. Record approved changes in `DECISIONS.md`.

Plumbing that leaves field behavior identical does not need approval: an optional prop
defaulting to current behavior, a shared function extracted, an existing component hosted
somewhere new. "Identical" is a claim — show the diff, don't assert it.

The standalone repositories `field-reporter-pro` and `floorplan-topo-maker` remain untouched.

**Preserve proven behavior. This repository is the reference.**

<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
