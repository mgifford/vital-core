---
work_package_id: WP03
title: "Progress panel"
dependencies:
- WP02
requirement_refs:
- FR-06
- FR-07
- FR-08
- FR-09
- C-03
- C-04
- NFR-02
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main (ia/progressive-disclosure). Merge back to main when WP is complete.
subtasks:
- T005
- T006
- T007
agent: claude
scope: report-html + lib
owned_files:
- "src/report-html.js"
- "src/lib/progress.js"
- "tests/unit/progress.test.js"
---

# WP03: Progress panel

## Objective

Make progress itself an artifact on the landing page: what got fixed, whether the
open-finding burden is trending down, how much triage is done, and any clean-week
streaks.

## Context

- Severity buckets exist only for the latest week (`severityCounts`,
  `src/lib/api-writer.js:6`) — lift that logic into `src/lib/progress.js` and run
  it across each week of `series`.
- Charts use the accessible SVG + visually-hidden data-table + ParaCharts
  pattern (`severityTrendChart`, `report-html.js:476`) — mirror it, do not invent
  a new chart type.
- Triage is browser-local (`triageScript()`, localStorage `vital-triage:*`);
  the completion count must be client-side.

## Subtasks

### T005: Fixed-this-week panel + burndown (`src/lib/progress.js`)

`severityBurndown(series, perWeekBugs)` → per-week {critical,serious,moderate,
minor} open-finding counts. Render a burndown chart (existing SVG + data-table
pattern) and a "Fixed this week" list from `fixedThisWeek` (WP02). Unit-test the
pure functions.

### T006: Triage completion (client-side)

A small progressive-enhancement script counting `localStorage['vital-triage:*']`
decisions against the number of findings on the page, filling "X of N triaged".
Blank/absent with JS off. Mirror `triageScript()` conventions.

### T007: Streak badges

`streaks(series)` in `src/lib/progress.js` → e.g. "0 criticals for N weeks" from
the burndown series; render as small badges. Unit-tested.

## Validation

`npm run test:unit` green (burndown/streak pure-fn tests); `npm run i18n:check`
clean; charts keep the data-table fallback and work with JS off; added CSS/JS
stays within the lean budget (reuse existing classes/patterns).
