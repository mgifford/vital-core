---
work_package_id: WP02
title: "Wrap high-traffic report chrome"
dependencies:
- WP01
requirement_refs:
- FR-03
- FR-04
- FR-07
- C-01
- C-02
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
- "src/report-html.js"
---

# WP02: Wrap high-traffic report chrome

## Objective

Replace hardcoded English with `t()` across the shared chrome and high-traffic
pages, keeping the English output semantically identical.

## Context

- Module-level string tables (`SUBNAV_ITEMS`, severity labels, `RESOURCE_LABELS`,
  `LH_CATEGORY_LABELS`, triage `LABELS`) must be translated at *render* time
  (`t(label)`), not at module load.
- `<html lang="en">` in `layout()` becomes `t()`/`getLocale()`-driven.
- Severity: `data-severity`/internal keys stay `critical/serious/moderate/minor`;
  only the visible badge label localizes.

## Subtasks

### T004: Shared chrome + dynamic lang

`layout()` (`<html lang>`, skip link, brand, breadcrumb, footer), `subnav`,
`themeToggle` (incl. its inline aria-label script), `sortableTable`/chart
captions and aria-labels.

### T005: Flagship pages

Accessibility page (bug blocks, filter bar, severity/WCAG/triage labels),
per-domain Overview, dashboard, and the Overview sections (coverage, resources,
fix-first, standards, consensus, Lighthouse). Page H1s, breadcrumbs, empty states.

### T006: Inline scripts → translated templates

Convert `BUG_FILTER_SCRIPT`/`TRIAGE_SCRIPT` to functions that receive
already-translated message templates via `JSON.stringify(t('…'))`; the client
substitutes `@token` counts. Route prose counts through `nf()`.

## Validation

`npm run test:unit` green; rendering an English page is unchanged vs `main`.
