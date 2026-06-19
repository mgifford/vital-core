# Implementation Plan: Static JSON API for Scan Results

**Branch**: `public-interest-checks` | **Date**: 2026-06-19 | **Spec**: [spec.md](spec.md)
**Input**: `kitty-specs/api-01KVGN9H/spec.md`

## Summary

Extend `src/aggregate.js` to write a versioned static JSON API under `docs/api/v1/` during each aggregate run. Three endpoint families: a global index, per-domain snapshots, and per-domain/per-week findings. No server, no new dependencies — pure file writes alongside existing HTML report output. Research decisions documented in `kitty-specs/api-01KVGN9H/research.md`.

## Technical Context

**Language/Version**: Node.js ESM ≥20
**Primary Dependencies**: Node.js built-in `fs`, `path` — already used in `src/aggregate.js`
**Storage**: Static files in `docs/api/v1/` (gitignored locally, deployed via GitHub Pages artifact)
**Testing**: Node built-in test runner (`node:test`); unit tests for `src/lib/api-writer.js`
**Target Platform**: GitHub Pages (static file hosting)
**Project Type**: Single project
**Performance Goals**: Aggregate build time increase ≤5%; each API file ≤5 MB (NFR-01, NFR-03)
**Constraints**: Static files only; no server; no new npm dependencies (C-01, C-02, NFR-04)
**Scale/Scope**: One findings file per domain/week + one snapshot per domain + one global index

## Charter Check

- ✓ No new npm dependencies (NFR-04)
- ✓ VA domains excluded via existing `hf_only` guard — aggregate already skips them in CI (C-04)
- ✓ All 91 unit tests must continue to pass (NFR-02)
- ✓ Output written to `docs/` (gitignored locally, deployed as GitHub Pages artifact) (C-03)
- ✓ Locality of change: new `src/lib/api-writer.js` keeps aggregate.js changes minimal

## Project Structure

```
src/
├── aggregate.js              # Extended to import and call writeApiFiles
└── lib/
    └── api-writer.js         # New: builds index, snapshot, findings JSON + writes files

tests/unit/
└── api-writer.test.js        # Unit tests for builder functions

docs/api/v1/                  # Generated output (gitignored locally)
├── index.json
├── www.cms.gov/
│   ├── snapshot.json
│   └── 2026-W25/
│       └── findings.json
└── ...

kitty-specs/api-01KVGN9H/
├── spec.md
├── plan.md                   # This file
├── research.md
├── data-model.md
├── research/
│   ├── evidence-log.csv
│   └── source-register.csv
└── tasks/
```

**Structure Decision**: Single project. New `src/lib/api-writer.js` extracted following the `csv.js` / `ai-findings.js` pattern. Keeps `src/aggregate.js` readable and the new module independently testable.

## Work Packages

### WP01 — `src/lib/api-writer.js` + unit tests

Create the module that builds and writes all three API response shapes:
- `buildIndexEntry(target, latest, bugs)` → IndexEntry object
- `buildSnapshot(target, series, diffs, ledger, invSummary, latestBugs)` → DomainSnapshot object
- `buildWeekFindings(target, summary, bugs)` → WeeklyFindings object
- `writeApiFiles(docsDir, domainEntries, weekEntries)` → writes all files to `docs/api/v1/`

Unit tests cover all four builders with synthetic inputs. No real aggregate run required.

**Owned files**: `src/lib/api-writer.js`, `tests/unit/api-writer.test.js`
**Requirement refs**: FR-01, FR-02, FR-03, FR-05, FR-06, FR-07, FR-08, FR-09, NFR-01, NFR-02, NFR-04

### WP02 — Wire into `src/aggregate.js`

Import `buildIndexEntry`, `buildSnapshot`, `buildWeekFindings` from `api-writer.js`. Accumulate per-domain and per-week API objects during the existing loop. Call `writeApiFiles` once at the end alongside `renderIndex`.

**Owned files**: `src/aggregate.js`
**Requirement refs**: FR-04, FR-08, C-01, C-02, C-04

### WP03 — Smoke test + CLAUDE.md update

Run `npm run aggregate` (or equivalent) against local data; confirm API files appear at `docs/api/v1/`. Validate JSON structure of index, snapshot, and findings files. Update `CLAUDE.md` with `docs/api/v1/` output documentation.

**Owned files**: `CLAUDE.md`
**Requirement refs**: NFR-02, NFR-03
