# AGENTS Guide for Vital Core

This file defines how AI coding agents should work in this repository.

## Mission

Build and maintain a government web quality scanner that produces
high-confidence, accessible, and actionable findings, **tuned
specifically for tracking continuous improvement, weekly trends, and
historical remediation** across US government sites.

## Operating Priorities

1. **Continuous Accessibility Tracking**: Prioritize week-over-week trends, progress, and regression tracking over isolated, single-run reports (WCAG 2.0 AA for federal, WCAG 2.1 AA for state/local).
2. **Reliable, Deterministic Data**: Outputs must generate stable identifiers (page identity, rule ids) so findings can be deduplicated and compared cleanly across weekly scan boundaries.
3. **Historical Evidence**: Preserve historical data integrity to prove when issues were introduced and resolved. Weekly summaries are kept forever; page-level detail is pruned after `retention_weeks`.
4. **Actionable Remediation**: Provide practical developer guidance that helps teams clear their weekly backlog.
5. **Efficient Scanning**: Optimize scanning of high-value pages to support recurring, automated weekly schedules without bloated resource consumption.

## Architecture

The system runs on GitHub Actions with no server and no database. The
core rule: **files are the only state, data is append-only, and reports
are pure functions of the data directory.**

- `src/scan.js` — one scan run for one domain. Loads state, picks a
  batch of pages not yet scanned this ISO week, runs the engines, writes
  one JSON record per page under `data/<domain>/<week>/pages/`, and
  discovers same-host links into `state/<domain>/crawl.json`.
- `src/aggregate.js` — pure function of `data/`. Computes weekly
  summaries, writes `data/<domain>/<week>/summary.json` (committed) and
  the generated site under `docs/` (never committed; shipped as a Pages
  artifact).
- `src/prune.js` — removes page-level detail older than
  `retention_weeks`; summaries survive.
- `src/issue-comment.js` — posts the weekly Markdown summary to a
  tracking issue.
- `src/lib/` — shared, frozen contracts: URL identity (`urls.js`), ISO
  weeks (`week.js`), crawl state (`state.js`), robots (`robots.js`),
  sitemap discovery (`sitemap.js`), config (`config.js`).

## Scan Engine Inventory

Every URL in the batch is processed by the engines listed in the
target's `engines` config (default: all three). Each engine writes a
compact, comparison-friendly record onto the per-page JSON.

| Engine file | Tool | What it produces |
|-------------|------|------------------|
| `src/engines/axe.js` | **axe-core** (injected into the page) | WCAG 2.x / Section 508 violations, reduced to rule ids, counts, and pages affected (full node lists are not stored). |
| `src/engines/alfa.js` | **Siteimprove Alfa** (`@siteimprove/alfa-*`) | Independent ACT-rules audit. Alfa is the open source core of Siteimprove's commercial checker. |
| `src/engines/sustainability.js` | **co2.js** (`@tgwf/co2`, SWD model v4) | Page weight (decoded body bytes) and estimated emissions. |

Both axe and Alfa run on every page by default for cross-engine
coverage. Engines are selected per target via the `engines:` key in
`config/targets.yml`.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `VITAL_WEEK` | Pin the ISO week (e.g. `2026-W23`). Used by the e2e test for determinism; normally derived from the run date. |
| `VITAL_A11Y_SETTLE_DELAY_MS` | Override `settle_delay_ms` — the wait after page load before auditing, which lets client-side hydration finish and removes transient false positives. |

Most behavior is configured per target in `config/targets.yml`
(`pages_per_run`, `max_pages_per_week`, `delay_ms`, `nav_timeout_ms`,
`settle_delay_ms`, `retention_weeks`, `engines`, `user_agent`), not via
environment variables.

## Repository Rules for Agents

1. **Plain Node, no build step, no TypeScript.** Source is `.js` under `src/` and runs directly with `node`. Do not reintroduce a build step, TypeScript, or a database.
2. **Preserve schema compatibility.** Never introduce breaking changes to the per-page JSON record or `summary.json` without a migration plan — breaking changes destroy historical weekly trend graphs.
3. **Stable identity.** `src/lib/urls.js` defines page identity everywhere; treat it as a frozen contract. Week-over-week comparison depends on it.
4. Keep changes small, reviewable, and test-backed.
5. Prefer host-scoped, HTML-focused discovery by default.
6. Include tests for behavior changes in discovery, scanning, or aggregation.
7. Avoid broad refactors unless requested.

## Testing

- `npm run test:unit` — `node --test` over `tests/unit/` (URL identity, ISO weeks, robots.txt parsing, batch picking).
- `npm run test:e2e` — full pipeline over a local fixture site simulating two weeks, asserting week-over-week diffs. Requires Playwright's bundled Chromium (`npx playwright install chromium`).

## Prompting Pattern for Agents

When making changes, always include:

1. Objective (How does this improve the weekly scan experience?)
2. In-scope files
3. Acceptance criteria (including backward compatibility of data records)
4. Validation steps (run `test:unit`; run `test:e2e` for pipeline changes)
5. Rollback plan

## Review Checklist

1. Does this improve or preserve accessibility outcomes?
2. **Does this keep outputs reproducible and stable for week-over-week comparisons?**
3. Are findings actionable for engineers?
4. Are tests updated and passing?
5. Is the scan load proportionate to user value, given this runs on a recurring weekly schedule?
6. Does it stay within the plain-JS, no-build, no-database architecture?
