---
work_package_id: WP05
title: "Docs"
dependencies:
- WP02
- WP03
- WP04
requirement_refs:
- FR-13
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main (ia/progressive-disclosure). Merge back to main when WP is complete.
subtasks:
- T011
agent: claude
scope: docs
owned_files:
- "CLAUDE.md"
- "README.md"
---

# WP05: Docs

## Objective

Capture the new information architecture so future work respects it.

## Subtasks

### T011: CLAUDE.md IA section + README note

Add an **Information Architecture** section to `CLAUDE.md`: the three layers
(landing / next-actions / evidence), the outcome-question nav grouping, the
old→new slug map plus the hard rule that renamed pages must keep a hash-preserving
redirect stub at the old filename, and the progress artifacts (deltas everywhere,
fixed-this-week, burndown, triage completion, streaks; one canonical location per
finding). Add a short note to `README.md` describing the landing-page/outcome
structure.

## Validation

`npm run check:spec-kitty` green; `npm run test:unit` unaffected; docs match the
shipped behaviour.
