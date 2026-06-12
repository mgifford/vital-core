# Features Status

This file tracks what is currently working in VITAL-Core and what is still being implemented.

## Known To Work

### Scanning and Discovery

- Profile-driven target scanning across multiple domains.
- Sitemap discovery with include-path filtering.
- HTML-first discovery: non-HTML resources are filtered out (including `.pdf` and `.docx`).
- Priority URL injection to ensure high-value pages are always considered.
- Optional unique-page focus mode to reduce template-heavy duplicates.

### Incremental and Runtime Controls

- Incremental page-state caching with unchanged-page skip behavior.
- Revalidation windows and recency prioritization controls.
- Runtime budget enforcement for scheduled runs.
- Round-robin target scanning to distribute load across domains.
- Accessibility-only hydration settle delay control (`VITAL_A11Y_SETTLE_DELAY_MS`) to reduce transient client-side timing false positives before live axe audits.

### Auditing and Data Collection

- **axe-core** (always): Live WCAG 2.x / Section 508 accessibility audit via Playwright in-browser, run on every page regardless of scope setting.
- **Alfa** (always): Independent ACT-rules accessibility audit via Siteimprove Alfa CLI (`node_modules/.bin/alfa`) against the local HTML snapshot (written before workers run) to avoid a redundant HTTP fetch. Runs alongside axe on every page for cross-engine issue coverage. Requires `@siteimprove/alfa-formatter-json` installed and `VITAL_ALFA_CMD` set. Output buffer is 10 MB to handle large DOM serialization.
- **Lighthouse** (full scope): Five category scores — performance (FCP, LCP, Speed Index), accessibility, SEO, best-practices, and the experimental agentic-browsing pass ratio — via Google Lighthouse against the live URL. Requires Chrome installed.
- **Wappalyzer-next** (full scope): CMS/framework/analytics tech fingerprinting via wappalyzer-next CLI using `--scan-type full`. Passes the local HTML snapshot to the tool first (avoiding a redundant HTTP fetch) and falls back to the live URL if the tool does not support file-based input. Requires `VITAL_WAPPALYZER_CMD` set. Note: the original Wappalyzer is proprietary and requires a paid license; wappalyzer-next is the open-source fork.
- **Offline / Cheerio** (full scope): Alt-text quality, ambiguous link text, readability (Flesch-Kincaid grade), USWDS presence, and accessibility overlay detection from the HTML snapshot.
- **Third-party impact** (full scope): Second axe pass with JS disabled to isolate how much tag managers, overlays, and chat widgets worsen the accessibility score.
- Technology fingerprinting with resilient command handling and fallback parsing.
- Third-party impact analysis and consensus summaries in run outputs.

### Reporting and Dashboard

- Static dashboard generation to `dist/` with latest-run, trends, and history sections.
- Domain-specific subpages (overview, accessibility, performance, content, third-party).
- Domain accessibility pages now read SQLite after the current run is appended, keeping latest-run page and issue summaries in sync with current scan output.
- Fallback domain accessibility rendering now groups pages under one synthetic run ID so multi-page runs are not collapsed to a single-row summary.
- Dominant domain jump selector in the dashboard header.
- Footer attribution and non-affiliation statement across generated pages.
- Software detections table with per-URL visibility.
- Dedicated failures view with:
	- Failed/timeout/blocked pages
	- Skipped unchanged pages
	- PDF/DOCX guardrail visibility
	- Discovery-time non-HTML exclusions

### Weekly Trend Reporting

- Weekly domain accessibility ratings (`dist/api/weekly-ratings.json`) — 7-day violation aggregates per target, scored and graded.
- Week-over-week compliance trends (`dist/api/weekly-trends.json`) — up to 12 weeks of history, oldest-first for charting.
- Top rule frequency report (`dist/api/weekly-top-rules.json`) — most frequent WCAG violations over the last 7 days.
- Run directory export (`dist/api/run-directory.json`) — latest 100 runs with page and violation counts.
- Domain accessibility grades leaderboard on the main dashboard, sourced from 7-day SQLite aggregates with per-run fallback when no history is available.

### Per-Run Detail Pages

- Per-run detail pages at `dist/runs/{runId}/index.html` generated for each run recorded in SQLite.
- Each page shows: run ID, timestamp, pages completed/skipped, total violations, quality index score, and a per-domain breakdown table (grade, score, critical/serious/moderate/minor counts, completion status).
- Run history table on the main dashboard includes a "Details" link to the per-run page alongside the existing raw JSON link.
- Backed by `SqlitePersister.queryAllTargetsForRun()` — a single-query rollup of all targets for a given run.

### API and Artifacts

- Published run artifacts under `runs/` (latest, index, trends, domain ongoing, seeds, run snapshots).
- API manifest and stable JSON endpoints under `api/` (`index`, `latest`, `runs`, `targets`).

### Test Coverage and Contracts

- Unit coverage for discovery filtering, seed behavior, dashboard generation, bug export output, and technology worker behavior.
- Workflow contract coverage for key runtime policy behavior.

## In Progress

### Throughput and Pipeline Performance

- Increase effective scan throughput while preserving politeness and reliability.
- Pipeline parallelization plan:
	- Overlap page loading with post-cache processing
	- Run more offline work concurrently after snapshot capture
	- Reduce idle time between batches
- Tune concurrency and delay settings by scan intensity window.

### Failures and Operational Visibility

- Expand failure analytics to provide clearer bottleneck attribution (timeouts, WAF behavior, skipped reasons, and queue pressure).
- Improve production diagnostics for link-gate and external endpoint instability.

### Reporting Improvements

- Continue refining bug report navigation and section-level jump links.
- Add clearer throughput and ETA indicators tied to real run cadence.
- Domain page refactoring: split domain subpages into weekly-aggregate and per-run sections (Phase 4).
- 12-week compliance trend chart using `queryWeeklyTrends()` (Phase 5).
- UX polish: breadcrumbs and cross-links across all generated pages (Phase 6).

### Governance and Documentation

- Finalize retention/versioning policy for API and run artifacts.
- Keep user-facing docs aligned with current workflow behavior and runtime limits.
