# Spec: Static JSON API for Vital-Core Scan Results

**Mission**: `api-01KVGN9H`
**Branch**: `public-interest-checks`
**Status**: Draft

---

## Purpose

Publish the full vital-core scan dataset as a structured, versioned static JSON API alongside the existing HTML reports on GitHub Pages. Consumers — external dashboards, CI/CD pipelines, and internal scripts — can fetch structured accessibility and sustainability findings for any scanned domain without parsing HTML or accessing raw data files directly.

## Problem Statement

Currently, vital-core publishes human-readable HTML reports and some ad-hoc JSON files (domain.json, weekly.json, ai-findings.json). There is no stable, versioned, documented API contract. Consumers must know internal file paths and data shapes that can change at any time. This makes integration fragile and undiscoverable.

## Target Users / Consumers

- **External tools and dashboards**: Pull findings to build custom visualizations or alerts
- **CI/CD pipelines**: Query scan results to enforce quality gates (e.g. fail a build if Critical findings increased)
- **Internal scripts**: Access structured data without coupling to internal aggregate.js internals

---

## Functional Requirements

| ID | Requirement | Status |
|---|---|---|
| FR-01 | A machine-readable index at a stable URL lists all available domains and their latest scan week | Proposed |
| FR-02 | Each domain exposes a full snapshot endpoint containing findings, trend series, inventory summary, tech associations, and third-party risks (equivalent to current domain.json content) | Proposed |
| FR-03 | Each domain exposes a per-week findings endpoint containing that week's accessibility findings with severity, WCAG mapping, pages affected, and trend status | Proposed |
| FR-04 | All API endpoints are published as static JSON files to GitHub Pages during the existing `aggregate` build step — no separate server or deployment pipeline required | Proposed |
| FR-05 | API responses include a `schema_version` field so consumers can detect breaking changes | Proposed |
| FR-06 | A stable base path (`/api/v1/`) is used for all endpoints so future versions can coexist | Proposed |
| FR-07 | An `index.json` at `/api/v1/index.json` lists all domains with their latest week, page count, critical/serious finding counts, and a link to the domain snapshot | Proposed |
| FR-08 | The aggregate build writes API files to `docs/api/v1/` alongside existing `docs/reports/` output | Proposed |
| FR-09 | API JSON files are human-readable (pretty-printed) to aid debugging and curl-based access | Proposed |

## Non-Functional Requirements

| ID | Requirement | Status |
|---|---|---|
| NFR-01 | Each API file is ≤5 MB so it loads within GitHub Pages size limits and remains usable in browser fetch calls | Proposed |
| NFR-02 | All 91 unit tests continue to pass after changes; new unit tests cover any new aggregate/API-writing logic | Proposed |
| NFR-03 | The aggregate build time increases by no more than 5% (API file writes are sequential, not parallelised) | Proposed |
| NFR-04 | No new npm dependencies are introduced | Proposed |

## Constraints

| ID | Constraint | Status |
|---|---|---|
| C-01 | Output is static files only — no server, no dynamic routing, no serverless functions | Accepted |
| C-02 | API files are written by `src/aggregate.js` using the existing Node.js fs module — no new build tooling | Accepted |
| C-03 | `docs/` is gitignored locally and deployed as a GitHub Actions artifact — API files follow the same lifecycle | Accepted |
| C-04 | VA domain data is gitignored and never committed; API files for VA domains must not appear in the published output when running locally | Accepted |

---

## User Scenarios & Testing

### Scenario 1: External dashboard fetches the index

A developer building a government accessibility dashboard fetches `/api/v1/index.json` and gets a list of all scanned domains with their latest scan week and critical finding counts. They use this to populate a domain selector without knowing which domains vital-core tracks.

**Acceptance**: `GET /api/v1/index.json` returns valid JSON with at least one domain entry containing `domain`, `latest_week`, `critical_count`, `serious_count`, `pages_scanned`, and `snapshot_url`.

### Scenario 2: CI pipeline enforces a quality gate

A CI pipeline for cms.gov fetches `/api/v1/www.cms.gov/snapshot.json` after each release and fails the build if `summary.critical_count` has increased since the previous run.

**Acceptance**: Snapshot endpoint exists at a predictable URL, contains a `summary` block with severity counts, and is valid JSON parseable without any HTML stripping.

### Scenario 3: External tool accesses weekly findings

A remediation tracking tool fetches `/api/v1/www.cms.gov/2026-W25/findings.json` to get the findings for a specific week, including which findings are new vs. persistent.

**Acceptance**: Weekly findings endpoint exists, contains a `findings` array with `rule_id`, `severity`, `pages_affected`, and `trend.status` per finding.

### Scenario 4: Consumer detects a schema change

A consumer checking the response notices `schema_version` has changed from `1` to `2` and knows to update their parser before proceeding.

**Acceptance**: Every API response contains a top-level `schema_version` field with a stable string value.

---

## Success Criteria

1. A developer can discover all scanned domains and their latest data with a single HTTP GET to a documented, stable URL — without reading vital-core source code or HTML reports.
2. All API endpoints are reachable on GitHub Pages within the standard aggregate + deploy cycle — no additional workflow steps required.
3. A CI/CD pipeline can programmatically detect whether Critical accessibility findings have increased for a given domain and week by parsing a single JSON file.
4. The `schema_version` field allows consumers to detect breaking changes without out-of-band notification.

---

## Key Entities

| Entity | Description |
|---|---|
| `index` | Top-level listing of all domains with summary stats and links |
| `snapshot` | Full domain dataset — findings, trends, inventory, tech, third-party |
| `findings` | Per-week accessibility findings with severity, WCAG mapping, and trend |
| `schema_version` | Stable version string present in every API response |

---

## URL Structure

```
/api/v1/index.json                          — all domains, latest stats
/api/v1/<domain-key>/snapshot.json          — full domain snapshot (latest week)
/api/v1/<domain-key>/<week>/findings.json   — weekly findings for one domain
```

`<domain-key>` matches the `key` field in `config/targets.yml` (e.g. `www.cms.gov`).

---

## Assumptions

- GitHub Pages is the only deployment target; no server-side API is in scope.
- The existing `domain.json` and `weekly.json` content is sufficient raw material for the API responses — no new scan data is needed.
- `<domain-key>` values are safe to use in URL paths (they are hostnames, already URL-safe).
- API files are regenerated fully on every aggregate run (no incremental / partial updates).
