# Implementation Plan: Download filenames include domain and date

**Status**: RECONSTRUCTED FROM SHIPPED WORK (#151)
**Date reconstructed**: 2026-06-20
**Spec**: [spec.md](spec.md)

## Summary

Prefix user-facing CSV/JSON downloads with the report domain and ISO-week Monday date stamp so files remain self-describing outside the report directory.

## Technical Context

**Language/Version**: Node.js ESM >=20
**Primary Dependencies**: Existing week/csv/report helpers; no new dependencies
**Storage**: Generated filenames only; summary/report metadata may reference returned names
**Testing**: Node built-in test runner via npm run test:unit
**Target Platform**: Static report artifact downloads
**Constraints**: Per-rule csv/ files remain unprefixed internal links

## Charter Check

- Preserves plain Node.js ESM with no build step.
- Preserves historical weekly data compatibility unless explicitly noted otherwise.
- Keeps report core content usable as generated static HTML.
- Uses focused unit coverage for behavior changes.
- Does not introduce secrets or external service requirements.

## Work Packages

### WP01 - ISO-week date stamp helper

Add the shared date stamp helper and verify normal/fallback behavior.

**Requirement refs**: FR-01, NFR-01, NFR-02
**Owned files**: src/lib/week.js, tests/unit/**/*.test.js
**Validation**: Run npm run test:unit.

### WP02 - User-facing download filename prefixing

Update user-facing CSV/JSON writers to use domain/date prefixes while preserving internal per-rule filenames.

**Requirement refs**: FR-02, C-01
**Owned files**: src/lib/csv.js
**Validation**: Run npm run test:unit and inspect generated file names in a fixture aggregate run.

### WP03 - Aggregate and report download links

Thread generated filenames through summary/reporting metadata and use them in report download links.

**Requirement refs**: FR-03, FR-04
**Owned files**: src/aggregate.js, src/report-html.js
**Validation**: Run npm run test:unit; run npm run test:e2e if aggregate/report behavior changes.

## Validation Plan

- Run `npm run test:unit` for all specs.
- Run `npm run test:e2e` when changing scan, aggregate, generated report, or weekly pipeline behavior.
- Run `git diff --check` before commit.

## Rollback Plan

Revert the focused implementation commit for this spec. These shipped-spec reconstruction artifacts do not require product rollback; they document the already-shipped implementation boundary.
