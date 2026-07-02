---
work_package_id: WP06
title: "Runtime language selection (?lang / localStorage)"
dependencies:
- WP03
requirement_refs:
- FR-09
- FR-10
- FR-11
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main. Merge back to main when WP is complete.
subtasks:
- T012
- T013
agent: claude
scope: codebase-wide
owned_files:
- "src/report-html.js"
- "tests/unit/i18n-render.test.js"
- "CLAUDE.md"
---

# WP06: Runtime language selection (?lang / localStorage)

## Objective

Let a reader's language be set by URL or remembered locally, gated entirely on
config — without a server.

## Context

- Pages are static per-language files, so "setting" the language = navigating to
  the sibling. Mirror the existing theme pre-paint script in `layout()`'s `<head>`.
- Decided behaviour: a stored preference redirects only from the **default**
  (canonical) pages; `?lang=` works from any page and persists; an explicitly
  -suffixed URL is never redirected away from.

## Subtasks

### T012: languageRuntime()

Emit (only when `REPORT_LANGUAGES.length > 1`): `<link rel="alternate" hreflang>`
alternates (+ `x-default`) and a pre-paint script that reads `?lang=` →
`localStorage['vital-lang']`, redirects to the sibling (`location.replace` +
preserved hash), and persists switcher clicks. Use JS identifiers that don't clash
with the theme script's `var t`.

### T013: Gating tests + docs

Extend `tests/unit/i18n-render.test.js`: single-language build emits no redirect
script / no `hreflang` / no switcher; multi-language emits the script with the
configured langs/default/page and the alternates. Add a runtime-selection
paragraph to the `CLAUDE.md` i18n section.

## Validation

`npm run test:unit` green; manual: `?lang=fr` lands on `-fr`, reload stays fr,
explicit `-fr` URL is not redirected for an English-preferring reader.
