# Plan: coverage-expansion-01KVJ3X2

## Approach

Single work package: fix all four touch-points in one pass since they share
the same concept (rates vs raw counts) and have no independent deployment
value.

## Work packages

### WP01 — Coverage-aware trend signals

**Files**: `src/lib/ai-findings.js`, `src/lib/findings.js`,
`src/aggregate.js`, `src/report-html.js`,
`tests/unit/ai-findings.test.js`, `tests/unit/findings.test.js`

**Steps**:

1. Fix `deriveTrend()` — add `currentChecked`/`prevChecked` params; compare
   rates with a fixed 2pp tolerance band; fall back to raw-count comparison
   when coverage data is absent (backward compat).
2. Fix `buildAiFindings()` — derive engine-specific `pagesScanned` from the
   summary and pass to `deriveTrend()`.
3. Fix `updateFindings()` — accept `{ prevCoveredUrls }` option; set
   `_coverageNew: true` when no affected page is in the prev coverage set;
   clear the flag once the finding appears a second time.
4. Fix `diffWeeks()` in `aggregate.js` — filter `appeared` by rate ×
   prevScanned ≥ 1; filter `changed` by |currRate - prevRate| > 2pp;
   annotate `changed` items with `prevScanned`/`currScanned`.
5. Fix `changeList()` in `report-html.js` — render rates alongside raw
   counts when coverage data is present.
6. Add unit tests: sia-r111 exact scenario, stable-rate-with-expansion,
   coverage-new flag lifecycle, genuinely-worsening rate.
