# Spec: Dual-engine table — issue links + numeric header alignment

**Status**: SHIPPED (2026-W25, PR #147)

## Goal

Two usability fixes to the "caught by both engines" consensus table on the
accessibility page:

1. Each issue name in the table should link to its full bug report at
   `accessibility.html#VS-xxxxxxxx` so the engineer can jump straight to
   the detailed finding.
2. Numeric column headers (Pages, Count, Pass rate, etc.) should
   right-align to sit visually above their right-aligned `<td class="num">`
   cells throughout all report tables.

## Acceptance criteria

- [x] `src/report-html.js` — `consensusSection()` receives the `bugs` array
      and builds a `Map` from axe rule ID to bug instance ID.
- [x] Each issue cell in the consensus table renders as
      `<a href="accessibility.html#VS-<id>">…</a>` when a matching bug exists;
      plain text when no match.
- [x] CSS: `td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }`.
- [x] CSS: `th.num button { width: 100%; text-align: right; }` so sortable column
      header buttons right-align their label text.
- [x] All `<th scope="col">` headers for numeric columns carry `class="num"` across
      all report pages: Standards, Fix-first, dual-engine, rule tables, Coverage,
      Resources, Images, History, Fleet, Index, PWA, Lighthouse recommendations.
- [x] All 91 unit tests pass.

## Out of scope

- Changing the consensus deduplication logic in `src/lib/consensus.js`.
- Adding links in the axe-core or Alfa rule tables (those already link to rule docs).
