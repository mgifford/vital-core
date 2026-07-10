# Implementation Plan: Filtered report exports (Phase 2)

**Status**: DRAFT
**Date**: 2026-07-10
**Spec**: [spec.md](spec.md)

## Summary

Three work packages let a viewer download findings scoped to their exclusion
list, by fetching the pre-built `bugs.json` on demand, filtering it in the
browser with the same logic as the on-screen view, and offering filtered
`.json` + `.csv` `Blob` downloads. The heavy lifting already exists:
`filterBugsByExclusion` (Phase 1, `src/report-html.js`) is the filter; the only
new server work is factoring the CSV column schema into a pure function so the
browser serializer can mirror it exactly.

## Technical Context

**Primary files**: `src/lib/csv.js` (`writeBugsCsv` → factor `bugsCsvTable`),
`src/report-html.js` (`exclusionBox` controls + `exclusionFilterScript`
fetch/filter/serialize/download), `tests/unit/csv.test.js` (new/extended),
`tests/unit/report-html.test.js`.
**Reuse**: `filterBugsByExclusion` / `compileExclusionPattern` (Phase 1),
`toCsv` (`src/lib/csv.js`), the triage/exclusion IO script + `.triage-btn` CSS,
the `reporting.bugsJson` download href already emitted in `bugReportsSection`.
**Constraints**: PE; fetch only on click; no data/API change; no new deps.

## Work Packages

### WP01 — Factor `bugsCsvTable(bugs)` (single source of truth for the CSV schema)

Extract the header list + row mapping from `writeBugsCsv` into a pure, exported
`bugsCsvTable(bugs)` → `{ headers, rows }`. `writeBugsCsv` becomes
`toCsv(...bugsCsvTable(bugs))` + write. Byte-identical output. Unit-tested.
**Req refs**: FR-01, C-05, NFR-01 · **Deps**: none ·
**Owned files**: `src/lib/csv.js`, `tests/unit/csv.test.js`

### WP02 — Browser fetch → filter → download

In `exclusionBox`, add **Download filtered CSV** / **Download filtered JSON**
controls (hidden unless a list is active). In `exclusionFilterScript`: on click,
`fetch()` the `bugs.json` href (add it as a `data-bugs-json` attribute on the
box, read from the existing download link), parse, run a browser filter that
mirrors `filterBugsByExclusion` (compile → drop-if-complete-and-all-excluded →
else trim+scale), then build the CSV with a browser mirror of `bugsCsvTable`'s
headers/rows + CSV escaping, and download both `Blob`s. Reveal the controls from
`apply()` only when patterns are active. Label the ≤25-sample semantics.
**Req refs**: FR-02, FR-03, FR-04, C-01, C-02, C-03, C-04, NFR-02 · **Deps**: WP01 ·
**Owned files**: `src/report-html.js`, `tests/unit/report-html.test.js`

### WP03 — Docs

Extend the CLAUDE.md "URL exclusion (three layers)" note and FEATURES.md to say
the viewer layer can export a filtered copy, following on-screen (≤25-sample)
semantics.
**Req refs**: FR-05 · **Deps**: WP02 · **Owned files**: `CLAUDE.md`, `FEATURES.md`

## Validation Plan

- `npm run test:unit` — `bugsCsvTable` parity + existing filter tests.
- Browser: with `/medicare/` active, click Download filtered CSV/JSON; assert the
  medicare finding is absent and counts match the on-screen view.
- `npm run i18n:check`, `npm run check:spec-kitty` green.

## Rollback

Each WP a focused commit. WP01 is a behaviour-preserving refactor; WP02 is
additive PE. Revert to roll back; no URLs, data, or API affected.
