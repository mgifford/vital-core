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
| `src/engines/plain-language.js` | text analysis (in-page) | Readability (Flesch / Flesch-Kincaid), sentence/passive-voice heuristics, unexplained acronyms. `scored: false` when there's too little prose. |
| `src/engines/deprecated-html.js` | DOM query (in-page) | Obsolete/legacy HTML (`<font>`, `<center>`, `<marquee>`, presentational attrs). Example of a rate-controlled scanner. |
| `src/engines/sustainability.js` | **co2.js** (`@tgwf/co2`, SWD model v4) | Page weight (decoded body bytes) and estimated emissions. |
| `src/engines/lighthouse.js` | **Google Lighthouse** (own Chrome) | Performance / accessibility / best-practices / SEO / agentic-browsing scores. Drives its own browser. |
| `src/engines/images.js` | DOM eval + response interceptor | Per-page image inventory: src, alt text, dimensions, loading/decoding attrs, byte size, decorative/missing-alt flags. Capped at 500 images/page. |
| `src/engines/tech.js` | **HTTPArchive/wappalyzer** (vendored, GPL-3.0) | Technology fingerprinting from in-page signals; aggregated by highest confidence across sampled pages. Update via `scripts/update-wappalyzer.sh`. |
| `src/lib/links.js` (`link-check`) | `fetch` HEAD/GET probes | Broken links (4xx/5xx, DNS, timeout) found on sampled pages, checked once per run, capped and polite. |

#### Weekly sampling rates

Each engine has a weekly coverage rate set in one place,
`config/targets.yml` under `sampling:` (e.g. `axe: 100`, `alfa: 30`,
`lighthouse: 10`). The rate is the share of the week's unique pages an
engine runs on; `0` or omitted disables it. Selection is **deterministic
per page** (`src/lib/sampling.js`: a stable hash of `pageId + engine +
week`), so coverage is reproducible, stable within a week, and
independent per engine. A target may override individual rates with its
own `sampling:` block.

**Adding a scanner** (the single, well-defined extension point): write an
engine module in `src/engines/` returning a compact `{ engine, ...,
rules: { ruleId: { count, help, examples } } }` record, dispatch it in
`src/scan.js` behind `runs('<name>')`, aggregate its rules in
`src/aggregate.js`, and add a rate line under `sampling:`. The
deprecated-html engine is a complete worked example.

#### Page selection: priority + weekly sampling

`pickBatch` (`src/lib/state.js`) decides which pages each run scans, with
one hard rule: **no URL is scanned more than once per ISO week** (pages
already scanned this week are excluded, so coverage accumulates across
the week's runs without repeats). Within that:

1. **Priority URLs first.** A target's `priority_urls` / `priority_urls_file`
   (top tasks, e.g. from top-task-finder — one URL per line, `#` comments
   ok) are seeded at depth 0 with `priority: true` every run and scanned
   before anything else, so they're always covered early in the week.
2. **Then never-scanned before previously-scanned**, for trend freshness.
3. **Then a stable per-week random order** (hash of `pageId + week`), so a
   large site gets a different random sample each week instead of the same
   shallow pages — reproducible within a week for replay.

`importance` (1–5, default 3) per target scales `max_pages_per_week`
(3 = the configured cap, 1 = a third, 5 = 5/3) so low-value domains
(near-identical open-data sites) consume less weekly budget than key
ones.

#### Findings ledger

`data/<domain>/findings.json` (committed) tracks every unique finding by
`pattern_id` with `firstSeen` / `lastSeen` / `weeksSeen`, accumulated
across the domain's whole history (survives page-detail pruning). Updated
by `src/lib/findings.js` during aggregation; surfaced as first/last-seen
in bug reports.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `VITAL_WEEK` | Pin the ISO week (e.g. `2026-W23`). Used by the e2e test for determinism; normally derived from the run date. |
| `VITAL_A11Y_SETTLE_DELAY_MS` | Override `settle_delay_ms` — the wait after page load before auditing, which lets client-side hydration finish and removes transient false positives. |
| `VITAL_LINK_CHECK_CAP` | Override the per-run broken-link probe cap (default 500). |

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
