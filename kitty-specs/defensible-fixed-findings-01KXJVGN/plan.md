# Implementation Plan: Defensible fixed findings

**Branch**: `main` | **Date**: 2026-07-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `kitty-specs/defensible-fixed-findings-01KXJVGN/spec.md`

**Note**: This template is filled in by the `/spec-kitty.plan` command. See `src/doctrine/missions/software-dev/command-templates/plan.md` for the execution workflow.

The planner will not begin until all planning questions have been answered—capture those answers in this document before progressing to later phases.

## Summary

The report's "Fixed this week" claim (`weekDeltas()` in `src/lib/progress.js`)
currently means only "this pattern_id was absent from this week's scan" — it
does not confirm the previously-affected pages were actually re-crawled and
found clean. This mission adds a symmetric `_coverageLost` detection to the
existing `_coverageNew` machinery in `src/lib/findings.js`, splits the `fixed`
bucket into confirmed-vs-unconfirmed, and surfaces pattern-id/page evidence
links in both the HTML report (`src/report-html.js`) and the static JSON API
(`src/lib/api-writer.js`) so a reader can verify a claimed fix.

## Technical Context

**Language/Version**: Node.js ESM, >=20 (per package.json engines / CLAUDE.md — no build step, no bundler)
**Primary Dependencies**: None new. Reuses existing project modules only: `src/lib/findings.js`, `src/lib/progress.js`, `src/report-html.js`, `src/lib/api-writer.js`, `src/lib/state.js` (crawl coverage), `src/aggregate.js` (orchestration).
**Storage**: Committed JSON ledger files (`data/<domain>/findings.json`), gitignored per-week `docs/api/v1/` static JSON output — no database.
**Testing**: `npm run test:unit` (Node built-in test runner, `tests/unit/**/*.test.js`); no fs/database mocking per project convention — synthetic ledger/coverage fixtures only.
**Target Platform**: Server-side Node CLI (GitHub Actions runner + local dev), output consumed by static HTML/JSON served via GitHub Pages.
**Project Type**: Single project (no frontend/backend split; `src/` is the whole app).
**Performance Goals**: No new performance target — this is a metadata/classification change on data already computed during `aggregate.js`; must not add a second crawl or re-scan pass.
**Constraints**: Must satisfy spec.md C-01 (omitting per-engine coverage data reproduces original behavior exactly, no forced `findings.json` migration) and NFR-02 (no new client-side JS budget growth — evidence links are plain server-rendered anchors).
**Scale/Scope**: Touches 4-5 existing files; no new files expected beyond tests. Scoped to rule-level (`pattern_id`) granularity per spec.md C-02 — explicitly not instance-level.

## Charter Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on charter file]

## Project Structure

### Documentation (this mission)

```
kitty-specs/[###-mission]/
├── plan.md              # This file (/spec-kitty.plan command output)
├── research.md          # Phase 0 output (/spec-kitty.plan command)
├── data-model.md        # Phase 1 output (/spec-kitty.plan command)
├── quickstart.md        # Phase 1 output (/spec-kitty.plan command)
├── contracts/           # Phase 1 output (/spec-kitty.plan command)
└── tasks.md             # Phase 2 output (/spec-kitty.tasks command - NOT created by /spec-kitty.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this mission. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

*Fill ONLY if Charter Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

## Implementation Concern Map

*Include this section when the mission has multiple distinct architectural areas that inform how tasks are decomposed.*

> **Note**: Implementation concerns are NOT work packages and are NOT executable units.
> `/spec-kitty.tasks` translates these into executable WPs — one concern may become
> multiple WPs; multiple small concerns may merge into one WP. Do not label concerns
> with WP-style IDs or sequencing language.

### IC-01 — Coverage-lost ledger detection

- **Purpose**: Detect when a finding disappears because its previously-affected pages were never re-crawled this week, and mark it distinctly from a confirmed fix.
- **Relevant requirements**: FR-001, FR-003, C-01
- **Affected surfaces**: `src/lib/findings.js` (`updateFindings()`), `src/aggregate.js` (call site passing per-engine coverage sets)
- **Sequencing/depends-on**: none
- **Risks**: Per-engine coverage-set data must already be available at the point `updateFindings()` runs (same shape as existing `prevCoveredUrls` used for `_coverageNew`) — if it isn't, this WP needs to capture it earlier in the pipeline, which would grow scope.

### IC-02 — Progress bucket classification

- **Purpose**: Split `weekDeltas()`'s `fixed` bucket into confirmed-fixed vs. coverage-lost/unconfirmed, so downstream consumers never conflate the two.
- **Relevant requirements**: FR-002
- **Affected surfaces**: `src/lib/progress.js` (`weekDeltas()`, `weekDeltaCounts()`, `deltaSeries()`)
- **Sequencing/depends-on**: IC-01 (needs the `_coverageLost` flag on ledger findings to classify against)
- **Risks**: Existing callers of `weekDeltaCounts()`/`weekDeltas()` in `src/aggregate.js` and `src/report-html.js` expect the current `{ new, fixed, regressed }` shape — must extend, not break, that contract.

### IC-03 — Report and API evidence surfacing

- **Purpose**: Give every "fixed" (and ideally "new"/"regressed") item a visible pattern-id and page-link trail in both the HTML report and the static JSON API, so a reader can verify the claim.
- **Relevant requirements**: FR-004, FR-005
- **Affected surfaces**: `src/report-html.js` (`progressSection()`), `src/lib/api-writer.js`
- **Sequencing/depends-on**: IC-02 (needs the classified buckets to render/export)
- **Risks**: Must not grow the client-side JS budget (NFR-02) — links are plain server-rendered anchors, no new fetch/client logic.
