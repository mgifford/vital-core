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

### IC-01 — [Name]

- **Purpose**: [One sentence: what this concern addresses and why it matters]
- **Relevant requirements**: [FR-### refs from spec.md]
- **Affected surfaces**: [File paths or module names this concern touches]
- **Sequencing/depends-on**: [IC-## IDs this concern must follow, or "none"]
- **Risks**: [Key coordination notes or implementation risks]

### IC-02 — [Name]

- **Purpose**: [One sentence]
- **Relevant requirements**: [FR-### refs]
- **Affected surfaces**: [Paths/modules]
- **Sequencing/depends-on**: [IC-## or "none"]
- **Risks**: [Notes]
