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
- [x] All 91 unit tests pass.

## Out of scope

- Scoring or weighting these checks in the priority-pages composite score.
- Alerting or CI gating on check results.
- Checking `robots.txt` (already handled by `src/lib/robots.js`).
