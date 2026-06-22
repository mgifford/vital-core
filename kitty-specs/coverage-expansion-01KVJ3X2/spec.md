# Spec: Coverage-expansion false positives in trend signals

**Status**: SHIPPED (2026-W25, issue #159)

## Goal

Week-over-week trend signals (`findings.json`'s `firstSeen`/`weeksSeen` and
`ai-findings.json`'s `trend` field) currently conflate sampling expansion with
real site regressions.  When an engine's weekly page sample grows, false "New:"
and "worsening" signals fire purely because more pages were checked, not because
anything changed on the site.

Root causes (from issue #159):

1. **`src/lib/findings.js` `updateFindings()`** — stamps `firstSeen = this week`
   even when the affected pages were never sampled before.
2. **`src/lib/ai-findings.js` `deriveTrend()`** — compares raw `currentPages -
   prevPages` against a 5%-of-sample tolerance band; the band shrinks as the
   sample grows, so coverage expansion routinely exceeds it.
3. **`src/aggregate.js` `diffWeeks()`** — the HTML "Changes since" section also
   uses raw rule-page counts, producing false "New:" and "spread" entries.

## Requirements

| ID | Type | Requirement |
|---|---|---|
| FR-01 | Functional | `deriveTrend()` compares rates (pages/pagesScanned) instead of raw counts when per-engine coverage data is supplied; tolerance is a fixed percentage-point band. |
| FR-02 | Functional | `updateFindings()` accepts optional `prevCoveredUrls`; marks `_coverageNew:true` when no affected page was in the prev coverage set. |
| FR-03 | Functional | `buildAiFindings()` passes engine-specific `pagesScanned` to `deriveTrend()`. |
| FR-04 | Functional | `diffWeeks()` filters `appeared` by rate × prevScanned ≥ 1; filters `changed` by rate delta > tolerance band. |
| FR-05 | Functional | `changeList()` renders rates alongside raw counts in the "Changes since" HTML section. |
| C-01 | Constraint | Omitting `prevCoveredUrls` from `updateFindings()` reproduces original behavior exactly — no `findings.json` migration required. |
| C-02 | Constraint | `deriveTrend()` falls back to raw-count comparison when coverage counts are absent or zero. |
| NFR-01 | Non-functional | All unit tests pass (`npm run test:unit`). |

## Acceptance criteria

- [x] A finding that only appears because of expanded page sampling is not
      reported as "New" in the public report.
- [x] A rule's reported trend (worsening/improving/persistent) reflects its
      rate of occurrence, not raw count, when coverage changes between weeks.
- [x] Existing committed `findings.json` files load and update without
      modification or migration.
- [x] `npm run test:unit` passes (136/136).
- [x] The sia-r111 exact scenario from issue #159 (1,178 → 2,811 pages,
      pagesScanned 2,629 → 6,753) is covered by a unit test and returns
      'improving' rather than 'worsening'.

## Out of scope

- Changing the consensus deduplication logic in `src/lib/consensus.js`.
- Migrating existing `findings.json` or `ai-findings.json` files.
- Changing the `firstSeen` field's format or meaning in the ledger schema.
