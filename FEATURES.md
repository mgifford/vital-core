# Features Status

This file tracks what is currently working in VITAL-Core and what is
still being implemented.

## Known To Work

### Scanning and Discovery

- Config-driven target scanning across multiple domains (`config/targets.yml`).
- Sitemap discovery, seeded from the sitemap and homepage when crawl state is empty.
- HTML-first discovery: off-host links and non-HTML resources (PDF, DOCX, media, etc.) are filtered out by the URL normalizer.
- BFS crawl from seeds up to `max_crawl_depth`, discovering same-host links as pages are scanned.
- Stable page identity via a single URL normalization function (`src/lib/urls.js`), so a page is recognized as the same page week over week.

### Incremental and Runtime Controls

- ISO-week datasets: pages scanned any day of the same week belong to one dataset; pages already scanned this week are not rescanned.
- Per-run budget (`pages_per_run`, overridable with `--budget`) and a hard weekly cap (`max_pages_per_week`). Coverage accumulates across runs into one weekly dataset per domain.
- Politeness: configurable `delay_ms` between page loads, honored alongside `robots.txt` `Crawl-delay`.
- Accessibility hydration settle delay (`settle_delay_ms`, overridable with `VITAL_A11Y_SETTLE_DELAY_MS`) before auditing, to reduce transient client-side timing false positives.

### Auditing and Data Collection

Engines are selected per target via the `engines:` key. Each writes a compact record onto the per-page JSON.

- **axe-core** (`src/engines/axe.js`): WCAG 2.x / Section 508 accessibility audit, injected into the page via Playwright. Stores rule ids, counts, and pages affected — not full node lists — so records stay small and comparable week over week.
- **Alfa** (`src/engines/alfa.js`): Independent ACT-rules accessibility audit via Siteimprove Alfa (`@siteimprove/alfa-*`), the open source core of Siteimprove's commercial checker. Runs alongside axe for cross-engine coverage.
- **Plain language** (`src/engines/plain-language.js`): Readability of the main content — Flesch Reading Ease, Flesch-Kincaid grade, average sentence length, long-sentence and passive-voice heuristics, word count, and acronyms used without an on-page expansion. Pages with too little prose to score honestly report `scored: false` rather than a misleading grade.
- **Sustainability** (`src/engines/sustainability.js`): Page weight (decoded body bytes seen by the browser) and estimated CO₂ via co2.js using the Sustainable Web Design model (v4).
- **Lighthouse** (`src/engines/lighthouse.js`, opt-in): Google Lighthouse performance, accessibility, best-practices, and SEO scores (plus the experimental agentic-browsing category when enabled). Runs its own headless Chrome, so it is **sampled** — a capped number of pages per run (`VITAL_LIGHTHOUSE_SAMPLE`, default 5) — while the other engines run on every page. Enable by adding `lighthouse` to a target's `engines`.
- **Link checking** (`src/lib/links.js`, via the `link-check` engine): collects every link seen on scanned pages and probes a capped, deduplicated sample (`VITAL_LINK_CHECK_CAP`, default 500) with polite per-host pacing, recording broken links (4xx/5xx, DNS failures, timeouts). 401/403/429 are treated as soft-OK to avoid bot-challenge false positives.

### Reporting and Dashboard

- Static site generated to `docs/` by `src/aggregate.js` — a pure function of `data/`. Never committed; shipped as a GitHub Pages artifact, so it cannot drift from the data.
- `docs/index.html` — dashboard with latest-week and trend views.
- `docs/reports/<domain>/<week>/index.html` — per-domain weekly report pages.
- `docs/data/<domain>/weekly.json` — reusable trend series (summaries + week-over-week diffs) per domain.
- `data/<domain>/<week>/summary.json` — the weekly rollup, committed so trend history survives page-level pruning.
- Weekly Markdown summary posted to the "Weekly scan reports" tracking issue (`src/issue-comment.js`).

### Data Retention

- Page-level detail (`data/<domain>/<week>/pages/*.json`) is pruned after `retention_weeks` by `src/prune.js`.
- Weekly `summary.json` files are kept forever, so trend graphs never break.

### Test Coverage

- `npm run test:unit` (`node --test`): URL identity/normalization, ISO week math, robots.txt parsing, and batch picking.
- `npm run test:e2e`: full pipeline over a local fixture site across two simulated weeks, asserting week-over-week improvement is reported.

## In Progress

### Throughput and Pipeline Performance

- Increase effective scan throughput while preserving politeness and reliability.
- Tune per-target concurrency and delay settings.

### Failures and Operational Visibility

- Expand failure reporting to clarify bottleneck attribution (timeouts, WAF behavior, skipped reasons).

### Reporting Improvements

- Continue refining report navigation and cross-links across generated pages.
- Clearer throughput and ETA indicators tied to real run cadence.

### Governance and Documentation

- Finalize retention/versioning policy for committed artifacts.
- Keep user-facing docs aligned with current workflow behavior.
