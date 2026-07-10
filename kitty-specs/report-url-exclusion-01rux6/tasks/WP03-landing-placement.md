---
work_package_id: WP03
title: "Landing-page placement + cross-page shared state"
dependencies:
- WP02
requirement_refs:
- FR-01
- FR-03
- FR-04
- FR-05
- C-01
- C-02
- C-04
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main (report/url-exclusion). Merge back to main when WP is complete.
subtasks:
- T005
- T006
agent: claude
scope: report-html landing page
owned_files:
- "src/report-html.js"
- "tests/unit/report-html.test.js"
---

# WP03: Landing-page placement + cross-page shared state

## Objective

Surface the same exclusion control on the domain landing page, in the spot the
issue asked for, sharing one stored list with the accessibility page.

## Context

- The site-inventory meta line is at `renderDomainReport` (`report-html.js:2939`,
  the "Over the whole history of this site…" paragraph). The box goes **directly
  under** it (FR-01).
- Reuse the `exclusionBox(target)` + `exclusionScript()` helpers from WP02 —
  factor them so both pages call the same code (no divergence). Same
  `localStorage['vital-exclude:<domain-key>']` key ⇒ a list set on either page
  applies on both (FR-03).
- On the landing page, apply the filter to the counts derivable client-side
  (inventory/deltas as feasible) and show the banner + hidden count. The headline
  score/grade stays whole-site and is labelled as a filtered view (C-02) — do not
  recompute it.

## Subtasks

### T005: Emit the shared box under the meta line

Insert `exclusionBox(target)` immediately after the inventory `<p class="meta">`
in `renderDomainReport`, and include `exclusionScript()` once. Ensure the helper
is parameterized by page so counts it touches are the ones present on the landing
page.

### T006: Cross-page + tests

Confirm shared-state behaviour and add render tests: the box emits under the
inventory line on the landing page; the same `vital-exclude:<key>` key is used;
the headline score markup carries the filtered-view label; JS-off renders the
full landing page with the box hidden.

## Validation

`npm run test:unit` + `npm run i18n:check` green. Manual: set a list on the
landing page, navigate to the accessibility page, confirm it is already applied
(and vice-versa); JS-off shows the full landing page.
