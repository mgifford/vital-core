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

## Scan Politeness and Adaptive Timeout Backoff

To reduce load on upstream sites and avoid bursty same-domain traffic, page scans apply a base pause before each consecutive request to the same host.
When repeated timeouts occur on a host, VITAL-Core adds extra cooldown before the next same-host request.

- `VITAL_MAX_TIMEOUT_MS` (default workflow values by intensity: standard `30000`, light `35000`, ultra_light `45000`, deep `60000`)
- `VITAL_SAME_SITE_DELAY_MS` (default: `1500`)
- `VITAL_TIMEOUT_BACKOFF_THRESHOLD` (default: `2`)
- `VITAL_TIMEOUT_BACKOFF_STEP_MS` (default: `10000`)
- `VITAL_TIMEOUT_BACKOFF_MAX_MS` (default: `60000`)

Example behavior with defaults:

- First and second consecutive timeouts use base same-site delay only.
- Third consecutive timeout adds `10000ms` backoff.
- Fourth adds `20000ms`, capped at `60000ms`.

## Accessibility-First Audit Scope Rotation

To prioritize faster hourly accessibility coverage, VITAL-Core supports scoped audit execution:

- `VITAL_AUDIT_SCOPE=accessibility`: runs accessibility checks only (skips technology fingerprinting, Alfa, third-party differential checks, and Lighthouse).
- `VITAL_AUDIT_SCOPE=full`: runs all supplemental checks.

Scheduled workflow behavior now defaults to accessibility-first scans during business-hour windows and most off-hours cycles, with full audit rotation every 6 UTC hours (plus deep refresh windows and manual runs).
