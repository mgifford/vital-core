# Spec: Filtered report exports (viewer exclusion, Phase 2)

**Status**: IMPLEMENTED (WP01–WP03) — pending `spec-kitty accept`
**Issue**: [#209](https://github.com/mgifford/vital-core/issues/209) (Phase 2)
**Builds on**: `report-url-exclusion-01rux6` (WP01–WP05, shipped) — the viewer
URL-exclusion control.

> Hand-authored spec-kitty mission (CLI unavailable in this environment).

## Goal

Make the **downloadable exports honour the viewer's exclusion list**, closing the
one gap the Phase-1 mission deferred. Today a report reader can hide out-of-scope
findings on screen (issue #209), but the CSV/JSON download links still point at
the pre-built, unfiltered static files. This mission lets the reader download a
copy of the findings **scoped to their exclusion list**, so the spreadsheet they
hand to a team matches the on-screen view.

Approach: the pre-built `bugs.json` (the "full archive" already linked on the
Accessibility page) is fetched **on demand** in the browser, filtered against the
viewer's stored patterns with the **same logic as the on-screen view**, and
offered back as a filtered `bugs.json` and a filtered `bugs.csv` via `Blob`
downloads. No server rebuild, no new data files, and nothing extra on page load.

## Key constraint & the semantics it forces

Bug objects cap `affected_pages` at 25 (`src/lib/bug-report.js:113`); the complete
per-finding list lives only in per-rule CSVs. So neither `bugs.json` nor
`bugs.csv` carries every URL, and shipping them all would blow the sustainability
budget. Therefore the filtered export uses the **same conservative rule as the
on-screen filter** (WP02 of Phase 1): a finding is dropped only when its list is
**complete** (`affected_pages.length >= pages_affected`) and every page matches;
otherwise it is kept (with matching sampled pages removed and counts adjusted
proportionally, exactly like `filterBugsByExclusion`). The result is an export
**consistent with what the viewer sees**, not a re-derivation from complete data.
This is called out in the UI so counts for very large findings aren't misread.

## Decisions (recommended defaults — adjustable)

- **D-1 — filter `bugs.json` client-side (fetch-on-demand), not per-finding CSVs.**
  Reuses one file already on the page; avoids N network requests. *(Alt: fetch
  each finding's `affected_pages_csv` for complete-data precision — rejected for
  sustainability/complexity.)*
- **D-2 — offer filtered JSON and filtered CSV.** CSV is what teams paste into
  spreadsheets. *(Alt: JSON only.)*
- **D-3 — controls appear only when an exclusion list is active.** With no list,
  the existing unfiltered download links are correct and unchanged.

## Requirements

| ID | Type | Requirement |
|---|---|---|
| FR-01 | Functional | `writeBugsCsv` is refactored to build its rows via a pure, exported `bugsCsvTable(bugs)` → `{ headers, rows }`, so the column schema has one source of truth that the browser CSV serializer mirrors. Behaviour of the written file is unchanged. |
| FR-02 | Functional | When the viewer has an active exclusion list, the exclusion box shows **Download filtered CSV** and **Download filtered JSON** controls. They fetch the page's `bugs.json` (href already present in the download line), apply the exclusion filter, and download `Blob`s. Absent/empty list → controls hidden (existing links suffice). |
| FR-03 | Functional | The browser filter mirrors `filterBugsByExclusion` exactly (compile substring/`/regex/`; drop a finding only when complete-and-all-excluded; else trim sampled `affected_pages` and scale `pages_affected`/`instances`), so the download matches the on-screen view. |
| FR-04 | Functional | The filtered CSV is generated in the browser using the same header order and CSV-escaping as `bugsCsvTable` + `toCsv`; the filtered JSON preserves the archive shape with only the findings array filtered. Download filenames carry the domain, date, and a `filtered` marker. |
| FR-05 | Functional | Docs: the CLAUDE.md "URL exclusion (three layers)" note and FEATURES.md mention that the viewer layer can now export a filtered copy, and that filtered counts follow the on-screen (≤25-sample) semantics. |

## Constraints

| ID | Type | Constraint |
|---|---|---|
| C-01 | Hard | Progressive enhancement: the feature is enhancement-only; the existing unfiltered download links keep working with JS off. |
| C-02 | Hard | Fetch happens only on a user click; nothing added to page-load bytes or requests (sustainable-web-output). Reuse existing IO/CSS patterns. |
| C-03 | Hard | Filtered export is **consistent with the on-screen filtered view** (same conservative ≤25-sample rule); the UI labels this so large-finding counts aren't misread. |
| C-04 | Hard | No new data files, no `data/`/API schema change, no new npm dependencies; the pre-built static files are untouched. |
| C-05 | Hard | Severity taxonomy and CSV column schema unchanged (the refactor is behaviour-preserving). |

## Non-functional

| ID | Type | Requirement |
|---|---|---|
| NFR-01 | Testing | Unit tests: `bugsCsvTable` header/row/escaping parity with the previous `writeBugsCsv` output; `filterBugsByExclusion` already covered. Browser fetch→filter→download verified end-to-end in Chromium. `npm run test:unit` + `i18n:check` + `check:spec-kitty` green. |
| NFR-02 | Sustainability | Net added CSS/JS within budget; the CSV serializer and filter reuse existing logic; controls emitted once and inert without an active list. |

## Acceptance criteria

- [x] `bugsCsvTable(bugs)` factored out and exported; `writeBugsCsv` uses it; the
      written CSV is byte-identical to before (unit-tested). *(FR-01, C-05 — WP01)*
- [x] With an active exclusion list, the box offers **Download filtered CSV/JSON**;
      hidden when no list is active. *(FR-02, D-3 — WP02)*
- [x] The download fetches `bugs.json`, filters it with the same logic as the
      on-screen view, and saves filtered `.json` + `.csv`. *(FR-03, FR-04 — WP02)*
- [x] Filtered downloads match the on-screen view; the UI labels the ≤25-sample
      semantics. *(C-03 — WP02)*
- [x] Works as progressive enhancement; unfiltered links unchanged; no data/API
      change; no new deps. *(C-01, C-04 — WP02)*
- [x] Docs updated. *(FR-05 — WP03)*
- [x] `npm run test:unit` (276), `i18n:check`, `check:spec-kitty` green; browser
      flow verified in Chromium (filter + CSV byte-parity). *(NFR-01)*

## Out of scope

- Complete-data (non-sampled) precision via per-finding `affected_pages_csv`
  fetches (D-1 alternative).
- Filtering exports other than the bug findings (Lighthouse, images, tech,
  resources, the static JSON API) — those aren't findings and don't carry the
  viewer's page-scope semantics.
- Server-side or per-viewer persisted export artifacts.
