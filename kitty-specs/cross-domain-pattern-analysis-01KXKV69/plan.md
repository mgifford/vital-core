# Implementation Plan: Cross-domain pattern discovery

**Branch**: `main` (WP commits directly per this repo's PR discipline) | **Date**: 2026-07-15 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `kitty-specs/cross-domain-pattern-analysis-01KXKV69/spec.md`

## Summary

Add a fourth fleet-level rollup to the dashboard (`renderDashboard` in
`src/report-html.js`): a "Recurring patterns across domains" section that
groups accessibility findings by the existing `pattern_id`
(`hash(engine, ruleId)`, [src/lib/bug-report.js:49](../../src/lib/bug-report.js#L49))
across all active domains, filters to patterns seen on ≥2 sites, ranks by
fix leverage (`sites × severityWeight × pages`), and links each to a
representative finding. Built by cloning the existing
`mergeFleet`/`rankFleetAssociations` shape ([src/lib/tech-findings.js](../../src/lib/tech-findings.js))
rather than inventing new aggregation machinery — no scan-time changes, no
`data/` schema changes, no new dependencies.

## Technical Context

**Language/Version**: Node.js ESM ≥20 (matches project baseline; no build step, no bundler)
**Primary Dependencies**: None new. Reuses existing `src/lib/priority.js` (`SEVERITY_WEIGHT`), the `t()` i18n helper, and existing `.sortable` table CSS in `src/report-html.js`.
**Storage**: N/A — reads existing per-domain `bugs[]` already produced by `buildBugReports`; no new files, no `data/` schema change.
**Testing**: Node built-in test runner (`npm run test:unit`), following the existing pure-function unit-test convention in `tests/unit/` (e.g. `tests/unit/tech-findings.test.js` as the closest analog for `mergeFleet`/`rankFleetAssociations`).
**Target Platform**: Static HTML report, GitHub Pages (`docs/`); progressive enhancement, works with JS off.
**Project Type**: Single project (no frontend/backend split).
**Performance Goals**: Build-time only — cost is paid once per `npm run aggregate` run, same as the three existing fleet sections it sits beside. No client-side runtime cost.
**Constraints**: Sustainability gate (charter `sustainable-web-output`): no new client-side JS, no new web fonts, no new CSS budget (reuse `.sortable` table styles verbatim).
**Scale/Scope**: Same fleet as the existing dashboard — however many active domains `config/targets.yml` scans (currently dozens of government domains per the issue's own example numbers).

## Charter Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **sustainable-web-output**: PASS — no new client-side JS or data transfer; computation happens at `aggregate` build time; reuses existing `.sortable` CSS class, no new CSS/fonts added.
- **Severity taxonomy**: PASS — ranking reuses the existing `SEVERITY_WEIGHT` map (`Critical/Serious/Moderate/Minor`) from `src/lib/priority.js`; no new taxonomy introduced.
- **i18n**: PASS — new heading/column strings routed through `t()`, consistent with every other dashboard section.
- No violations requiring Complexity Tracking justification.

## Project Structure

### Documentation (this mission)

```
kitty-specs/cross-domain-pattern-analysis-01KXKV69/
├── spec.md               # Requirements (done)
├── plan.md               # This file
└── tasks/                # Work package files (spec-kitty tasks)
```

### Source Code (repository root)

```
src/
├── lib/
│   └── priority.js        # + mergeFleetPatterns(), rankFleetPatterns()
├── report-html.js          # + renderDashboard: new #h-patterns section
tests/
└── unit/
    └── priority.test.js    # + coverage for the two new functions (new file if priority.js has no existing test file; else extend it)
```

**Structure Decision**: Single project, no new directories. `mergeFleetPatterns`
and `rankFleetPatterns` live in `src/lib/priority.js` next to `fleetWorstOffenders`
and `priorityScore` — they share the same `SEVERITY_WEIGHT` constant and the same
`[{ target, bugs }]` input shape, so co-locating avoids a needless new module
(spec.md FR-001 offered `src/lib/patterns.js` as an alternative; rejected in
favor of the smaller diff — see Complexity Tracking).

## Complexity Tracking

*Fill ONLY if Charter Check has violations that must be justified*

None — Charter Check passed cleanly.

## Implementation Concern Map

Single-WP mission; one implementation concern covers the full slice.

### IC-01 — Fleet pattern rollup (aggregation + rendering)

- **Purpose**: Group and rank findings by `pattern_id` across domains, then render the result as a new dashboard section, so a reviewer can see which accessibility bugs recur across the fleet and how much fix leverage each represents.
- **Relevant requirements**: FR-001, FR-002, FR-003, FR-004, FR-005, C-001–C-006, NFR-001, NFR-003
- **Affected surfaces**: `src/lib/priority.js` (two new exported pure functions), `src/report-html.js` (`renderDashboard`, new `#h-patterns` section body + subnav/heading wiring), `tests/unit/` (new or extended unit test file)
- **Sequencing/depends-on**: none — this is the entire mission
- **Risks**: `renderDashboard` is a large function (~4000 lines in `report-html.js`); inserting a new section must not disturb the existing `#h-worst`/`#h-techfindings`/`#h-lhfleet` sections' ordering, CSS classes, or empty-state behavior. Mitigate by copying the `techFindingsSection`/`lighthouseFleetSection` code shape verbatim and only swapping the data source and column labels.

FR-006 (CSV export stretch) is explicitly optional per spec.md and is not
included in this WP's scope; it can be split into a follow-up mission/WP if
FR-001–005 land and the reviewer wants it.
