# Implementation Plan: Weekly public-interest standards checks

**Status**: RECONSTRUCTED FROM SHIPPED WORK (#150)
**Date reconstructed**: 2026-06-20
**Spec**: [spec.md](spec.md)

## Summary

Add origin-level weekly checks for accessibility statement, carbon.txt, Green Web Foundation, XML sitemap, and human-readable sitemap, plus a diagnostic CLI.

## Technical Context

**Language/Version**: Node.js ESM >=20
**Primary Dependencies**: Built-in fetch and existing scan/aggregate/report helpers; no browser for checks
**Storage**: summary.publicInterest in weekly summary; no page-level schema break
**Testing**: Node built-in test runner via npm run test:unit
**Target Platform**: GitHub Actions weekly scan and local CLI diagnostics
**Constraints**: Diagnostic exits 0; individual check failures return unknown instead of throwing

## Charter Check

- Preserves plain Node.js ESM with no build step.
- Preserves historical weekly data compatibility unless explicitly noted otherwise.
- Keeps report core content usable as generated static HTML.
- Uses focused unit coverage for behavior changes.
- Does not introduce secrets or external service requirements.

## Work Packages

### WP01 - Origin-level public-interest engine

Implement a no-browser origin-level checker with graceful per-check failure behavior.

**Requirement refs**: FR-01, FR-02, NFR-01
**Owned files**: src/engines/public-interest.js, tests/unit/public-interest.test.js
**Validation**: Run npm run test:unit.

### WP02 - Scan, aggregate, and report wiring

Surface the latest public-interest check in weekly summaries and Standards reports without changing scoring/gating.

**Requirement refs**: FR-03, FR-04, FR-05, C-01
**Owned files**: src/scan.js, src/aggregate.js, src/report-html.js, config/targets.yml
**Validation**: Run npm run test:unit; run npm run test:e2e for pipeline confidence if changing scan/aggregate behavior.

### WP03 - Diagnostic CLI

Provide a quick local diagnostic that shares engine behavior and never acts as a CI gate.

**Requirement refs**: FR-06, C-01
**Owned files**: scripts/check-public-interest.js, package.json
**Validation**: Run npm run check:public-interest www.cms.gov -- --json or the documented local equivalent.

## Validation Plan

- Run `npm run test:unit` for all specs.
- Run `npm run test:e2e` when changing scan, aggregate, generated report, or weekly pipeline behavior.
- Run `git diff --check` before commit.

## Rollback Plan

Revert the focused implementation commit for this spec. These shipped-spec reconstruction artifacts do not require product rollback; they document the already-shipped implementation boundary.
