# Implementation Plan: Dual-engine table - issue links and numeric header alignment

**Status**: RECONSTRUCTED FROM SHIPPED WORK (#147)
**Date reconstructed**: 2026-06-20
**Spec**: [spec.md](spec.md)

## Summary

Make the consensus accessibility table easier to navigate and align numeric
headers consistently across report tables. Both changes are concentrated in
`src/report-html.js`, so they are intentionally kept in one work package to
avoid parallel ownership conflicts.

## Technical Context

**Language/Version**: Node.js ESM >=20
**Primary Dependencies**: Existing report-html rendering helpers; no new dependencies
**Storage**: No data/schema changes
**Testing**: Node built-in test runner via npm run test:unit
**Target Platform**: Static report HTML
**Constraints**: Do not change consensus deduplication logic

## Charter Check

- Preserves plain Node.js ESM with no build step.
- Preserves historical weekly data compatibility.
- Keeps report core content usable as generated static HTML.
- Uses focused unit coverage for behavior changes.
- Does not introduce secrets or external service requirements.

## Work Packages

### WP01 - Consensus links and numeric alignment

Update `src/report-html.js` so the dual-engine consensus table links issues to
detailed bug anchors and all numeric headers align with numeric cells.

**Requirement refs**: FR-01, FR-02, FR-03, FR-04, C-01, NFR-01
**Owned files**: src/report-html.js
**Validation**: Run npm run test:unit and inspect generated accessibility/report table markup.

## Validation Plan

- Run `npm run test:unit`.
- Run `npm run test:e2e` if generated report behavior is changed again.
- Run `git diff --check` before commit.

## Rollback Plan

Revert the focused implementation commit for this spec. These shipped-spec
reconstruction artifacts do not require product rollback; they document the
already-shipped implementation boundary.
