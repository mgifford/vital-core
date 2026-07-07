---
work_package_id: WP04
title: "Outcome nav regroup + redirect stubs"
dependencies:
- WP02
requirement_refs:
- FR-10
- FR-11
- FR-12
- C-01
- C-05
- NFR-01
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main (ia/progressive-disclosure). Merge back to main when WP is complete.
subtasks:
- T008
- T009
- T010
agent: claude
scope: report-html + aggregate + tests
owned_files:
- "src/report-html.js"
- "src/aggregate.js"
- "tests/e2e.mjs"
- "tests/unit/i18n-render.test.js"
- "tests/unit/report-html.test.js"
---

# WP04: Outcome nav regroup + redirect stubs

## Objective

Reorganize the per-domain subnav around outcome questions and rename pages to
outcome-aligned slugs — without breaking a single existing URL. This is the only
URL-affecting WP; the redirect stubs make it safe.

## Context

- `SUBNAV_ITEMS` (`report-html.js:263-275`) is the single source of nav truth;
  `subnav()` and `emptyCriterionPage()` depend on it; the "every page always
  written / no 404" invariant is enforced by `tests/e2e.mjs:437-460`.
- Deep links are `accessibility.html#VS-<hash>`, `readability.html#h-spelling`,
  `accessibility.html#h-bugs`. Fragment IDs are filename-independent
  (`heading()` literals; `bug-report.js:49-51` content hashes) — only the host
  filename is at risk.
- No redirect mechanism exists; mirror `languageRuntime`'s hash-preserving
  `location.replace(dest + location.hash)` (`report-html.js:164`).

## Subtasks

### T008: Outcome grouping + slug map

Regroup the subnav under **Accessible? · Fast? · Findable? · Trustworthy? ·
Sustainable?** headings; rename pages per the old→new map in `plan.md`. Keep
`page`/`active`/output-filename consistent (basename == emitted filename) so the
i18n switcher/runtime resolve. Preserve the empty-state/no-404 invariant.

### T009: Redirect-stub emitter

Emit at every **old** filename a minimal stub: `<link rel=canonical>` +
`<meta http-equiv=refresh content="0;url=<dest>">` +
`<script>location.replace(dest + location.hash)</script>`. Write a stub for the
default page and for every `-<loc>` sibling, wired into the
`aggregate.js:312-346` write loop (respecting the latest-week-only policy for
non-default languages).

### T010: Update tests

Update `tests/e2e.mjs` (`SUBPAGES` array, identical-nav assertion, href checks)
and `tests/unit/i18n-render.test.js` hrefs to the new slugs. Add a stub-emission
unit test: an old URL routes to the correct dest and the `#fragment` is
preserved.

## Validation

`npm run test:unit` and `npm run test:e2e` green; `npm run i18n:check` clean;
manual: open an old-filename URL with a `#VS-…` fragment and confirm it lands on
the renamed page at the correct anchor, in the default and a non-default locale.
