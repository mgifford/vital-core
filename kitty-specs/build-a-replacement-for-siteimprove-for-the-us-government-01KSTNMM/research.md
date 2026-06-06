# Discovery / Research

## Existing system

- TypeScript/Node project.
- Existing scan profiles in `profiles/`.
- Existing scan output in `dist/runs/`.
- Existing reports in `dist/reports/`.
- Existing dashboard output in `dist/`.
- Existing tests in `tests/unit/` and `tests/smoke/`.
- Existing GitHub Actions workflows for CI, scans, and deployment.

## What already works

- Scanner can produce run artifacts.
- Reports already exist as Markdown and CSV.
- Dashboard/API output already exists.
- SQLite persistence exists.
- Tests cover workers, reporting, persistence, dashboard compilation, and smoke validation.

- `package.json` confirms the scanner runs through `npx tsx src/index.ts`.
- Local scan command exists: `npm run scan:local`.
- Full validation command exists: `npm test`.
- CI validation command exists: `npm run test:ci`.
- Live/browser smoke checks are separated into `npm run test:phase:live`.
- Weekly reporting already partially exists:
  - `dist/api/weekly-ratings.json`
  - `dist/api/weekly-trends.json`
  - `dist/api/weekly-top-rules.json`
  - `dist/api/run-directory.json`
- Existing features already include Alfa, axe, Lighthouse, Wappalyzer, Cheerio/offline analysis, third-party impact, SQLite history, dashboard generation, and per-run detail pages.

## What is not yet clear

- Whether `dist/` is fully reproducible from source.
- Whether weekly comparison logic is complete.
- Whether issue identity is stable enough for new/resolved/persistent classification.
- Whether GitHub Actions weekly scan is reliable.
- Whether reports are actionable enough for non-specialist site owners.

- The task list still marks WP01 and WP02 incomplete, but README and FEATURES say Alfa integration and normalized finding work already exist. This needs reconciliation.
- The mission task file may be stale relative to the codebase.
- Discovery must verify which of WP01 and WP02 are actually complete before implementing anything new.

- The reporting still seems to be per-run rather than an aggregation of stored date over the week.

## User value target

The weekly report must show:

1. New issues.
2. Resolved issues.
3. Persistent high-priority issues.
4. Regressions.
5. Improvements.
6. Most affected pages.
7. Likely template-level problems.
8. Recommended next actions.
9. Exportable evidence.

## Implementation direction

Do not rebuild the scanner. Build on the current code. Focus on stabilizing the weekly reporting loop and improving comparison, prioritization, and presentation.

## Files reviewed

- `package.json`
- `README.md`
- `FEATURES.md`
- `TEST-STRATEGY.md`
- `src/index.ts`
- `src/compile.ts`
- `src/engine/*`
- `src/types/*`
- `scripts/*`
- `profiles/*`
- `tests/unit/*`
- `tests/smoke/*`
- `dist/runs/*`
- `dist/reports/*`

## Recommended next task

Map current report outputs to the weekly report contract, then implement any missing comparison logic for new, resolved, persistent, and worsening issues.


Before coding, reconcile `tasks.md` against the current implementation.

Specific discovery target:

1. Confirm whether Alfa execution path already satisfies WP01 T001.
2. Confirm whether raw Alfa payloads are persisted, satisfying WP01 T002.
3. Confirm whether `src/types/normalized-finding.ts` satisfies WP02 T001.
4. Confirm whether Alfa and Axe adapters already exist, satisfying WP02 T002.
5. Confirm whether normalization tests already satisfy WP02 T003.
6. Only then move to WP03 consensus prioritization.



{
  "name": "vital-core",
  "version": "1.0.0",
  "description": "A quality scanner for websites built for the US government.",
  "main": "index.js",
  "scripts": {
    "scan": "npx tsx src/index.ts",
    "scan:local": "VITAL_ALFA_CMD=node_modules/.bin/alfa VITAL_TARGET_LIMIT=5 npm run scan",
    "scan:deep": "VITAL_ALFA_CMD=node_modules/.bin/alfa VITAL_SCAN_INTENSITY=deep VITAL_TARGET_LIMIT=5 npm run scan",
    "validate": "npm run validate:profile",
    "validate:discovery:smoke": "npx tsx tests/smoke/validate-discovery-smoke.ts",
    "validate:browser:smoke": "npx tsx tests/smoke/validate-browser-smoke.ts",
    "validate:workers:smoke": "npx tsx tests/smoke/validate-workers-smoke.ts",
    "validate:reporting:smoke": "npx tsx tests/smoke/validate-reporting-smoke.ts",
    "validate:standards:source": "npx tsx tests/smoke/validate-standards-source.ts",
    "build": "tsc",
    "validate:types": "tsc --noEmit",
    "validate:profile": "npx tsx tests/smoke/validate-profile-contract.ts",
    "validate:standards": "npm run validate:standards:source",
    "test:phase": "npm run validate:profile && npm run validate:standards",
    "test:phase:live": "npm run validate:discovery:smoke && npm run validate:browser:smoke && npm run validate:workers:smoke && npm run validate:reporting:smoke",
    "test:unit": "vitest run",
    "test:unit:coverage": "vitest run --coverage",
    "test:watch": "vitest",
    "test": "npm run validate:types && npm run test:phase && npm run test:unit",
    "test:ci": "npm run validate:types && npm run test:phase && npm run test:unit:coverage",
    "submodules:init": "git submodule update --init --recursive",
    "submodules:update": "git submodule update --remote --merge --recursive",
    "history:fetch": "node scripts/fetch-history.mjs",
    "seeds:refresh": "npx tsx scripts/refresh-priority-seeds.ts",
    "inventory:export": "node scripts/export-target-inventory.mjs",
    "act-mapping:update": "node scripts/update-act-mapping.mjs",
    "api:sqlite": "node scripts/sqlite-api-server.mjs",
    "duckduckgo-fetch": "npx tsx src/cli/duckduckgo-fetch.ts",
    "compile": "npx tsx src/compile.ts profiles/us-health.yml"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/mgifford/vital-core.git"
  },
  "keywords": [],
  "author": "",
  "license": "AGPL-3.0",
  "type": "commonjs",
  "bugs": {
    "url": "https://github.com/mgifford/vital-core/issues"
  },
  "homepage": "https://github.com/mgifford/vital-core#readme",
  "dependencies": {
    "@axe-core/playwright": "^4.11.3",
    "@siteimprove/alfa-cli": "^0.83.0",
    "@siteimprove/alfa-formatter-json": "^0.83.0",
    "cheerio": "^1.2.0",
    "chrome-launcher": "^1.2.1",
    "dictionary-en": "^4.0.0",
    "lighthouse": "^13.3.0",
    "nspell": "^2.1.5",
    "picomatch": "^4.0.4",
    "sitemapper": "^4.1.6",
    "yaml": "^2.9.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/cheerio": "^0.22.35",
    "@types/node": "^25.9.1",
    "@types/picomatch": "^4.0.3",
    "@vitest/coverage-v8": "^4.1.7",
    "playwright": "^1.60.0",
    "tsx": "^4.22.3",
    "typescript": "^6.0.3",
    "vitest": "^4.1.7"
  }
}
# vital-core
A quality scanner for websites built for the US government.

## Governance and Guidance

- Project constitution: CONSTITUTION.md
- Agent operating guide: AGENTS.md
- Accessibility reporting standard: ACCESSIBILITY.md

## Branch Protection Setup

To prevent regressions, protect `main` in GitHub settings and require these status checks before merge:

1. `CI Test and Validation / test`
2. `Governance Guardrails / required-files`
3. `Governance Guardrails / governance-rationale`
4. `Pages Quality Gate / quality-gate`

Recommended branch protection options:

- Require a pull request before merging.
- Require status checks to pass before merging.
- Require branches to be up to date before merging.
- Require conversation resolution before merging.
- Restrict force pushes and branch deletion.

Path in GitHub UI:

1. `Settings`
2. `Branches`
3. `Add branch protection rule`
4. Branch name pattern: `main`

## Common Commands

- Install dependencies: `npm ci`
- Run automated tests and validators: `npm test`
- Run CI-safe full validation with coverage: `npm run test:ci`
- Run optional live/network-heavy phase checks: `npm run test:phase:live`
- Run a scan locally: `npm run scan`
- Start local SQLite API for raw scan data: `npm run api:sqlite`

## Testing Infrastructure

The project splits testing into two tiers:

- CI-safe checks (`npm test` / `npm run test:ci`): type validation, profile contract checks, standards-source integrity checks, and deterministic unit tests.
- Live phase checks (`npm run test:phase:live`): network and browser-dependent validations for discovery/browser/worker/reporter flows.

Coverage reports are generated to `coverage/` and uploaded by the CI workflow (`.github/workflows/ci-tests.yml`).

Standards-source integrity is validated by `tests/smoke/validate-standards-source.ts` and confirms that the ScanGov standards submodule and canonical standards data mappings are present for reporting.

## Scan Tool Stack

VITAL-Core runs up to six workers per page. Workers 2–6 are skipped when `VITAL_AUDIT_SCOPE=accessibility` or `a11y`.

| # | Tool | What it produces |
|---|------|-----------------|
| 1 | **axe-core** via `@axe-core/playwright` | WCAG 2.x / Section 508 violations (always runs) |
| 2 | **Siteimprove Alfa CLI** | Independent ACT-rules accessibility audit against live URL (always runs) |
| 3 | **Google Lighthouse** | Performance (FCP, LCP, Speed Index), accessibility, SEO, best-practices, and experimental agentic-browsing scores |
| 4 | **wappalyzer-next** | CMS / framework / analytics tech fingerprint (`--scan-type full`) |
| 5 | **Cheerio** (offline) | Alt-text, readability, overlay detection, USWDS presence, ambiguous links |
| 6 | **axe-core** (JS disabled) | Third-party script regression delta |

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITAL_ALFA_CMD` | `alfa` | Path to alfa binary. Use `node_modules/.bin/alfa` locally and in CI. |
| `VITAL_WAPPALYZER_CMD` | _(empty — tool skipped if unset)_ | Path to wappalyzer-next binary. |
| `VITAL_AUDIT_SCOPE` | `full` | Set to `accessibility` or `a11y` to run workers 3–6 only (axe + alfa still run). |
| `VITAL_SCAN_INTENSITY` | `standard` | `deep` enables Firefox + WebKit in addition to Chromium. |

### Alfa accessibility auditing

Alfa and axe both run on every page. Alfa provides independent ACT-rules coverage from Siteimprove; axe provides Deque coverage. Running both improves overall issue detection.

Alfa requires `@siteimprove/alfa-formatter-json` to be installed (it is in `dependencies`) and the `VITAL_ALFA_CMD` environment variable to point to the binary:

```sh
VITAL_ALFA_CMD=node_modules/.bin/alfa npx tsx src/index.ts profiles/local-test.yml
```

Alfa serializes the full DOM tree into its JSON output. Complex pages can produce 4–10 MB of output per page; the worker uses a 10 MB buffer limit.

### Page Technology Profiling

Each scanned page includes a CMS/framework technology fingerprint in `technologyStack`, powered by **wappalyzer-next** (the open-source fork — the original Wappalyzer requires a paid commercial license and will not run without one) using `--scan-type full`.

- Default command: `.tools/wappalyzer-next/bin/wappalyzer` when `VITAL_WAPPALYZER_CMD` is set
- If the command is unavailable or fails, scans continue and `technologyStack` is reported as an empty list.

Install options for `wappalyzer-next` are documented upstream: https://github.com/s0md3v/wappalyzer-next

### Third-Party JavaScript Accessibility Impact

For pages with suspicious third-party signals (for example: tag managers, chat widgets, overlays, third-party iframes), VITAL-Core runs a second accessibility audit with JavaScript disabled and compares the results.

Per-page output includes `thirdPartyImpact` with:

- trigger evidence (`triggeredBy`)
- JS-enabled vs JS-disabled violation counts
- regression flag (`regressionDetected`)
- potentially JS-introduced high-risk rules (`highRiskRules`)
- likely provider attribution (`likelyIntroducedByProviders` and `ruleToLikelyProviders`)
- provider confidence labels (`providerAttribution` and `ruleToProviderAttribution`) using weighted evidence signals

When regressions are detected, bug reports include a dedicated third-party JavaScript regression section.

### Optional Supplemental Remediation Catalog

Each axe finding already includes primary Deque rule guidance via the rule `helpUrl` and failure summary output. VITAL-Core can now optionally add supplemental pattern-based remediation advice using Purple-AI catalog data.

- Default source path: `tools/submodules/purple-ai`
- Optional override: set `VITAL_PURPLE_AI_DIR`
- If catalog data is missing or no match exists, reports continue with Deque guidance only.
- Supplemental guidance is labeled as `curated-purple-ai` with confidence (`HIGH` exact match, `MEDIUM` fuzzy match).

## Federal Quality Index

Each run now computes a deterministic Federal Quality Index (`0-100`) with a gate status (`PASS`, `WARNING`, `BLOCKED`) and persists it in:

- `dist/runs/latest.json`
- `dist/runs/index.json`
- `dist/runs/trends.json`

The score blends accessibility severity density, content quality signals, scan reliability, and link integrity. `BLOCKED` is enforced whenever critical accessibility violations are present.

Per-target quality scoring is also persisted in run artifacts (`targetQuality`) so HHS/CMS and other target domains can be compared side-by-side in reporting.
Provider confidence rollups are persisted in run artifacts and trends (`providerAttributionTop`) so recurring third-party risk can be monitored over time.

## WCAG Baseline and Targets

- Legal federal baseline remains **WCAG 2.0 AA**.
- VITAL-Core also tracks progress toward **WCAG 2.1 AA** and **WCAG 2.2 AA** as recommended targets.
- Reports keep these conformance levels distinct in trend outputs so legal requirements and stretch goals are not conflated.
- **AAA** is encouraged where practical, but automated AAA checks are treated as advisory only.
- Manual testing (keyboard-only and assistive technology) is prioritized over automated AAA score chasing.

## Third-Party Tool Submodules

This repository tracks upstream scanner source repositories as submodules to make updates easy and reviewable.

Current tracked submodules include:

- `tools/submodules/axe-core` (Deque axe-core engine)
- `tools/submodules/standards` (ScanGov standards catalog)
- `tools/submodules/purple-ai` (GovTechSG Purple-AI remediation response catalog)

- Initialize submodules: `npm run submodules:init`
- Update submodules to latest upstream tracked commits: `npm run submodules:update`

See `SUBMODULES.md` for details.

## Persistent Run History on GitHub Pages

Scheduled scans publish:

- `runs/latest.json` (latest full run payload)
- `runs/index.json` (historical run index)
- `runs/<run-id>.json` (timestamped run artifacts)
- `runs/<target-id>/scan-queue.json` (per-target discovery queue snapshot with source metadata)
- `runs/scan-status.json` (per-run scan summary, including queue composition counts)
- `runs/scan-status.md` (Markdown summary for CI logs or PR comments)
- `runs/page-state.json` (per-URL change metadata for incremental rescans)
- `runs/top-task-seeds.json` (monthly DuckDuckGo-derived priority URL seeds)
- `api/index.json` (stable API endpoint manifest)
- `api/latest.json` (latest run summary for API consumers)
- `api/targets.json` (latest per-target aggregated metrics)
- `api/runs.json` (recent run index for API consumers)
- `api/issues-last-week/index.json` (manifest for full last-7-day accessibility issue snapshot)
- `api/issues-last-week/all-issues-*.json` (chunked raw issue instances across all domains)
- `api/issues-last-week/targets/<target-id>.json` (full last-7-day raw issue instances for one domain)

## SQLite Raw Data API (Local)

VITAL-Core stores additive scan history in `dist/vital.db`. You can query it directly with:

- `node scripts/query-db.mjs summary`
- `node scripts/query-db.mjs recent-runs --limit 25 --json`

For HTTP API access over local development, run:

```sh
npm run api:sqlite
```

Default server URL: `http://127.0.0.1:8787`

Useful endpoints:

- `GET /api/sql/overview` — run/page/violation totals
- `GET /api/sql/tables` — table and column metadata
- `GET /api/sql/urls?limit=1000&offset=0` — all tracked/scanned URLs from `url_history`
- `GET /api/sql/pages?target_id=cms-gov&limit=1000&offset=0` — raw page scan rows
- `GET /api/sql/violations?target_id=cms-gov&limit=1000&offset=0` — raw violation instance rows
- `GET /api/sql/table/<table>?limit=1000&offset=0` — generic table access
- `GET /api/sql/query?q=SELECT%20COUNT(*)%20AS%20count%20FROM%20url_history` — read-only SELECT/WITH queries

The scan workflow restores previously published run history before generating a new run, then merges and republishes the updated index.

## Dashboard Navigation and Attribution

The dashboard includes a dominant header domain selector so users can jump directly to any domain report page:

- Domain overview
- Accessibility
- Performance
- Content
- Third-party impact

Each generated page also includes a footer linking to the main repository and clarifying non-affiliation:

- Project repo: `https://github.com/mgifford/vital-core`
- Disclaimer: VITAL-Core is an independent open source project and is not affiliated with or endorsed by scanned agencies/sites.

## Incremental Scanning for Scale

To support high-volume weekly scanning, VITAL-Core now probes each URL before launching full browser audits:

- If `ETag` or `Last-Modified` matches the prior run state, that page is marked `SKIPPED_UNCHANGED`.
- If validators are missing, a lightweight content hash probe is used as a fallback.
- Changed or uncertain pages are fully rescanned.

This behavior uses the persisted `runs/page-state.json` cache restored from GitHub Pages at run start.

To override this and force a full rescan:

- In GitHub Actions `workflow_dispatch`, set `force_rescan` to `true`.
- Or run locally with `FORCE_RESCAN=true npm run scan`.

If your Pages base URL differs from the default `https://<owner>.github.io/<repo>`, set a repository variable named `VITAL_PAGES_BASE_URL`.

## Monthly Top-URL Validation Seeding

VITAL-Core now seeds each target queue with high-priority URLs derived from DuckDuckGo `site:` results.

- Seed cache artifact: `dist/runs/top-task-seeds.json`
- Automatic refresh: monthly during scheduled scan workflow (first day of month)
- Staleness policy: refresh when seed cache is older than 31 days
- Manual local refresh: `npm run seeds:refresh`

Discovery order is:

1. Recently updated URLs from prior run state
2. DuckDuckGo priority seeds
3. Profile `priority_urls`
4. Filtered sitemap URLs

Discovery filters now default to:

- Host scope only (`target.base_url` host only; no wildcard subdomain fan-out)
- HTML-like URLs only (non-HTML assets such as PDF, DOCX, XLSX, XML, media, fonts, RSS excluded)

You can opt into subdomain crawling per target by setting `settings.include_subdomains: true`.

The sitemap sampler is deterministic for a given `VITAL_SAMPLING_SEED`. Scheduled runs set that seed from run metadata so each run is reproducible on replay, while local comparisons can use a fixed seed for byte-stable output.

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
# 🧪 Test Strategy Document // vital-core

This document outlines the Test-Driven Development (TDD) and Behavior-Driven Development (BDD) engineering strategy for **vital-core**. Because this system runs without infrastructure via GitHub Actions and targets highly volatile federal web applications, our testing framework must be deterministic, preventing false positives while guaranteeing strict schema compliance.

---

## 🎯 1. Core Testing Philosophy

Our strategy blends **TDD** (to ensure data contracts and calculation math are flawless) with **BDD** (to verify browser loading behaviors, fallback operations, and user interaction mechanics).

```
   ▲   [E2E BDD Contexts]         -> Playwright live-navigation, timeouts, and WAF handles.
  ╱█╲  [Integration Fixtures]     -> Testing offline workers against static mock HTML files.
 ╱███╲ [Unit TDD Validation]      -> Type schema constraints, configuration parsers, readability math.

```

* **Spec-First Engineering (TDD):** No execution logic is written without an underlying JSON/Zod data schema. Code validation means proving that a module ingests a strict type input and generates a strict type output.
* **Deterministic Isolation (BDD):** We do not run automated testing routines against live federal websites (`cms.gov`, etc.). Doing so introduces network latency and remote drift into our test suite. Instead, live behavior is mocked using local test servers, and offline behavior is tested against fixed HTML snapshots.

---

## 🧱 2. The Three-Tier Testing Matrix

### Tier 1: Unit Testing (TDD Focused)

Ensures our static logic, data parsers, and algorithmic calculations are mathematically sound and fail early when bad configuration is injected.

* **Target Components:** `ProfileParser`, Flesch-Kincaid readability scoring equations, URL filename sanitization, and output contract validation.
* **Execution Strategy:** Fast node-based tests executing on every commit.
* **Assertion Boundary:** Given invalid input data shapes (e.g., a profile missing a `base_url`), the system must explicitly reject execution with clear type validation errors before spinning up internal engines.

### Tier 2: Component Integration Testing (Fixture Focused)

Validates our offline analysis modules (`OfflineWorker`) without using browser contexts or active network paths.

* **Target Components:** Alternative text scanners, design system footprints (`design-system-scan`), and script-based widget identifiers (`Find-Overlays`).
* **The Fixture Repository:** We maintain a localized pool of mock HTML artifacts containing explicit, intentional compliance errors:
* `mock_bad_alts.html`: Features images with generic names (`alt="screenshot.png"`), blank attributes, and missing tags.
* `mock_with_overlay.html`: Contains standard header structures injected with active UserWay or AccessiBe script tags.
* `mock_uswds.html`: Implements components with valid federal utility signatures.


* **Assertion Boundary:** The parser must identify 100% of the embedded errors in the static files, mapping them identically to our target output arrays.

### Tier 3: End-to-End Behavioral Testing (BDD Focused)

Ensures our headless Playwright container behaves predictably when interacting with unpredictable, slow, or hostile server environments.

* **Target Components:** Browser life-cycles, network quiet states (`networkidle`), hydration delays, error containment, and graceful timeout recovery.
* **Mock Environment UI:** Spins up a local HTTP server inside the test runner using lightweight frameworks (e.g., `fastify` or `express`) capable of simulating network issues:
* *The Settle Simulator:* Serves a page that waits 3 seconds before injecting a grid via JavaScript, validating that our `postLoadDelay` allows components to render fully before scanning.
* *The Hang Simulator:* Drops incoming connections or sleeps for over 2 minutes, verifying that the browser terminates the process gracefully at the 120-second ceiling, records a `TIMEOUT`, and continues processing the rest of the queue.



---

## 📋 3. BDD Behavioral Feature Specifications

We define our end-to-end integration boundaries using human-readable, behavioral Gherkin-style assertions. These criteria guide the construction of our Playwright test loops.

### Feature: Resilient Connection Management & Settle Delay

> **Given** a target endpoint requires 3000ms to hydrate complex data fields,
> **And** the profile defines a `postLoadDelay` value of `4000`,
> **When** the browser orchestrator initiates connection protocols to the URL,
> **Then** the engine must wait until the active network drops to zero requests (`networkidle`),
> **And** it must apply a non-blocking pause of exactly 4000ms,
> **And** only then execute active compliance checks (`axe-core`), ensuring no dynamic tree elements are missed.

### Feature: Graceful Timeout Degradation

> **Given** a sluggish or unresponsive federal endpoint fails to respond,
> **When** the page loading sequence exceeds the strict `120000ms` global boundary,
> **Then** the engine must interrupt the network request,
> **And** catch the navigation exception without halting the Node runtime execution block,
> **And** log a `TIMEOUT` error status directly to that item's `PageScanReport` schema array,
> **And** advance immediately to process the next scheduled target in the queue.

### Feature: Single-Hit Local Snapshot Isolation

> **Given** an execution run targets a multi-page array,
> **When** the browser processes a valid destination,
> **Then** it must extract the fully hydrated DOM layout state via a single query execution,
> **And** stream that content directly into a local `.html` snapshot cache file on disk,
> **And** immediately close the browser instance window,
> **And** feed that local snapshot to all remaining analyzers (readability, alt-text, overlays) 100% offline, guaranteeing no additional network queries hit production systems.

---

## 🚀 4. Automated CI/CD Test Guardrails

Our testing strategy is hardcoded straight into the repository's continuous integration automation to ensure no broken code reaches production.

```yaml
# Conceptual workflow test segment integrated into development branches
- name: Execute Type Check & Code Linting
  run: npm run lint

- name: Run TDD Unit Tests (Schema & Parsers)
  run: npx vitest run unit

- name: Run Offline Fixture Integration Matrix
  run: npx vitest run integration

- name: Execute Playwright Behavioral Tests (Local Mock Servers)
  run: npx vitest run e2e

```

* **Pre-Commit Isolation:** Code adjustments cannot pull down live remote elements during the automated testing process. Every tier operates entirely inside container memory using localized mock definitions.
* **Deployment Blocking:** If a change changes calculation weights, breaks schema structures, or drops timeout exceptions, the GitHub Actions build step fails immediately. This blocks deployment to the live dashboard on GitHub Pages, keeping the core platform reliable.
# Tasks: Siteimprove Replacement for US Government

## Phase 1 - Foundation

### WP01: Establish Alfa integration baseline

- [ ] T001 Add Alfa execution path suitable for CI and local runs
- [ ] T002 Capture and persist raw Alfa result payloads for scanned pages

Depends on: None
Refs: FR-1, FR-2, FR-3

### WP02: Normalize findings across Alfa and Axe

- [ ] T001 Define canonical normalized finding schema
- [ ] T002 Implement Alfa + Axe adapters to normalized schema
- [ ] T003 Add crosswalk fixtures and normalization unit tests

Depends on: WP01
Refs: FR-4

## Phase 2 - Prioritization and Reporting

### WP03: Implement consensus prioritization


- [ ] T001 Build overlap classifier (consensus/alfa-only/axe-only)
- [ ] T002 Apply priority tiers and deterministic sorting logic

Depends on: WP02
Refs: FR-5

### WP04: Extend JSON exports and dashboard summaries

- [ ] T001 Add consensus fields to run JSON artifacts
- [ ] T002 Add consensus and trend summary views to dashboard

Depends on: WP03
Refs: FR-6, FR-9

## Phase 3 - CI and Hardening

### WP05: Harden CI, history persistence, and rollout docs

- [ ] T001 Validate workflow reliability and runtime guardrails
- [ ] T002 Finalize operational docs and rollout guidance

Depends on: WP04
Refs: FR-7, FR-8

## Baseline validation result

After initializing submodules, `npm test` passes.

Results:
- TypeScript validation passed.
- Profile contract validation passed.
- Standards source validation passed.
- Unit test suite passed: 31 files, 307 tests.

Conclusion:
The current codebase is healthy enough to proceed. Discovery should now focus on reconciling `tasks.md` with the existing implementation, because several listed tasks appear already implemented.

## Task reconciliation finding

`tasks.md` is stale relative to the codebase.

WP03 "Implement consensus prioritization" appears substantially implemented:

Evidence:
- `src/engine/reporters/consensus-prioritizer.ts` exists.
- `run-history.ts` imports `ConsensusPrioritizer` and persists consensus totals.
- `sqlite-persister.ts` stores `consensus_failure`, `alfa_only_failure`, and `axe_only_failure`.
- `dashboard-compiler.ts` exposes consensus, axe-only, and alfa-only counts in dashboard summaries.
- `tests/unit/consensus-prioritizer.test.ts` covers consensus/alfa-only/axe-only classification.
- `tests/unit/dashboard-compiler.test.ts` verifies overlap counts in latest summary artifacts.
- `tests/unit/run-history-reporter.test.ts` verifies consensus data in trends.

Conclusion:
WP03 should be marked complete or reviewed for small gaps, not started from scratch.


## WP01-WP03 reconciliation

WP01 appears implemented:
- `src/engine/workers/alfa-worker.ts` exists.
- Alfa raw results are present during run processing.
- `run-history-reporter.test.ts` confirms heavy Alfa raw results are stripped from persisted run payloads, while the in-memory result keeps them.
- This means raw Alfa capture exists, but long-term persistence intentionally avoids storing the heavy payload in `latest.json`.

WP02 appears implemented:
- `src/types/normalized-finding.ts` defines `NormalizedFindingSchema`.
- `src/engine/reporters/normalized-finding-adapter.ts` adapts Axe and Alfa findings.
- `tests/unit/normalized-finding-schema.test.ts` validates the schema.
- `tests/unit/normalized-finding-adapter.test.ts` validates Axe and Alfa normalization.

WP03 appears implemented:
- `src/engine/reporters/consensus-prioritizer.ts` exists.
- `run-history.ts`, `sqlite-persister.ts`, and `dashboard-compiler.ts` consume consensus fields.
- `tests/unit/consensus-prioritizer.test.ts` validates consensus, alfa-only, and axe-only buckets.
- `tests/unit/dashboard-compiler.test.ts` validates overlap counts in summary artifacts.
- `tests/unit/run-history-reporter.test.ts` validates consensus trend output.

Conclusion:
The active mission state is stale. The codebase is ahead of `tasks.md`. The real next work is WP04 validation/completion and WP05 hardening, not WP01-WP03 implementation.


## WP04 reconciliation

WP04 "Extend JSON exports and dashboard summaries" appears substantially implemented.

Evidence:
- `dist/api/weekly-ratings.json` exists.
- `dist/api/weekly-trends.json` exists.
- `dist/api/weekly-top-rules.json` exists.
- `dist/api/run-directory.json` exists.
- `src/engine/reporters/run-history.ts` writes weekly ratings, weekly trends, and weekly top rules.
- `dashboard-compiler.ts` renders consensus, axe-only, and alfa-only dashboard summaries.
- `tests/unit/dashboard-compiler.test.ts` validates page-level overlap counts.
- `tests/unit/run-history-reporter.test.ts` validates consensus trend output.

Conclusion:
WP04 is likely implemented. Remaining work is validation, polish, and workflow hardening, not core implementation.


## WP05 reconciliation

WP05 is partially implemented.

Evidence:
- `.github/workflows/vital-scan.yml` has scheduled recurring scans.
- The scan workflow restores historical run data from GitHub Pages before scanning.
- It supports `force_rescan`, `force_priority_seed_refresh`, and `clear_history`.
- It runs target clusters in a matrix.
- It caches Playwright and Wappalyzer dependencies.
- It installs Chromium, and optionally Firefox/WebKit for deeper scans.
- `.github/workflows/pages-quality-gate.yml` validates docs, links, guardrail tests, and axe smoke checks.
- `.github/workflows/monitor-actions-failures.yml` opens and closes failure-tracking issues for failed/successful workflows.

Important mismatch:
- The mission goal is a recurring weekly report, but `vital-scan.yml` currently runs hourly during off-hours:
  `0 4-10 * * *`
- This may be intentional for incremental scanning, but the user-facing product should still be framed as weekly reporting.
- Discovery must decide whether to keep hourly incremental scans and publish weekly rollups, or change the schedule to a true weekly cadence.

Conclusion:
Core workflow hardening exists. Remaining WP05 work is mainly:
1. Confirm schedule intent.
2. Confirm history persistence works in deployed GitHub Pages.
3. Document operational workflow.
4. Ensure weekly reporting language matches actual scan cadence.


