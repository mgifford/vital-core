# Spec: Weekly public-interest standards checks

**Status**: SHIPPED (2026-W25, PR #150)

## Goal

Add four origin-level weekly checks that signal whether a site meets
public-interest and sustainability expectations. Results appear in the
Standards report alongside existing web-standards checks. A quick
command-line diagnostic runs the same checks without a full scan.

## The four checks

| Check | Pass condition |
|---|---|
| Accessibility statement | A page reachable from the homepage that contains the words "accessibility statement / policy / declaration / notice / commitment" |
| carbon.txt | `<origin>/carbon.txt` exists and is parseable |
| Green Web Foundation | `api.thegreenwebfoundation.org/greencheck/<domain>` returns `green: true` |
| XML sitemap | `<origin>/sitemap.xml` (or `sitemap_index.xml` etc.) returns 200 |
| Human-readable sitemap | An HTML page at a well-known path (e.g. `/sitemap`, `/site-map`) |

## Requirements

| ID | Type | Requirement |
|---|---|---|
| FR-01 | Functional | `runPublicInterest(origin, domain, userAgent)` returns accessibility statement, carbon.txt, Green Web Foundation, and sitemap results. |
| FR-02 | Functional | Sub-checks run concurrently and convert individual failures to `result: unknown`. |
| FR-03 | Functional | `src/scan.js` runs the public-interest engine once per origin per week through sampling config. |
| FR-04 | Functional | `src/aggregate.js` writes the most recent result to `summary.publicInterest`. |
| FR-05 | Functional | `src/report-html.js` renders a Standards-page badge table when public-interest data exists. |
| FR-06 | Functional | `scripts/check-public-interest.js` runs the same checks from the CLI and supports JSON output. |
| C-01 | Constraint | No CI gate, alerting, or priority score weighting is added. |
| NFR-01 | Non-functional | Unit tests cover graceful failure and unreachable-origin no-throw behavior. |

## Acceptance criteria

- [x] `src/engines/public-interest.js` — exports `runPublicInterest(origin, domain, userAgent)`.
      Returns `{ engine, checkedAt, a11yStatement, carbonTxt, greenWebFoundation, sitemaps }`.
      Uses plain `fetch()`, no browser. Each sub-check returns `{ result: 'pass'|'fail'|'unknown', … }`.
- [x] All four sub-checks run concurrently via `Promise.all`; any individual failure
      is caught and returns `result: 'unknown'` rather than throwing.
- [x] `src/scan.js` — `public-interest` engine runs once per origin per week
      (origin-level, not page-level). Sampling rate in `config/targets.yml`: `public-interest: 10`.
- [x] `src/aggregate.js` — `publicInterestLatest` rolls up the most recent result;
      written to `summary.publicInterest`.
- [x] `src/report-html.js` — `publicInterestSection(pi)` renders a ✓/~/✗ badge table
      on the Standards page. Hidden when `pi` is null.
- [x] `scripts/check-public-interest.js` — CLI diagnostic. Usage:
      `node scripts/check-public-interest.js www.cms.gov [--json]`.
      Runs without a full scan in ~4 s. Exit code always 0 (diagnostic, not CI gate).
- [x] `package.json` — `"check:public-interest": "node scripts/check-public-interest.js"`.
- [x] `tests/unit/public-interest.test.js` — 2 tests: graceful-failure shape and
      no-throw on unreachable origin.
- [x] All unit tests pass.

## Out of scope

- Scoring or weighting these checks in the priority-pages composite score.
- Alerting or CI gating on check results.
- Checking `robots.txt` (already handled by `src/lib/robots.js`).
