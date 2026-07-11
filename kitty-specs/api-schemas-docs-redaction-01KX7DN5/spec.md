# Spec: JSON API — Schemas, Docs, and Redaction Proof

**Mission**: `api-schemas-docs-redaction-01KX7DN5`
**Branch**: `main`
**Status**: Draft

---

## Purpose

The static JSON API under `docs/api/v1/` already ships (mission `api-01KVGN9H`).
This mission closes the remaining gaps from issue
[#136](https://github.com/mgifford/vital-core/issues/136) that turn that API
into a durable public contract: published JSON Schemas, human-readable API
documentation, and a proven redaction boundary so no excluded or sensitive URL
data leaks into the published API files.

This mission does **not** rebuild the API and does **not** change the shipped
endpoint layout. It builds on top of `src/lib/api-writer.js` as-is.

## Problem Statement

The shipped API has `schema_version: "1"` on every document but no published
JSON Schemas — consumers cannot validate responses or detect field-level drift.
There is no `API.md` and no README section, so the API is undiscoverable outside
`CLAUDE.md`. Most importantly, the bug set fed into the API
(`buildWeekFindings` / `buildSnapshot` in `src/aggregate.js`) honors the
**scan-time** `url_exclude` filter (those URLs are never fetched) but does **not**
pass through the **render-time** `url_exclude_patterns` baseline
(`filterBugsByExclusion` in `src/report-html.js`, applied only to the HTML path).
A URL a config author configured to be hidden-but-still-scanned can therefore
still appear in the JSON API. There is no test asserting excluded-URL or
sensitive-query values are absent under `docs/api/`.

## Shipped layout (do not change)

```
/api/v1/index.json                          — all domains, latest stats
/api/v1/<domain-key>/snapshot.json          — full domain snapshot + weekly series/diffs
/api/v1/<domain-key>/<week>/findings.json   — per-week normalized findings
```

`<domain-key>` matches the `key` field in `config/targets.yml`.

---

## Functional Requirements

| ID | Requirement | Status |
|---|---|---|
| FR-01 | Publish JSON Schemas under `docs/api/v1/schema/` for each shipped resource type: `index.json`, `snapshot.json`, and `<week>/findings.json` | Proposed |
| FR-02 | Schemas define required fields, the `schema_version` constant, stable-identifier fields (`domain`, `key`, `finding_id`, `rule_id`, `week`), and document each field's meaning | Proposed |
| FR-03 | A unit test validates representative generated fixtures against the published schemas; validation failures fail the build/test run | Proposed |
| FR-04 | Add `API.md` documenting purpose, versioning policy, the shipped endpoints, schema locations, retention, redaction rules, partial-data semantics, working `curl` + `fetch` examples, and known limitations | Proposed |
| FR-05 | Add a short README section linking to `API.md` | Proposed |
| FR-06 | The bug set feeding `buildWeekFindings` / `buildSnapshot` / `buildIndexEntry` honors the config `url_exclude_patterns` baseline, matching the HTML report (reuse `filterBugsByExclusion`; do not fork the logic) | Proposed |
| FR-07 | A reusable redaction step strips URL fragments and redacts sensitive query-parameter values (token/key/session/auth/email/id families, plus a configurable denylist) from any URL emitted in API files, using an explicit `[REDACTED]` marker | Proposed |
| FR-08 | A test asserts that, for fixture data containing an excluded URL and a sensitive query parameter, neither the excluded URL nor the sensitive value appears anywhere under `docs/api/` | Proposed |

## Non-Functional Requirements

| ID | Requirement | Status |
|---|---|---|
| NFR-01 | No new npm dependencies. If a JSON Schema validator is needed for tests, prefer a hand-rolled minimal validator or the smallest already-available option; document the choice | Proposed |
| NFR-02 | All existing unit tests continue to pass; `npm run test:unit` and `npm run test:e2e` green | Proposed |
| NFR-03 | API aggregate numbers still match the corresponding HTML report after FR-06 (exclusion parity must not desync API from report) | Proposed |
| NFR-04 | Deterministic output preserved; schemas and docs add no per-build churn beyond existing `generated_at` behavior | Proposed |

## Constraints

| ID | Constraint | Status |
|---|---|---|
| C-01 | Static files only — no server, no runtime validation service | Accepted |
| C-02 | Do not change canonical URL normalization, ISO-week grouping, retention semantics, existing report URLs/anchors, or the shipped API endpoint paths | Accepted |
| C-03 | Reuse existing normalized data and `filterBugsByExclusion`; do not create a second reporting-calculation path | Accepted |
| C-04 | `docs/` remains a gitignored build artifact; schema files are generated/copied into `docs/api/v1/schema/` at aggregate time (source of truth lives under `src/`) | Accepted |

## Out of Scope (defer to separate issues)

- `rules.json` rule catalogue.
- `pages/<page-id>.json` page-level evidence (highest privacy risk — its own issue).
- MCP / WebMCP adapters, OpenAPI docs, filtering service.

---

## User Scenarios & Testing

### Scenario 1: Consumer validates a response against the schema
A dashboard author fetches `/api/v1/index.json` and validates it against
`/api/v1/schema/index.schema.json` in CI to detect breaking changes.
**Acceptance**: The schema exists at a stable URL and the shipped `index.json`
validates against it.

### Scenario 2: Excluded URL never leaks into the API
A target configures `url_exclude_patterns` to hide `/private-preview/` from the
report. That URL is scanned but must not appear in any API file.
**Acceptance**: With fixture data containing a `/private-preview/` page and a
`?token=SECRET` query, no build produces that URL or `SECRET` anywhere under
`docs/api/`.

### Scenario 3: Developer discovers the API from the repo
A new contributor reads `API.md` and copies a working `curl` example.
**Acceptance**: `API.md` exists, is linked from README, and its examples target
the shipped endpoint paths.

---

## Success Criteria

1. JSON Schemas for all three shipped resources are published and validated in tests.
2. `API.md` documents the shipped API accurately; README links to it.
3. The API's bug set honors `url_exclude_patterns` parity with the HTML report.
4. URL fragments and sensitive query values are redacted from API files.
5. A test proves excluded-URL and sensitive-query values are absent under `docs/api/`.
6. All existing tests remain green; no new dependencies.

## Sustainability Acceptance Criterion

No client-side JavaScript or data-transfer added — this is build-time schema
generation, static docs, and a redaction pass over already-generated files.
`API.md` is plain Markdown with no fonts/scripts. Within the no-web-fonts /
static budget.

---

## Key Entities

| Entity | Description |
|---|---|
| `index.schema.json` | Schema for the domain index resource |
| `snapshot.schema.json` | Schema for the per-domain snapshot resource |
| `findings.schema.json` | Schema for the per-week findings resource |
| redaction utility | Reusable fragment-strip + query-value redaction with `[REDACTED]` marker and configurable denylist |

## Assumptions

- `filterBugsByExclusion` is the single source of truth for render-time
  exclusion and can be reused by the aggregate API feed without behavioral change.
- JSON Schema draft choice will be pinned in `plan.md`; a minimal in-repo
  validator is acceptable if it avoids a new dependency.
