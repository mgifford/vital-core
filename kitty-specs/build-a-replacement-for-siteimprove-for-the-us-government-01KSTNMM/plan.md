# Implementation Plan: Siteimprove Replacement for US Government

**Branch**: `main` | **Date**: 2026-05-29 | **Spec**: `kitty-specs/build-a-replacement-for-siteimprove-for-the-us-government-01KSTNMM/spec.md`
**Input**: Feature specification from `/kitty-specs/build-a-replacement-for-siteimprove-for-the-us-government-01KSTNMM/spec.md`

## Summary

Build an open, CI-driven website quality platform for US government websites using an Alfa-first accessibility engine with Axe backup, then prioritize remediation based on consensus findings (issues detected by both engines). Deliver continuously published reports on GitHub Pages with durable historical data and trend summaries.

Initial implementation focus:

1. Integrate Alfa scan execution and normalize outputs.
2. Correlate Alfa + Axe findings into shared, standards-aware finding records.
3. Prioritize consensus failures above single-engine failures.
4. Publish durable JSON artifacts and browsable dashboard summaries via GitHub Pages.

## Planning Answers

1. **Minimum Alfa Rules for v1**
  - Start with the default WCAG-focused Alfa rule set that is stable in CI and maps cleanly to WCAG/ACT references.
  - Expand coverage once baseline performance and result stability are validated.

2. **Consensus Matching Strategy**
  - Use a hybrid strategy:
    - Primary key: canonical normalized rule key (crosswalk map).
    - Secondary key: standards references (WCAG/ACT/508), target selector overlap, and page URL.

3. **Executive Reporting Metrics**
  - Consensus failure count.
  - Total violations.
  - Violations per page.
  - Delta vs previous run.
  - 7-run rolling averages.

4. **Machine Exports for Ticketing**
  - Keep JSON-first exports in v1 (`latest`, `index`, per-run artifacts, `trends`).
  - Add dedicated ticket export schema in v1.1 after normalization and consensus schema stabilizes.

## Technical Context

**Language/Version**: TypeScript (`ES2022` target, `commonjs`)  
**Primary Dependencies**: Playwright, `@axe-core/playwright`, Cheerio, Sitemapper, Picomatch, YAML, Zod  
**Storage**: File-based artifacts in `dist/` and GitHub Pages published assets (`runs/*.json`)  
**Testing**: `npm test` (`tsc --noEmit`, profile validation, Vitest unit tests)  
**Target Platform**: GitHub Actions (`ubuntu-latest`) + GitHub Pages static hosting  
**Project Type**: Single Node/TypeScript scanning pipeline with static report output  
**Performance Goals**:
- Keep scheduled CI runs within practical GitHub Action time limits.
- Maintain deterministic max-page and timeout controls per target profile.
**Constraints**:
- Must run non-interactively in CI.
- Must preserve historical data across deployments.
- Must remain inspectable and standards-aligned for federal use.
**Scale/Scope**:
- Multi-target profile scans (federal domains).
- Durable historical run archive (capped index size in reporter logic).

## Charter Check

No explicit project charter file is currently present in this repository. Proceeding with mission gates derived from the approved specification and existing repository constraints.

Gate status before research/design:

1. Scope is clear and bounded to accessibility feedback replacement baseline: PASS.
2. Delivery path is incremental and testable in CI: PASS.
3. Data durability and report browsability requirements are explicit: PASS.

## Project Structure

### Documentation (this feature)

```
kitty-specs/build-a-replacement-for-siteimprove-for-the-us-government-01KSTNMM/
├── spec.md
├── plan.md
├── status.events.jsonl
└── tasks/
```

### Source Code (repository root)

```
src/
├── index.ts
├── engine/
│   ├── browser.ts
│   ├── discovery.ts
│   ├── parser.ts
│   ├── reporters/
│   │   ├── bug-exporter.ts
│   │   ├── dashboard-compiler.ts
│   │   └── run-history.ts
│   └── workers/
│       ├── live-worker.ts
│       └── offline-worker.ts
└── types/
   ├── profile.ts
   └── site-quality-spec.ts

tests/
└── unit/

.github/workflows/
├── vital-scan.yml
├── deploy-pages.yml
└── update-submodules.yml

profiles/
└── us-health.yml

scripts/
└── fetch-history.mjs
```

**Structure Decision**: Keep single-project structure and extend existing engine/reporter modules rather than introducing backend/frontend split. This preserves current CI workflow and minimizes complexity for the first replacement release.

## Implementation Phases

### Phase 0: Research and Interface Definition

1. Validate Alfa execution approach suitable for CI (CLI or in-process package integration).
2. Define raw Alfa result capture format and persistence contract.
3. Define canonical normalized finding schema supporting dual-engine metadata.

Deliverables:

- `research.md` with integration tradeoffs and final Alfa approach.
- Draft crosswalk strategy for Alfa↔Axe alignment.

### Phase 1: Data Model and Contracts

1. Extend types to support engine provenance and consensus classification.
2. Define normalized finding contract and rule crosswalk contract.
3. Add contract fixtures for representative Alfa/Axe findings.

Deliverables:

- `data-model.md`
- `contracts/` definitions for normalized findings and run artifacts.

### Phase 2: Alfa + Correlation Pipeline

1. Add Alfa worker path to scan lifecycle.
2. Normalize Alfa and Axe outputs into shared finding records.
3. Implement consensus classification and priority ordering.

Deliverables:

- Engine updates in `src/engine/workers/` and reporter pipeline integration.
- Unit tests for normalization and consensus logic.

### Phase 3: Reporting and UX

1. Add consensus-first summaries in dashboard output.
2. Add engine/comparison visibility to JSON artifacts and UI.
3. Keep Pages history and trend outputs backward-compatible.

Deliverables:

- Dashboard/report updates in `src/engine/reporters/`.
- Snapshot-level tests for output schema fields.

### Phase 4: CI Hardening and Rollout

1. Tune profiles for runtime budgets and reliability.
2. Validate historical storage growth controls.
3. Document operations for federal teams.

Deliverables:

- Updated README and runbook notes.
- Stable scheduled workflow operation.

## Requirement Mapping

| Requirement | Planned Implementation | Validation |
|-------------|------------------------|------------|
| FR-1 Scan Orchestration | Preserve and extend GitHub Actions workflows for scheduled and manual runs; keep profile-driven discovery and crawl controls in engine path. | Workflow execution + phase validations + `npm test` |
| FR-2 Alfa-First Engine Integration | Add Alfa worker integration and raw result capture; integrate into scan lifecycle before final report compilation. | Unit tests for Alfa adapter + integration run on sample profile |
| FR-3 Axe Backup Engine Integration | Keep existing Axe-based worker path and ensure dual-engine execution per scanned page. | Existing live-worker tests + dual-engine integration test |
| FR-4 Normalization Layer | Add normalized finding schema and adapters for Alfa/Axe output; preserve source metadata and standards references. | Unit tests for normalization fixtures and schema validation |
| FR-5 Consensus Prioritization | Implement overlap classifier (`consensus`, `alfa-only`, `axe-only`) and priority sorting logic in report pipeline. | Unit tests for correlation and sorting with deterministic fixtures |
| FR-6 Reporting and Exports | Extend dashboard and JSON exports to include normalized findings, source engines, and remediation links/evidence. | Snapshot/report schema checks + manual dashboard verification |
| FR-7 Persistent Run History | Continue writing and merging `runs/latest.json`, `runs/index.json`, and immutable run artifacts across deployments. | Unit tests for run-history reporter + Pages deployment check |
| FR-8 Trend Summaries | Maintain and extend `runs/trends.json` with deltas and rolling averages for dual-engine and consensus metrics. | Unit tests for trend generation and field integrity |
| FR-9 GitHub Pages Browsability | Surface latest/index/trends/history links and render run history table in dashboard UI. | UI smoke check on deployed Pages + JSON endpoint verification |

## Test Strategy

1. Unit tests (Vitest) for:
  - normalization
  - rule crosswalk
  - consensus classification
  - priority sorting
2. Type and schema validation with `tsc --noEmit` and Zod parsing.
3. Existing phase validations remain available as integration checks.
4. CI gate remains `npm test` plus workflow execution checks.

## Risks and Mitigations

1. **Alfa integration complexity in CI**
  - Mitigation: start with smallest stable integration path and lock versions.
2. **False consensus from weak matching**
  - Mitigation: hybrid matching with explicit confidence levels and traceable evidence.
3. **Runtime growth from dual-engine scans**
  - Mitigation: profile limits (`max_pages`, timeouts, priority URLs), optional phased rollout.
4. **Historical artifact bloat**
  - Mitigation: cap indexed history size and keep immutable run files compressed only if needed later.

## Definition of Done (for this mission)

1. Alfa findings are produced in CI for scanned pages.
2. Normalized finding schema includes engine provenance and consensus class.
3. Consensus failures are prioritized above single-engine findings in outputs.
4. GitHub Pages publishes latest, historical index, per-run artifacts, and trends including consensus-oriented metrics.
5. `npm test` and `npm run build` pass with added coverage for new logic.

## Complexity Tracking

No charter violations currently identified.
