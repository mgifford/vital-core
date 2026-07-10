---
work_package_id: WP04
title: "Export / import / share of the exclusion set"
dependencies:
- WP02
requirement_refs:
- FR-06
- C-04
- C-08
- NFR-02
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main (report/url-exclusion). Merge back to main when WP is complete.
subtasks:
- T007
- T008
agent: claude
scope: report-html IO script
owned_files:
- "src/report-html.js"
- "tests/unit/report-html.test.js"
---

# WP04: Export / import / share of the exclusion set

## Objective

Make a viewer's exclusion list portable — exportable, importable, and copyable —
so a team can agree on one scope, reusing the triage IO scaffold.

## Context

- The triage IO box + script (`report-html.js:1180` markup, `:1687` handlers)
  already implement Export (.json) / Import (.json) / Copy share payload against
  localStorage with an `aria-live` status. Mirror it; do not invent a new pattern
  (C-04, NFR-02).
- Triage export gathers `localStorage['vital-triage:*']` and downloads a Blob
  (`report-html.js:1704`); the exclusion list is a single per-domain key, so the
  payload is simpler.

## Subtasks

### T007: IO controls + handlers

Add **Export (.json)**, **Import (.json)**, **Copy share payload** to the
exclusion box. Payload:
`{ "type": "vital-exclude", "domain": "<domain-key>", "patterns": [ ... ] }`.
Export/Copy stamp the current domain key; Import validates `type`, warns on a
domain-key mismatch but allows it, replaces (or merges — pick one and note it in
the status line) the stored list, persists, and re-applies via the WP02 filter
without a reload. Status via the shared `aria-live` line.

### T008: Tests

`tests/unit/report-html.test.js`: the three IO controls emit; the script
references `vital-exclude:` and the `vital-exclude` payload `type`. Keep i18n
strings via `t()`.

## Validation

`npm run test:unit` + `npm run i18n:check` green. Manual: Export → Clear →
Import round-trips the list and re-applies it; Copy share payload puts valid JSON
on the clipboard.
