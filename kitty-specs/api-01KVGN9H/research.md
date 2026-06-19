# Research: Static JSON API for Scan Results

**Mission**: api-01KVGN9H
**Date**: 2026-06-19

---

## Key Decisions

### D-01: Static files over a live server

**Decision**: All API endpoints are pre-built static JSON files written during `npm run aggregate`.

**Rationale**: vital-core already has a GitHub Actions pipeline that runs aggregate and deploys `docs/` to GitHub Pages. A static API requires zero infrastructure changes, zero new dependencies, and works within existing deployment constraints. A live server would need hosting, auth, CORS handling, and a separate deploy pipeline — none of which is justified for read-only scan data that changes at most weekly.

**Evidence**: `src/aggregate.js` already writes `docs/data/<domain>/domain.json` and `docs/data/<domain>/weekly.json` as public JSON files. This API is the same pattern with a versioned path and consistent schema.

---

### D-02: Versioned path `/api/v1/` with `schema_version` in every response

**Decision**: All files live under `docs/api/v1/` and every response includes `"schema_version": "1"`.

**Rationale**: Putting a version in the URL path allows `v2` to coexist without breaking existing consumers. The in-response `schema_version` field lets consumers detect structural changes even when the URL hasn't changed (e.g. a new required field added within v1). Both together give consumers two escape hatches.

---

### D-03: New `src/lib/api-writer.js` module, not inline in `src/aggregate.js`

**Decision**: Extract all API-writing logic into a dedicated `src/lib/api-writer.js` module that `src/aggregate.js` imports.

**Rationale**: `src/aggregate.js` is already 330+ lines. Adding API writes inline would push it past readable size and make unit testing harder. A dedicated module follows the existing `src/lib/` pattern (csv.js, ai-findings.js, etc.), is independently testable, and keeps blast radius small.

---

### D-04: Domain key as URL path segment (not a generated slug)

**Decision**: Use `target.key` (e.g. `www.cms.gov`) as the directory name under `/api/v1/`.

**Rationale**: `target.key` is already used as the directory name under `docs/reports/` and `docs/data/`. Using the same value keeps URL structure consistent with existing report URLs and requires no additional mapping. Domain keys are valid URL path segments (hostnames contain only `a-z`, `0-9`, `-`, `.`).

---

### D-05: `snapshot.json` uses existing `domain.json` content shape

**Decision**: `snapshot.json` mirrors the current `domain.json` content with added `schema_version` and restructured `summary` block.

**Rationale**: `domain.json` already contains findings, ledger, trends, inventory, tech associations. Reusing this shape means no new data aggregation logic — just a thin wrapper. The main changes are: (1) move to `/api/v1/` path, (2) add `schema_version`, (3) add a `summary` object with pre-computed severity counts for easy CI consumption.

**Existing shape** (from `src/aggregate.js:294-316`):
```js
{
  domain, generatedAt, latestWeek, latestScore,
  inventorySummary, pages, findings, techFindings,
  weekly: { series, diffs }
}
```

**API snapshot adds**: `schema_version`, `summary.critical_count`, `summary.serious_count`, `summary.pages_scanned`.

---

### D-06: Per-week `findings.json` derived from `bugs` + `ledger` already in memory

**Decision**: The weekly findings endpoint is built from the `bugs` array (already computed for the HTML report) plus trend data from the ledger — no re-reading of data files.

**Rationale**: By the time aggregate processes a week, it has `bugs`, `ledger`, and `summary` in memory. The findings file can be assembled at zero I/O cost. Each finding includes `rule_id`, `severity`, `wcag_sc`, `pages_affected`, `trend.status`, and `finding_id` — enough for CI gates and dashboards.

---

### D-07: Index built after all domains are processed

**Decision**: `index.json` is written once at the end of the aggregate loop, after all domains have been processed.

**Rationale**: `src/aggregate.js` already does this pattern: `dashboard` is accumulated per-domain, then `renderIndex(dashboard, ...)` is called at the very end. The API index follows the same pattern, accumulating `{ domain, key, latest_week, critical_count, serious_count, pages_scanned, snapshot_url }` per domain and writing once.

---

## Risks and Open Questions

- **Size**: `domain.json` for large sites (cms.gov, nih.gov) may exceed the 5 MB soft cap from `ai-findings.js`. The snapshot should omit the full `pages` inventory array (can be thousands of URLs) or truncate it. This needs a decision during WP01 implementation — default: omit `pages` from snapshot, provide `page_count` instead.
- **VA domain guard**: The existing `scan.yml` guard uses `.filter(t => !t.hf_only)` — aggregate already skips VA domains when run in CI. No additional guard needed in the API writer.
- **`docs/api/` in gitignore**: `docs/` is already gitignored locally. No change needed.
