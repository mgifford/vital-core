# Implementation Plan: Static JSON API for Scan Results

**Branch**: `public-interest-checks` | **Date**: 2026-06-19 | **Spec**: [spec.md](spec.md)
**Input**: `kitty-specs/api-01KVGN9H/spec.md`

## Summary

Extend `src/aggregate.js` to write a versioned static JSON API under `docs/api/v1/` during each aggregate run. Three endpoint families: a global index, per-domain snapshots, and per-domain/per-week findings. No server, no new dependencies — pure file writes alongside existing HTML report output.

## Technical Context

**Language/Version**: Node.js ESM ≥20
**Primary Dependencies**: Node.js built-in `fs`, `path` — already used in `src/aggregate.js`
**Storage**: Static files in `docs/api/v1/` (gitignored locally, deployed via GitHub Pages artifact)
**Testing**: Node built-in test runner; unit tests for new helper functions
**Target Platform**: GitHub Pages (static file hosting)
**Performance Goals**: Aggregate build time increase ≤5%; each API file ≤5 MB
**Constraints**: Static files only; no server; no new npm dependencies
**Scale/Scope**: One findings file per domain/week + one snapshot per domain + one global index

## Charter Check

- ✓ No new npm dependencies (NFR-04)
- ✓ VA domains excluded from output via existing `hf_only` guard (C-04 / security)
- ✓ All 91 unit tests must continue to pass (NFR-02)
- ✓ Output written to `docs/` (gitignored locally, deployed as GitHub Pages artifact)

## Project Structure

```
src/
├── aggregate.js          # Extended to call writeApiFiles
└── lib/
    └── api-writer.js     # New: builds and writes API JSON files

docs/api/v1/              # Generated output (gitignored locally)
├── index.json
├── www.cms.gov/
│   ├── snapshot.json
│   └── 2026-W25/
│       └── findings.json
└── ...

tests/unit/
└── api-writer.test.js    # Unit tests for api-writer helpers

kitty-specs/api-01KVGN9H/
├── spec.md
├── plan.md               # This file
├── research.md
├── data-model.md
└── tasks/
```

**Structure Decision**: Single project. New `src/lib/api-writer.js` module wired into `src/aggregate.js` — consistent with the existing engine module pattern, minimal blast radius.

## Work Packages (outline)

### WP01 — `src/lib/api-writer.js` + unit tests

Build the module that constructs and writes the three API response shapes:
`buildIndex()`, `buildSnapshot()`, `buildFindings()`, and `writeApiFiles()`.

**Owned files**: `src/lib/api-writer.js`, `tests/unit/api-writer.test.js`

### WP02 — Wire into `src/aggregate.js`

Import `writeApiFiles` and call it per-domain (snapshot + findings) and globally (index).

**Owned files**: `src/aggregate.js`

### WP03 — Smoke test + docs

Verify full pipeline: run aggregate, confirm API files at expected paths, validate JSON.
Update `CLAUDE.md` with `docs/api/v1/` output note.

**Owned files**: `CLAUDE.md`
