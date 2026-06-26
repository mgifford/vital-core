---
work_package_id: WP01
title: "Configurable score display"
dependencies: []
requirement_refs:
- FR-01
- FR-02
- C-04
- NFR-01
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main. Merge back to main when WP is complete.
subtasks:
- T001
- T002
- T003
agent: claude
scope: codebase-wide
owned_files:
- "config/targets.yml"
- "src/aggregate.js"
- "src/report-html.js"
- "tests/unit/score-display.test.js"
---

# WP01: Configurable score display

## Objective

Let site owners choose how (or whether) a score appears in their report by
adding `display.score_format` to `targets.yml`. The score algorithm in
`src/lib/score.js` must not change.

## Context

- Score computation lives in `src/lib/score.js` — do not touch it.
- `src/aggregate.js` reads `targets.yml` and passes a config object to the
  rendering functions in `src/report-html.js`.
- The score section in the report is rendered by `src/report-html.js` —
  find the block that emits the letter grade / percentage and make it
  conditional.
- Existing behaviour (no key set) must equal `both` (letter grade + percent).

## Subtasks

### T001: Extend targets.yml schema

Add `display.score_format` to the `defaults` block in `config/targets.yml`
with a comment listing allowed values (`letter`, `percent`, `both`, `none`).
Set the default to `both` so existing behaviour is unchanged.
Add a commented-out example under at least one target entry showing a
per-target override.

### T002: Thread config into render call

In `src/aggregate.js`, read `display.score_format` from the merged config and
pass it to whatever function in `src/report-html.js` generates the score
section. The value should default to `'both'` if absent.

### T003: Conditional score rendering + unit test

In `src/report-html.js`, make the score section conditional on the config value:
- `letter` — render letter grade only (A/B/C/D/F).
- `percent` — render numeric score (e.g. "78%") only.
- `both` — render both (current behaviour).
- `none` — omit the score section entirely.

Write `tests/unit/score-display.test.js` proving all four variants render
the expected HTML (or no HTML) for a synthetic config + score object.

## Validation

Run `npm run test:unit` — all tests must pass.
