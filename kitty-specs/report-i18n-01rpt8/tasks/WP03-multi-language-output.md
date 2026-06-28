---
work_package_id: WP03
title: "Multi-language output + language switcher"
dependencies:
- WP02
requirement_refs:
- FR-06
- FR-08
- C-05
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main. Merge back to main when WP is complete.
subtasks:
- T007
- T008
agent: claude
scope: codebase-wide
owned_files:
- "src/report-html.js"
- "src/aggregate.js"
- "tests/unit/i18n-render.test.js"
---

# WP03: Multi-language output + language switcher

## Objective

Render each report in every configured language and cross-link the languages with
a no-JS header switcher.

## Context

- The default language keeps the canonical (unsuffixed) paths; others get a
  `-<loc>` suffix. Page depth is unchanged, so `base` relative-path math is safe.
- `aggregate.js` renders locale-independent artifacts (CSVs, side JSON) once, then
  loops the HTML renders per language.

## Subtasks

### T007: Suffixing + switcher

`setReportLanguages(languages, defaultLocale)` + `localeSuffix()` drive sibling
filenames; `subnav` and intra-report nav links (header brand, breadcrumb overview
link) carry the active suffix; `languageSwitcher(page)` renders a pure-link `<nav>`
(endonyms + `hreflang`), nothing for a single language. `layout()` gains a `page`
basename; every render entry point passes it. Add minimal `.lang-switch` CSS.

### T008: aggregate per-locale loop + tests

`aggregate.js`: per-domain pages loop over `target.languages`; the dashboard and
url-lookup loop over the global languages; `setLocale` resets to default after
each loop. Add `tests/unit/i18n-render.test.js` (suffixing, switcher, no-JS,
single- vs multi-language).

## Validation

`npm run test:unit` green; an `[en, fr]` build produces correct `-fr` siblings and
a working switcher.
