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

Each engine has a **weekly coverage rate** set in one place — `config/targets.yml` under `sampling:` (e.g. `axe: 100`, `alfa: 30`, `lighthouse: 10`, `plain-language: 45`, `link-check: 90`). The rate is the share of the week's unique pages the engine runs on; selection is deterministic per page (a stable hash of page + engine + week), so coverage is reproducible and independent per engine. `0` or omitted disables an engine. Each engine writes a compact record onto the per-page JSON.

- **axe-core** (`src/engines/axe.js`): WCAG 2.x / Section 508 accessibility audit, injected into the page via Playwright. Stores rule ids, counts, and pages affected — not full node lists — so records stay small and comparable week over week.
- **Alfa** (`src/engines/alfa.js`): Independent ACT-rules accessibility audit via Siteimprove Alfa (`@siteimprove/alfa-*`), the open source core of Siteimprove's commercial checker. Runs alongside axe for cross-engine coverage.
- **Plain language** (`src/engines/plain-language.js`): Readability of the main content (navigation/header/footer excluded) — Flesch Reading Ease, Flesch-Kincaid grade, average sentence length, long-sentence and passive-voice heuristics, **words per page**, acronyms used without an on-page expansion, and **spelling** (words not in the en dictionary or `config/spelling-allowlist.txt`, skipping numbers/acronyms/URLs). Pages with too little prose to score readability report `scored: false`.
- **Sustainability** (`src/engines/sustainability.js`): Page weight (decoded body bytes) plus both **estimated CO₂ (g)** and **energy (Wh)** per page via co2.js (Sustainable Web Design model v4). `sustainability_metric: co2 | energy` in `config/targets.yml` picks which the reports headline — both are always recorded, so switching needs no re-scan.
- **Deprecated HTML** (`src/engines/deprecated-html.js`): flags obsolete/legacy markup — `<font>`, `<center>`, `<marquee>`, `<frame>`, presentational attributes (`bgcolor`, `align`, …). A worked example of adding a rate-controlled scanner; the seed for a fuller open-site-review-style check.
- **Lighthouse** (`src/engines/lighthouse.js`): Google Lighthouse performance, accessibility, best-practices, and SEO scores (plus the experimental agentic-browsing category via `VITAL_LIGHTHOUSE_AGENTIC`). Runs its own headless Chrome; keep its sampling rate low (e.g. 10%). 
- **Link checking** (`src/lib/links.js`, via the `link-check` engine): collects links seen on sampled pages and probes a capped, deduplicated sample (`VITAL_LINK_CHECK_CAP`, default 500) with polite per-host pacing, recording broken links (4xx/5xx, DNS failures, timeouts). 401/403/429 are treated as soft-OK to avoid bot-challenge false positives.

### Cross-engine consensus (ACT-rule deduplication)

axe and Alfa both implement [W3C ACT rules](https://www.w3.org/WAI/standards-guidelines/act/rules/), so the same issue is frequently reported by both under different rule ids (axe `image-alt` and Alfa `sia-r2` are both ACT rule `23a2a8`). Reports now consolidate findings by their shared ACT rule and affected page, so a real issue is counted **once** — the dashboard shows unique issues plus how many are caught by **both** engines (highest confidence) versus axe-only / alfa-only, instead of a misleading doubled total (`src/lib/act.js`, `src/lib/consensus.js`; mapping in `src/data/act-mapping.json`, regenerable from the upstream ACT implementation reports). Unmapped rules keep their own identity and are never wrongly merged.

### Remediation tips

Bug reports include a short, plain-language "How to fix" tip per rule (`config/remediation-tips.json`, seeded for common axe and Alfa rules), shown alongside the engine's own reference URL. Add tips as you triage; unknown rules fall back to the reference link.

### Broken-link source tracking

When the link-check engine finds a broken link, the report shows which scanned page(s) link to it ("Linked from: /a, /b +3 more"), so a 404 can be traced to the pages that need fixing, not just the dead URL.

### Embedded & linked resource inventory

The audit engines only see HTML, but sites also serve PDFs, Word/PowerPoint/Excel documents, iframes, embedded videos and audio, and other non-HTML resources whose accessibility the site owner still owns. The `resources` engine (`src/engines/resources.js`) catalogs every such resource each page links to or embeds, classified by type (it inventories URLs and types; it does not fetch or audit the files). A committed per-domain ledger (`data/<domain>/resources.json`) tracks first-seen / last-seen per resource, so the report answers two questions a site owner can't otherwise: *what PDFs/embeds does this site have?* and *what was added in the last week?* (a "New this week" section, plus a full `resources.csv` with first-seen dates).

### Findings history

A committed per-domain ledger (`data/<domain>/findings.json`) tracks every unique finding by `pattern_id` with first-seen / last-seen / weeks-seen, accumulated across the domain's whole history (it survives page-detail pruning). Bug reports show when each issue was first discovered and last observed.

### Affected-page CSV exports

Every reported number is traceable to its pages. Each domain/week report writes CSVs under `docs/reports/<domain>/<week>/csv/`: one per failing rule (every affected URL + per-page instance count) plus `axe-pages-with-violations.csv` / `alfa-pages-with-failures.csv` behind the summary counts. The HTML report, the rule tables, and the bug reports all link to these so a developer can pull the full list to reproduce and fix an issue (`src/lib/csv.js`).

### Human-impact modeling

Each finding's WCAG success criterion maps to the [Section 508 Functional Performance Criteria](https://www.section508.gov/develop/mapping-wcag-to-fpc/) and on to disability groups with US population prevalence (ACS 2022), so a bug report says *who* it affects — e.g. "Affects Without vision (1.0%), Limited vision (2.4%)" — instead of an opaque placeholder (`src/lib/fpc.js`, full WCAG 2.2 A/AA mapping). When a target sets `page_loads_per_week` in config, reports also show a rough estimated-people-excluded figure (prevalence × loads × share of pages affected). Without page-load data, only prevalence percentages are shown — no fabricated counts.

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

### Rolling site inventory (all pages ever scanned)

Because each week only scans a sampled slice and page detail is pruned, a committed per-domain `data/<domain>/inventory.json` records the **last-known status of every URL ever scanned** — last week, status, and axe/Alfa counts — accumulated over time and surviving pruning (`src/lib/inventory.js`). This answers "what's the known state of the *whole* site?" and "how many known pages have issues?", not just this week's sample. Domain reports cite the totals (e.g. "Across 1,820 known pages, 340 have known issues; 300 re-checked this week").

### Scores, trends, and cross-domain comparison

- **Quality score + grade + band** per domain (0–100, A–F, plus a plain "Leading / On track / Typical / Needs work / At risk" label) from the *typical page's issue density* mapped to realistic government-web benchmarks, so scores spread across a curve and an F is rare and genuinely bad — not handed to everyone (`src/lib/score.js`). axe (rule-level) is the primary signal; Alfa's element-level count is damped (`sqrt`) so its granularity doesn't unfairly tank a grade. The scorecard explains the score and names the single highest-leverage fix.
- **"Fix these first"** ranked action list per domain (pages affected × severity × people reached, from the FPC impact data), each row linking its remediation tip and a CSV of affected pages; plus a **fleet-wide worst-offenders** view on the dashboard (`src/lib/priority.js`).
- **Lighthouse detail page** per domain (`lighthouse.html` + `lighthouse.csv`): every sampled page with all category scores (performance, accessibility, best-practices, SEO, experimental agentic-browsing) and Core Web Vitals (FCP, LCP, Speed Index, TBT, CLS).
- **Evidence CSVs**: per-page readability (`readability.csv`) and spelling (`spelling.csv`) alongside the existing per-rule and resource CSVs, so every headline number links to its underlying pages.
- **Downloadable per-domain JSON** (`docs/data/<domain>/domain.json`): one self-contained snapshot — every scanned URL's last-known status (axe/Alfa counts, status; survives pruning), the findings ledger with first/last-seen, the weekly trend series + diffs, and the latest score. Linked from the domain report.

### Notes on score fairness

- The quality **score is based on axe alone**. axe runs on 100% of pages; Alfa is sampled (lower rate, configurable) and counts individual failing *elements* rather than unique rules, so folding it into the score would mix uneven coverage and inflate counts. Alfa still runs and is reported separately as independent cross-engine confirmation (and in the ACT consensus view) — it just doesn't skew the comparable score.
- **Page weight is measured at page load, before the audit engines run**, so it reflects the real page — not network traffic generated by axe/Alfa/lazy-loading during the audit.
- **Trajectory** (improving / stable / worsening vs ~4 weeks ago) on the leaderboard, so direction is visible, not just the snapshot.
- **Multi-week trend charts** (accessible inline SVG, data-table fallback, no JS) on each domain report for median violations/page, reading ease, and page weight; plus a **cross-domain overlay chart** on the dashboard.
- **Progress-first framing**: reports headline score deltas and the count of issue types **resolved** since last week (from the findings ledger), because trajectory proves progress even when the absolute count isn't zero. Scores are explicitly a relative, automated signal — a floor, not a finish line.

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
