# Implementation Plan: Severity taxonomy - axe-core labels throughout

**Status**: RECONSTRUCTED FROM SHIPPED WORK (#146)
**Date reconstructed**: 2026-06-20
**Spec**: [spec.md](spec.md)

## Summary

Replace non-standard severity labels with axe-core's Critical, Serious, Moderate, and Minor taxonomy across scoring, CSV exports, reports, and tests.

## Technical Context

**Language/Version**: Node.js ESM >=20
**Primary Dependencies**: Existing axe-core-derived records and report helpers; no new dependencies
**Storage**: No schema migration; existing page records keep raw axe impact values
**Testing**: Node built-in test runner via npm run test:unit
**Target Platform**: macOS, Linux, GitHub Actions
**Constraints**: Do not change raw axe impact strings or existing scoring weights

## Charter Check

- Preserves plain Node.js ESM with no build step.
- Preserves historical weekly data compatibility unless explicitly noted otherwise.
- Keeps report core content usable as generated static HTML.
- Uses focused unit coverage for behavior changes.
- Does not introduce secrets or external service requirements.

## Work Packages

### WP01 - Core severity contract and ranking helpers

Normalize the internal display severity contract and all priority/ranking consumers to axe-core labels without changing raw axe input values or weights.

**Requirement refs**: FR-01, FR-02, C-01, C-02
**Owned files**: src/lib/wcag.js, src/lib/accessibility-priority.js, src/lib/bug-report.js, src/lib/priority.js, src/lib/ai-findings.js
**Validation**: Run npm run test:unit and grep src/ for High/Medium/Low severity display values.

### WP02 - Report, export, and test updates

Carry the taxonomy through generated downloads, report UI classes, and tests.

**Requirement refs**: FR-03, FR-04, NFR-01
**Owned files**: src/lib/csv.js, src/report-html.js, tests/unit/**/*.test.js
**Validation**: Run npm run test:unit.

## Validation Plan

- Run `npm run test:unit` for all specs.
- Run `npm run test:e2e` when changing scan, aggregate, generated report, or weekly pipeline behavior.
- Run `git diff --check` before commit.

## Rollback Plan

Revert the focused implementation commit for this spec. These shipped-spec reconstruction artifacts do not require product rollback; they document the already-shipped implementation boundary.
