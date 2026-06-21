---
wp_id: WP01
title: "Coverage-aware trend signals"
mission_slug: coverage-expansion-01KVJ3X2
owned_files:
  - src/lib/ai-findings.js
  - src/lib/findings.js
  - src/aggregate.js
  - src/report-html.js
  - tests/unit/ai-findings.test.js
  - tests/unit/findings.test.js
requirement_refs:
  - FR-01
  - FR-02
  - FR-03
  - FR-04
  - FR-05
  - C-01
  - C-02
  - NFR-01
subtasks:
  - T001
  - T002
  - T003
  - T004
  - T005
  - T006
---

# WP01: Coverage-aware trend signals

Fix all four touch-points where coverage expansion causes false "New" and
"worsening" trend signals.

## Context

Issue #159 identified that when axe/Alfa's weekly page sample grows, the
existing raw-count comparisons produce false alarms:

- `deriveTrend()` uses raw `currentPages - prevPages` with a tolerance band
  proportional to `currentPages`; as the sample grows the band shrinks in
  relative terms.
- `updateFindings()` stamps `firstSeen = this week` even when all affected
  pages are newly sampled.
- `diffWeeks()` marks rules as "appeared" or "spread" based on rule presence
  and raw page count changes.

The sia-r111 example: 1,178 pages → 2,811 pages affected when pagesScanned
went from 2,629 to 6,753.  The rate actually declined (44.8% → 41.6%).

## Tasks

### T001: Fix deriveTrend() — rate comparison with fixed tolerance band

In `src/lib/ai-findings.js`:
- Add `currentChecked` and `prevChecked` parameters to `deriveTrend()`
- When both > 0: compare `currentPages/currentChecked` vs `prevPages/prevChecked`
- Tolerance: fixed 2pp band (not proportional to sample size)
- When coverage data absent: fall back to original raw-count logic (C-02)
- Handle `_coverageNew: true` in ledger entry: return 'persistent' not 'new'

### T002: Fix buildAiFindings() — pass engine coverage to deriveTrend()

In `src/lib/ai-findings.js`:
- Derive `engineSummaryKey` from `bug.engine_key` ('axe-core' → 'axe', 'alfa' → 'alfa')
- `currentChecked = summary[engineSummaryKey]?.pagesScanned ?? 0`
- `prevChecked = prev?.[engineSummaryKey]?.pagesScanned ?? 0`
- Pass both to `deriveTrend()`

### T003: Fix updateFindings() — coverage-expansion flag

In `src/lib/findings.js`:
- Accept `{ prevCoveredUrls }` as optional fourth argument (C-01)
- For new findings: check if any `r.affected_pages` URL is in `prevCoveredUrls`
- If none are → set `_coverageNew: true` on ledger entry
- When finding appears a second week → delete `_coverageNew`

### T004: Fix diffWeeks() — rate-aware appeared/changed

In `src/aggregate.js`:
- Pass `prevScanned`/`currScanned` to `diffEngine()`
- `appeared`: filter out rules where `(pages/currScanned) × prevScanned < 1`
- `changed`: filter by `|currRate - prevRate| > DIFF_TOLERANCE_PP (0.02)`
- Annotate changed items with `prevScanned`/`currScanned` for HTML use

### T005: Fix changeList() — show rates in HTML

In `src/report-html.js`:
- When `c.prevScanned > 0 && c.currScanned > 0`, append rate note to changed items
- Format: `(rate: N% → M% of pages scanned)`

### T006: Add unit tests

In `tests/unit/ai-findings.test.js`:
- sia-r111 exact scenario: prevPages=1178, currPages=2811, prevChecked=2629, currChecked=6753 → not 'worsening'
- stable rate with expansion: rate stays 30% → 'persistent'
- coverage-new flag → 'persistent' not 'new'
- genuinely worsening rate (25%→40%) → 'worsening'

In `tests/unit/findings.test.js` (new file):
- no prevCoveredUrls → backward compat, no `_coverageNew`
- all affected pages new → `_coverageNew: true`
- one affected page in prev coverage → no `_coverageNew`
- second week clears `_coverageNew`
- no `affected_pages` list → no false flag
