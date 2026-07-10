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
- **URL path/query filtering**: per-target `url_include` / `url_exclude` pattern arrays in `config/targets.yml` restrict which URLs are crawled and scanned. Each pattern is a plain substring or a `/regex/` (wrap in slashes, optional trailing flags); any match triggers. Long lists can be kept in a separate file referenced by `url_include_file` / `url_exclude_file` (one pattern per line, `#` comments allowed, resolved under `config/` like `priority_urls_file`) and merged with the inline arrays. Priority URLs always bypass the filter. Examples and documentation are inline in `targets.yml`.
- **Viewer URL exclusion** (issue #209): a client-side control on the landing and Accessibility pages lets a report reader hide findings on pages outside their remit (a section another team owns, legacy `.aspx` pages). Patterns are substrings or `/regex/`, saved per-domain in the browser (`localStorage['vital-exclude:<domain-key>']`), shared across both pages, and exportable / importable / copyable so a team can agree on one scope. It is additive to the config `url_exclude_patterns` baseline, never recomputes the headline score, and is progressive enhancement (JS off ⇒ full report). Scanning is unaffected — every URL is still scanned; this only scopes the display. The reader can also **download a filtered copy** of the findings (`_bugs.filtered.csv` / `.json`): the control fetches the pre-built `bugs.json` on demand and re-filters it in the browser with the same ≤25-sample rule as the on-screen view, so the download matches what's shown (the filtered CSV is byte-identical to the server export for the same findings). This is distinct from the scan-time `url_exclude` (crawl) and the build-time `url_exclude_patterns` (report render) above.

### Auditing and Data Collection

Each engine has a **weekly coverage rate** set in one place — `config/targets.yml` under `sampling:` (e.g. `axe: 100`, `alfa: 30`, `lighthouse: 10`, `plain-language: 45`, `link-check: 90`). The rate is the share of the week's unique pages the engine runs on; selection is deterministic per page (a stable hash of page + engine + week), so coverage is reproducible and independent per engine. `0` or omitted disables an engine. Each engine writes a compact record onto the per-page JSON.

- **axe-core** (`src/engines/axe.js`): WCAG 2.x / Section 508 accessibility audit, injected into the page via Playwright. Stores rule ids, counts, and pages affected — not full node lists — so records stay small and comparable week over week.
- **Alfa** (`src/engines/alfa.js`): Independent ACT-rules accessibility audit via Siteimprove Alfa (`@siteimprove/alfa-*`), the open source core of Siteimprove's commercial checker. Runs alongside axe for cross-engine coverage.
- **Plain language** (`src/engines/plain-language.js`): Readability of the main content (navigation/header/footer excluded) — Flesch Reading Ease, Flesch-Kincaid grade, average sentence length, long-sentence and passive-voice heuristics, **words per page**, acronyms used without an on-page expansion, and **spelling** (words not in the en dictionary or `config/spelling-allowlist.txt`, skipping numbers/acronyms/URLs). Pages with too little prose to score readability report `scored: false`.
- **Sustainability** (`src/engines/sustainability.js`): Page weight (decoded body bytes) plus both **estimated CO₂ (g)** and **energy (Wh)** per page via co2.js (Sustainable Web Design model v4). `sustainability_metric: co2 | energy` in `config/targets.yml` picks which the reports headline — both are always recorded, so switching needs no re-scan.
- **Deprecated HTML** (`src/engines/deprecated-html.js`): flags obsolete/legacy markup — `<font>`, `<center>`, `<marquee>`, `<frame>`, presentational attributes (`bgcolor`, `align`, …). A worked example of adding a rate-controlled scanner; the seed for a fuller open-site-review-style check.
- **Lighthouse** (`src/engines/lighthouse.js`): Google Lighthouse performance, accessibility, best-practices, SEO, and agentic-browsing scores. Runs its own headless Chrome; keep its sampling rate low (e.g. 10%). Beyond the category scores, it now also extracts the **failing audits** themselves (the recommendations) for performance, SEO, best-practices, and agentic — each with its category, score, estimated saving (transfer bytes / load ms), and element count. Accessibility audits are skipped (they overlap with axe-core).
- **Image inventory** (`src/engines/images.js`): for every `<img>` on sampled pages, records src URL, alt text (exact, including empty string), rendered and natural dimensions, loading/decoding attributes, and byte size (captured from the network response). Flags `isDecorative` (alt="") and `isMissingAlt` (alt attribute absent). Capped at 500 images per page; byte size is intercepted from in-flight responses with no extra fetches. The `images.html` page **deduplicates by URL** (a logo reused site-wide is one row with an occurrence count and its filesize) and downloads as CSV + JSON.
- **Alt-text quality classifier** (`src/lib/alt-text.js`): `assessAltText(img)` goes beyond present-vs-missing to classify each image's alt text — `MISSING`, `DECORATIVE` (intentional, OK), `FILENAME` (e.g. `hero_1234.jpg` pasted as alt), `SUSPICIOUS` (redundant phrasing like "image of…", or meaningless values), `TOO_SHORT`, `TOO_LONG`, or `GOOD`. Surfaced as an **alt-text quality** summary on `images.html` (counts per verdict) and a per-image verdict column, so reviewers see the alt text that's technically present but unhelpful, not just the empty ones.
- **Tech stack detection** (`src/engines/tech.js`): identifies CMS, frameworks, analytics, and other software from page signals (script sources, inline scripts, meta tags, JS globals, cookies, response headers) using the vendored HTTPArchive/wappalyzer fingerprint database (GPL-3.0, 3,454+ fingerprints, 108 categories). Results are aggregated by highest confidence across sampled pages and shown on a `tech.html` sub-page (with concise "N of M pages" coverage, expandable example pages per technology, and CSV + JSON downloads). Update the vendor copy with `scripts/update-wappalyzer.sh`.
- **Technology ↔ finding association** (`src/lib/tech-findings.js`): joins the technologies detected on each page with the accessibility findings on that same page, then computes **lift** — how much more likely a finding is on pages running a given technology versus its overall rate. Surfaces *systemic* issues that travel with a CMS/theme/widget rather than with one page's content. Per-domain `tech-findings.html` sub-page lists each technology's over-represented findings (lift, page support); the dashboard merges every domain's model into a **Cross-technology issues** matrix ranked by lift × number of sites affected, so a barrier recurring with the same technology across independent sites is flagged as a likely bug in that technology. Association, not causation: co-located technologies share identical lift (collinearity), and the report says "associated with", for human confirmation. Only pages where both tech detection and an accessibility engine ran are counted (well-defined denominator); a 5-page minimum support guards against noise.
- **Third-party JS / resource evaluation** (`src/engines/third-party.js`): inventories every third-party origin (different registrable domain than the page) serving resources to each sampled page — requests, bytes, and load duration (from the Resource Timing API), and how many were scripts. Rolled up per vendor across pages (`src/lib/third-party-rollup.js`): pages present, median load cost, whether it serves JavaScript, and the share of its pages that also had an accessibility finding (an association to investigate, not proof of cause). A committed `third-parties.json` ledger tracks first/last-seen per vendor so new vendors are flagged. Shown on a `third-party.html` sub-page with a `third-party.csv` export. Third-party JS is easy to add and frequently degrades a page (injected DOM the owner never reviewed, plus load time); this makes the cost visible. Sampled like sustainability (default 25%) because third parties vary per page.
- **Link checking** (`src/lib/links.js`, via the `link-check` engine): collects links seen on sampled pages and probes a capped, deduplicated sample (`VITAL_LINK_CHECK_CAP`, default 500) with polite per-host pacing, recording broken links (4xx/5xx, DNS failures, timeouts). 401/403/429 are treated as soft-OK to avoid bot-challenge false positives.

### Cross-engine consensus (ACT-rule deduplication)

axe and Alfa both implement [W3C ACT rules](https://www.w3.org/WAI/standards-guidelines/act/rules/), so the same issue is frequently reported by both under different rule ids (axe `image-alt` and Alfa `sia-r2` are both ACT rule `23a2a8`). Reports now consolidate findings by their shared ACT rule and affected page, so a real issue is counted **once** — the dashboard shows unique issues plus how many are caught by **both** engines (highest confidence) versus axe-only / alfa-only, instead of a misleading doubled total (`src/lib/act.js`, `src/lib/consensus.js`; mapping in `src/data/act-mapping.json`, regenerable from the upstream ACT implementation reports). Unmapped rules keep their own identity and are never wrongly merged.

### Remediation tips

Bug reports include a short, plain-language "How to fix" tip per rule (`config/remediation-tips.json`, seeded for common axe and Alfa rules), shown alongside the engine's own reference URL. Add tips as you triage; unknown rules fall back to the reference link.

### Accessibility bug prioritization

`src/lib/accessibility-priority.js` sorts and tiers every bug report so the most important issues surface first without hiding the rest:

- **Tier 0** — Critical or High severity: always shown first, regardless of count cap.
- **Tier 1** — Medium/Low issues that both hit a **key page** (a `priority_urls` / `priority_urls_file` URL) and exceed the `moderate_issue_threshold_percent` prevalence threshold (default 5 % of scanned pages).
- **Tier 2** — WCAG 2.x A or AA conformance failures not in the above tiers.
- **Tier 3 / 4 / 5** — Best Practice, WCAG AAA, and everything else.

Within each tier, issues are ranked by pages affected → WCAG severity → instance count → alphabetical description. After guaranteeing all Tier 0–1 issues are visible, the renderer fills up to `max_html_issues` (default 50) from the lower tiers; all bugs remain in the JSON with a `default_visible` flag so the HTML can show/hide without re-sorting.

`src/lib/top-tasks.js` (`loadPriorityUrls`) resolves a target's key pages from an inline `priority_urls` list and/or a `priority_urls_file` (one URL per line, `#` comments ignored), normalising every URL to the target's canonical host. These are the pages whose accessibility issues are elevated to Tier 1.

Both settings live under the target entry in `config/targets.yml`; reporting thresholds (`max_html_issues`, `moderate_issue_threshold_percent`, `include_key_page_issues`) are configured under a `reporting:` key in the same entry.

### Broken-link source tracking

When the link-check engine finds a broken link, the report shows which scanned page(s) link to it ("Linked from: /a, /b +3 more"), so a 404 can be traced to the pages that need fixing, not just the dead URL.

### Embedded & linked resource inventory

The audit engines only see HTML, but sites also serve PDFs, Word/PowerPoint/Excel documents, iframes, embedded videos and audio, and other non-HTML resources whose accessibility the site owner still owns. The `resources` engine (`src/engines/resources.js`) catalogs every such resource each page links to or embeds, classified by type (it inventories URLs and types; it does not fetch or audit the files). A committed per-domain ledger (`data/<domain>/resources.json`) tracks first-seen / last-seen per resource, so the report answers two questions a site owner can't otherwise: *what PDFs/embeds does this site have?* and *what was added in the last week?* (a "New this week" section, plus a full `resources.csv` with first-seen dates).

### Findings history

A committed per-domain ledger (`data/<domain>/findings.json`) tracks every unique finding by `pattern_id` with first-seen / last-seen / weeks-seen, accumulated across the domain's whole history (it survives page-detail pruning). Bug reports show when each issue was first discovered and last observed.

### Affected-page CSV exports

Every reported number is traceable to its pages. Each domain/week report writes CSVs under `docs/reports/<domain>/<week>/csv/`: one per failing rule (every affected URL + per-page instance count) plus `axe-pages-with-violations.csv` / `alfa-pages-with-failures.csv` behind the summary counts. The HTML report, the rule tables, and the bug reports all link to these so a developer can pull the full list to reproduce and fix an issue (`src/lib/csv.js`).

- **`bugs.csv`** — 32 columns covering every field in the HTML bug report: `combined_id`, description, steps to reproduce, suggested fix, remediation tip, testing environment, impact summary, impact groups, and more.
- **`errors.csv`** — broken links and HTTP error pages with type, URL, status code, and linked-from pages.
- **`bugs.json`** — structured bug reports for every failing rule (the full archival dataset, including all affected-page URLs, raw counts, and every example instance). This is the complete source of truth.
- **`ai-findings.json`** — a compact, problem-focused companion to `bugs.json`, generated by `src/lib/ai-findings.js`. Designed for LLM-assisted triage: healthy pages are intentionally excluded; representative examples replace exhaustive lists; every finding carries a stable fingerprint, a trend signal (`new` / `persistent` / `worsening` / `improving`), a priority (`p1–p4`), a confidence level, and HTML fragment fingerprints so structurally similar failures can be grouped. Also includes technology-lift associations (e.g. "pages using reCAPTCHA are 3× more likely to have this finding"), third-party co-occurrence risks, WCAG-criterion clusters, and URL-pattern clusters. Schema version `0.1`; linked from the Accessibility report page as "JSON (AI diagnostic)".

### Human-impact modeling

Each finding's WCAG success criterion maps to the [Section 508 Functional Performance Criteria](https://www.section508.gov/develop/mapping-wcag-to-fpc/) and on to disability groups with US population prevalence (ACS 2022), so a bug report says *who* it affects — e.g. "Affects Without vision (1.0%), Limited vision (2.4%)" — instead of an opaque placeholder (`src/lib/fpc.js`, full WCAG 2.2 A/AA mapping). When a target sets `page_loads_per_week` in config, reports also show a rough estimated-people-excluded figure (prevalence × loads × share of pages affected). Without page-load data, only prevalence percentages are shown — no fabricated counts.

### WCAG versioning

Every WCAG success criterion in `src/lib/wcag.js` now carries a `wcag_version` field (`2.0`, `2.1`, or `2.2`). `classifyFinding()` returns a structured category string (e.g. "WCAG 2.2 AA", "Best Practice"). Bug reports sort findings WCAG 2.2 → 2.1 → 2.0 → AAA → Best Practice → Undetermined. When an axe and Alfa finding share the same WCAG SC and ≥ 50% page overlap, the Alfa finding is flagged `possible_duplicate_of` the axe finding in the report.

### Reporting and Dashboard

- Static site generated to `docs/` by `src/aggregate.js` — a pure function of `data/`. Never committed; shipped as a GitHub Pages artifact, so it cannot drift from the data.
- `docs/index.html` — dashboard: scorecard → summary → trends → week-over-week changes → "Fix these first".
- `docs/reports/<domain>/<week>/index.html` — per-domain Overview page (score, key metrics, trends).
- `docs/reports/<domain>/<week>/accessibility.html` — bug reports (anchored per bug for deep-linking) + axe/Alfa rule tables + ACT consensus. "Fix these first" links deep-link here via `#VS-xxxx` anchors.
- `docs/reports/<domain>/<week>/standards.html` — web standards & security checklists (standards.js + security.js results).
- `docs/reports/<domain>/<week>/errors.html` — broken links and HTTP error pages.
- `docs/reports/<domain>/<week>/lighthouse.html` — per-page Lighthouse scores and Core Web Vitals.
- `docs/reports/<domain>/<week>/readability.html` — readability scores, unexplained acronyms, and misspellings.
- `docs/reports/<domain>/<week>/tech.html` — detected tech stack (CMS, frameworks, analytics).
- `docs/reports/<domain>/<week>/tech-findings.html` — accessibility findings over-represented on pages running each detected technology (lift-ranked); the dashboard rolls these up into a fleet-wide **Cross-technology issues** matrix.
- `docs/reports/<domain>/<week>/third-party.html` — third-party vendors serving the site, with per-page load cost (bytes/requests/duration), whether they serve JavaScript, and finding co-occurrence; `third-party.csv` export.
- Per-domain Archive page listing every retained ISO week with score and week-over-week deltas; linked from the sub-page nav.
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
- **Lighthouse detail page** per domain (`lighthouse.html` + `lighthouse.csv`): every sampled page with all category scores (performance, accessibility, best-practices, SEO, agentic-browsing) and Core Web Vitals (FCP, LCP, Speed Index, TBT, CLS). Columns are click-to-sort (progressive enhancement; works without JS). Includes a **performance-impact** section: average extra LCP over Google's 2.5s benchmark and extra page weight over 1.6 MB, and — when a target sets `page_loads_per_week` — total estimated wasted time and data (with Wikipedia-copies context), following the [daily-dap](https://github.com/mgifford/daily-dap) method.
- **Lighthouse recommendations** on `lighthouse.html`: the non-accessibility audits Lighthouse flagged, aggregated across the sampled pages (like the axe rule table) and grouped by category — Performance, Best Practices, SEO, Agentic — each ranked by pages affected with Lighthouse's own estimated saving (transfer bytes / load time). Plus a plain-language **"What the Agentic score means"** explainer (the AI-readiness category is new in Lighthouse 13.4+: `llms.txt`, structured data, a parseable accessibility tree, WebMCP), with the specific agentic gaps found.
- **Fleet-wide Lighthouse recommendations** on the dashboard: a **"Common Lighthouse recommendations"** section merges every domain's recommendations by audit, keeping only those flagged on **≥2 sites**, ranked by number of sites affected with summed estimated savings. A recommendation recurring across independent government sites usually points at a shared platform, theme, or CDN — where one coordinated fix helps everyone.
- **Readability detail page** per domain (`readability.html` + `readability.csv`): a sortable table of every prose page (words, Flesch Reading Ease, Flesch-Kincaid grade) with documentation of what each metric means and why card/link-heavy pages aren't scored.
- **Consistent sub-page navigation**: every weekly report carries the same fixed subnav — Overview, Accessibility, Standards, Errors, Lighthouse, Readability, Tech stack, Tech ↔ issues, Third parties, Images, Archive — in the same order on every domain and every week. Every sub-page is always written, so no nav link 404s; a criterion with no data that week renders a clear "no data this week" empty-state page rather than disappearing from the nav. Every section heading has a hover/focus **anchor link** for sharing (copy-safe). Long URLs truncate with an ellipsis (full URL on hover, still copyable).
- **Evidence CSVs + JSON**: per-page readability (`readability.csv`), spelling (`spelling.csv`/`spelling.json`), unexplained acronyms (`acronyms.csv`/`acronyms.json`), technologies (`tech.csv`/`tech.json`), and images (`images.csv`/`images.json`) alongside the existing per-rule and resource CSVs — each linked from its report section, so every headline number downloads with the pages where it occurs. Spelling and acronym entries now carry example pages.
- **Downloadable per-domain JSON** (`docs/data/<domain>/domain.json`): one self-contained snapshot — every scanned URL's last-known status (axe/Alfa counts, status; survives pruning), the findings ledger with first/last-seen, the weekly trend series + diffs, and the latest score. Linked from the domain report.

### Standards & security checks (ScanGov-style)

Two engines replicate, at site scale, the gaps between vital-core and [ScanGov](https://standards.scangov.org/) (which scores only the homepage; methodology CC0). They complement rather than compete — we run the same checks across the whole scan and track them week over week.

- **Security** (`src/engines/security.js`, per origin): HTTPS, HSTS, CSP, X-Content-Type-Options, clickjacking protection (X-Frame-Options or CSP frame-ancestors), published `security.txt`, sponsored government TLD (.gov/.mil/.edu), and www resolution. Reported as a per-origin pass/fail checklist.
- **Standards & metadata** (`src/engines/standards.js`, per page): schema.org GovernmentOrganization, canonical, hreflang, `<title>`, meta description, charset, document `lang`, responsive viewport (zoom not disabled), Open Graph tags (≥4/6), Twitter card — reported as a pass-rate table across checked pages. Also detects **open social presence** (Mastodon via `rel="me"`/known hosts, Bluesky) and surfaces the links.

Both are rate-controlled engines (security low/per-origin, standards per-page) with their own report section, and roll into the per-domain `domain.json` export. We deliberately keep these out of the accessibility score — security and SEO are different dimensions.

### Time windows: rolling 7 days vs ISO-week archive

The dashboard headline uses a **trailing 7-day window** (aggregated from page records by `scannedAt`, spanning ISO-week folders), so a domain's numbers aren't a partial Monday-to-now week measured against full historic weeks — a fairer, like-for-like benchmark. Per-domain **ISO-week reports** remain the detailed record, reachable from a per-domain **Archive** page (linked in the sub-page nav) that lists every retained week with score and week-over-week deltas. Page-count labels distinguish *fetched* vs *unique pages audited (this period)* vs *unique pages ever scanned* (all-time, from the inventory) so the numbers no longer look contradictory. Blocked targets are tucked into a collapsed accordion at the bottom of the dashboard rather than leading it.

### Notes on score fairness

- The quality **score is based on axe alone**. axe runs on 100% of pages; Alfa is sampled (lower rate, configurable) and counts individual failing *elements* rather than unique rules, so folding it into the score would mix uneven coverage and inflate counts. Alfa still runs and is reported separately as independent cross-engine confirmation (and in the ACT consensus view) — it just doesn't skew the comparable score.
- **Page weight is measured at page load, before the audit engines run**, so it reflects the real page — not network traffic generated by axe/Alfa/lazy-loading during the audit.
- **Trajectory** (improving / stable / worsening vs ~4 weeks ago) on the leaderboard, so direction is visible, not just the snapshot.
- **Multi-week trend charts** for median violations/page, reading ease, and page weight on each domain report, plus a **cross-domain overlay chart** on the dashboard. Baseline is an accessible inline SVG with a data-table fallback (works with no JS). Where JavaScript is available, single-series line charts are **progressively enhanced** into [ParaCharts](https://github.com/fizzstudio/ParaCharts) `<para-chart>` web components — keyboard- and screen-reader-navigable, with data-point sonification — via a lazy `import()` of the vendored runtime (`vendor/paracharts/`, AGPL-3.0, served first-party; `src/lib/paracharts.js` builds the JIM manifest, a loader in `report-html.js` mounts it and hides the SVG fallback). If the runtime fails to load, the SVG + table remain.
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
