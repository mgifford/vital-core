---
work_package_id: WP02
title: "Viewer exclusion control on the accessibility page"
dependencies:
- WP01
requirement_refs:
- FR-01
- FR-02
- FR-03
- FR-04
- FR-05
- C-01
- C-02
- C-03
- C-04
- C-07
- C-08
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main (report/url-exclusion). Merge back to main when WP is complete.
subtasks:
- T002
- T003
- T004
agent: claude
scope: report-html UI + client script
owned_files:
- "src/report-html.js"
- "tests/unit/report-html.test.js"
---

# WP02: Viewer exclusion control on the accessibility page

## Objective

Add the viewer-editable exclusion box to the canonical findings page and make it
actually filter the view in the browser, as pure progressive enhancement.

## Context

- Findings render in full exactly once, on the accessibility page
  (`renderAccessibilityPage`, `report-html.js:3001`; findings via
  `bugReportsSection`, `:1503`). Filter the display here; do not re-render
  findings elsewhere (C-03).
- Model the box on `.triage-io` (`report-html.js:1180`, `:1612`) and the
  localStorage/init conventions of `triageScript()` and `themeScript()`.
- Matching in the browser must mirror WP01 (substring or `/regex/`,
  case-insensitive substring, invalid-regex → literal). It is a **separate**
  browser-safe copy (no Node imports).
- The config baseline is already applied server-side via `excludePatterns` →
  `filterBugsByExclusion`; the viewer list is **additive** on top (FR-05, D-3).
- i18n: visible strings via `t()`; inject script message templates per-locale
  with `JSON.stringify(t('…'))` (established pattern) (C-08).

## Subtasks

### T002: The control markup (`exclusionBox(target)` helper)

A collapsed `<details class="triage-io">`-style box: a `<textarea>` for patterns
(one per line, `#` comments allowed), **Apply** and **Clear** buttons, a
`role="status"` line, and a hidden banner slot. Carries `data-domain-key` and the
localized script message templates. `hidden` by default; only revealed by the PE
script. Emit on the accessibility page under the findings intro.

### T003: Client filter script (`exclusionScript()`)

A gated PE script that: reads `localStorage['vital-exclude:<key>']`; compiles the
patterns; for each finding block, hides pages/instances whose URL matches, hides
the whole block when nothing remains, and updates per-finding, per-severity and
"showing N of M" counts; renders the banner (source = your list, plus the config
baseline note) with a hidden count and a **view all** reset. **Apply** re-reads
the textarea + persists; **Clear** empties. No stored list and empty textarea ⇒
no-op. Reveal the box (`hidden` off) only when the script runs (C-01). Do **not**
recompute the headline score; label the filtered view (C-02).

### T004: Render tests

`tests/unit/report-html.test.js`: the box + textarea + Apply/Clear emit on the
accessibility page; the script is present and references `vital-exclude:`; with
JS off the full findings list is in the server HTML (nothing pre-hidden by the
viewer layer); severity keys remain `critical/serious/moderate/minor` (C-07).

## Validation

`npm run test:unit` + `npm run i18n:check` green. Manual: set `/medicare/` and
`/\.aspx$/i`, confirm findings/counts filter and persist across reload; disable
JS and confirm the full report renders with the box hidden.
