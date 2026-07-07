---
work_package_id: WP02
title: "Layer-1 domain landing page"
dependencies:
- WP01
requirement_refs:
- FR-02
- FR-03
- FR-04
- FR-05
- C-02
- C-03
- C-06
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main (ia/progressive-disclosure). Merge back to main when WP is complete.
subtasks:
- T002
- T003
- T004
agent: claude
scope: report-html + lib
owned_files:
- "src/report-html.js"
- "src/lib/progress.js"
- "src/aggregate.js"
- "tests/unit/report-html.test.js"
- "tests/unit/progress.test.js"
---

# WP02: Layer-1 domain landing page

## Objective

Turn `renderDomainReport` (`src/report-html.js:2479`) into the 10-second manager
view: conclusion first (score + trend), then the three deltas that create a sense
of progress, then one clear next step — with today's detail demoted below the
fold but fully reachable.

## Context

- `renderDomainReport` already receives `target, summary, prev, diff, series,
  bugs, csvLinks, invSummary` and already renders the scorecard + `trajectory`,
  the "at a glance" ledger, `severityTrendChart`, `changeList`, and
  `fixFirstSection`.
- Reuse: `statTile` (WP01), `scoreFor`/`trajectory` (`src/lib/score.js`),
  `rankBugs` (`:1648`), the findings ledger (`src/lib/findings.js`:
  `firstSeen`/`lastSeen`/`_weeks`).

## Subtasks

### T002: new/fixed/regressed derivations (`src/lib/progress.js`)

Pure functions, unit-tested: `newThisWeek`, `fixedThisWeek` (ledger
`lastSeen < currentWeek`), `regressedThisWeek` (gap in ledger `_weeks`, i.e.
resolved then returned). Keep them independent of rendering so `aggregate.js`
can pass the results in (or the render computes from `series` + ledger in scope).

### T003: Hero + three deltas + biggest-win callout

Lead with the existing scorecard (score + grade + band + trajectory), then a
`<dl class="ledger">` of three `statTile`s — new / fixed / regressed this week.
Add one "biggest available win" callout from `rankBugs(bugs, 1)` linking to the
finding's single canonical location (`accessibility.html#<instance_id>` until
WP04 renames it). One primary action on the page.

### T004: Demote detail

Wrap "This week at a glance", "Trends over time", and "Changes since @week" in
native `<details>` collapsed by default, each `<summary>` carrying a visible
count (e.g. "14 moderate findings ▸"). All content stays reachable with JS off.
Update `tests/unit/report-html.test.js` overview assertions.

## Validation

`npm run test:unit` green (progress pure-fn tests + updated overview
assertions); `npm run i18n:check` clean; render smoke shows hero + three deltas +
callout; page usable with JS disabled; severity taxonomy unchanged.
