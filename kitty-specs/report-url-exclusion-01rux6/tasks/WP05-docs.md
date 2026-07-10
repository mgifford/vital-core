---
work_package_id: WP05
title: "Docs"
dependencies:
- WP02
- WP03
- WP04
requirement_refs:
- FR-08
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main (report/url-exclusion). Merge back to main when WP is complete.
subtasks:
- T009
agent: claude
scope: docs
owned_files:
- "CLAUDE.md"
- "README.md"
- "FEATURES.md"
- "config/targets.yml"
---

# WP05: Docs

## Objective

Document the viewer control and, crucially, how it differs from the two existing
config-side exclusion layers so the three don't get conflated.

## Context

The three layers (state them explicitly):

1. **Scan** — `url_exclude` / `url_exclude_file` (+ `/regex/`), targets.yml:
   changes what is **crawled/scanned** (#132 / PR #208).
2. **Report render** — `url_exclude_patterns`, targets.yml: build-time filter of
   the **rendered** report for everyone.
3. **Viewer** — this mission: a per-viewer, browser-stored list that scopes the
   **display** at runtime; every URL is still scanned.

## Subtasks

### T009: Update the four docs

- `CLAUDE.md`: a short "Viewer URL exclusion" note under the report/IA docs with
  the three-layer table and the `localStorage['vital-exclude:<domain-key>']` key.
- `README.md` / `FEATURES.md`: a bullet on the viewer control (persists, filters
  the view, export/import/share; scanning unaffected).
- `config/targets.yml`: a one-line cross-reference near the `url_exclude_patterns`
  comment pointing to the viewer control (and clarifying render-time vs
  runtime-per-viewer).

## Validation

`npm run test:unit`, `npm run i18n:check`, `npm run check:spec-kitty` green.
Before opening the PR, run `spec-kitty upgrade --dry-run` to catch drift and add a
✓ next to each satisfied acceptance criterion in `spec.md`.
