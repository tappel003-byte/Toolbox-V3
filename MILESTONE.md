# Milestone 2 — Finish the Customer File

## Purpose

Complete the Customer File: contact information plus plan(s)/canvas(es), then the Customer File home that exposes the four applications.

## Status

**Current milestone.**

## Controlling model (KISS)

Contact information + plan(s)/canvas(es) = Customer File.

Applications pull what they need from that Customer File.

If a proposed product or architecture change cannot be explained clearly in 2–3 sentences, stop and simplify it before implementation.

## In scope

- Customer/contact/job fields (existing)
- Plan image(s), level names, rooms, automatic room recognition, manual verify/correct
- Front-door / orientation where already intended
- Multi-level plans (each level may have its own plan image); one-level jobs stay simple
- Customer File home with independent entry to Distress, Floor Survey, Diagnostics, Report Builder
- Edit Customer File (contact + plans) and return to home
- Correct authority docs that incorrectly called Plan Setup a standalone gatekeeper application

## Out of scope

- Distress capture integration or redesign
- Floor Survey internals
- Diagnostics / Report Builder implementation
- Voice memos, quick capture, emergency import
- Unusual non-level planes (Exterior, Patio, Roof Parapet, Rear Addition) — NOT YET DECIDED

## Acceptance

- No fifth “Plan Setup” application in the product UI
- Plans are edited as part of the Customer File
- Automatic room recognition runs as the normal assistance path; manual tools remain for verify/correct
- Home shows four independent applications (stubs OK if not yet connected)
- Obvious in-app navigation (not browser-back primary)
- Phone / iPad / desktop usable; reload and offline shell still work
