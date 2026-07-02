---
work_package_id: WP02
title: "Template vs content source heuristic"
dependencies: []
requirement_refs:
- FR-03
- FR-04
- FR-05
- C-01
- NFR-01
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main. Merge back to main when WP is complete.
subtasks:
- T004
- T005
- T006
agent: claude
scope: codebase-wide
owned_files:
- "config/targets.yml"
- "src/lib/bug-report.js"
- "src/report-html.js"
- "tests/unit/source-heuristic.test.js"
---

# WP02: Template vs content source heuristic

## Objective

Add a `likely_source` field to each finding to signal whether an issue is
probably in a shared template (high page count) or in one-off content (low
page count). Render it as a badge on the collapsed finding header.

## Context

- `src/lib/bug-report.js` constructs each bug object — add `likely_source`
  here so it flows through to the renderer unchanged.
- The `pages_affected` value is already on the bug object.
- `src/report-html.js` renders the collapsed `<details>` header for each
  finding — add the badge there.
- The threshold is a heuristic, not a guarantee — label the badge clearly
  ("Likely template" / "Likely content") to avoid overstating certainty.
- Do not change the committed `data/` schema — `likely_source` is computed
  at render time from `pages_affected`.

## Subtasks

### T004: Add threshold to targets.yml

Add `reporting.template_page_threshold` to the `defaults` block in
`config/targets.yml` with a default of `10`. Add a comment explaining the
heuristic. Per-target override is allowed.

### T005: Compute likely_source in bug-report.js

In `src/lib/bug-report.js`, after the bug object is constructed, set:
- `likely_source = "template"` if `pages_affected >= template_page_threshold`
- `likely_source = "content"` if `pages_affected <= 2`
- `likely_source = "unknown"` otherwise

`template_page_threshold` must come from the site config passed into the
function (default 10 if absent). The threshold must not be hard-coded.

### T006: Badge in report + unit test

In `src/report-html.js`, add a small inline badge to the collapsed finding
header when `likely_source` is `"template"` or `"content"`. Use class names
`source-badge source-template` / `source-badge source-content` so CSS can
style them without JS.

Write `tests/unit/source-heuristic.test.js` testing boundary conditions:
- pages_affected = 1 → content
- pages_affected = 2 → content
- pages_affected = 3 → unknown
- pages_affected = 9 → unknown (with default threshold 10)
- pages_affected = 10 → template
- pages_affected = 11 → template

## Validation

Run `npm run test:unit` — all tests must pass.
