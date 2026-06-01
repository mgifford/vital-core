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
- Dominant domain jump selector in the dashboard header.
- Footer attribution and non-affiliation statement across generated pages.
- Software detections table with per-URL visibility.
- Dedicated failures view with:
	- Failed/timeout/blocked pages
	- Skipped unchanged pages
	- PDF/DOCX guardrail visibility
	- Discovery-time non-HTML exclusions

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

### Governance and Documentation

- Finalize retention/versioning policy for API and run artifacts.
- Keep user-facing docs aligned with current workflow behavior and runtime limits.
