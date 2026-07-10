---
work_package_id: WP02
title: "Browser fetch → filter → download (filtered CSV/JSON)"
dependencies: [WP01]
requirement_refs: [FR-02, FR-03, FR-04, C-01, C-02, C-03, C-04, NFR-02]
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main. Merge back to main when WP is complete.
subtasks: [T002, T003]
agent: claude
owned_files:
- "src/report-html.js"
- "tests/unit/report-html.test.js"
---

# WP02: Browser fetch → filter → download

## Objective
Let a viewer download findings scoped to their exclusion list, matching the
on-screen view, without a server rebuild.

## Context
- `bugs.json` is already linked in `bugReportsSection` via `reporting.bugsJson`
  ("JSON (full archive)"). Put that href on the box as `data-bugs-json` so the
  script can fetch it. Its findings have `affected_pages` (<=25) + frequency.
- Reuse the on-screen filter semantics: mirror `filterBugsByExclusion`
  (`src/report-html.js:44`) in the browser — a finding is dropped only when
  `affected_pages.length >= frequency.pages_affected` and every page matches;
  else trim matching `affected_pages` and scale `pages_affected`/`instances`.
- Mirror `bugsCsvTable` (WP01) header/row order + `toCsv` escaping in the browser
  to build the filtered CSV.

## Subtasks
### T002: Controls
Add **Download filtered CSV** / **Download filtered JSON** buttons to
`exclusionBox` (hidden). Reveal them from `apply()` only when patterns are
active; hide when cleared. Add a one-line note that filtered counts follow the
on-screen (<=25-sample) view.

### T003: Fetch + filter + serialize + download
On click: `fetch(dataBugsJson)` → parse → `filterBugs(findings, patterns)` (the
browser mirror) → for JSON, download the archive with the filtered findings; for
CSV, build via the browser mirror of `bugsCsvTable` + escaping. Filenames:
`<domain>_<date>_bugs.filtered.{csv,json}`. Fail gracefully (status line) if the
fetch fails or bugs.json is absent.

## Validation
`npm run test:unit` + `i18n:check` green; render test asserts the controls +
`data-bugs-json`. Verify in Chromium over HTTP: with `/medicare/` active, the
filtered CSV/JSON omit the all-medicare finding and match the on-screen counts.
