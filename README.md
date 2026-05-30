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

## Testing Infrastructure

The project splits testing into two tiers:

- CI-safe checks (`npm test` / `npm run test:ci`): type validation, profile contract checks, standards-source integrity checks, and deterministic unit tests.
- Live phase checks (`npm run test:phase:live`): network and browser-dependent validations for discovery/browser/worker/reporter flows.

Coverage reports are generated to `coverage/` and uploaded by the CI workflow (`.github/workflows/ci-tests.yml`).

Standards-source integrity is validated by `tests/smoke/validate-standards-source.ts` and confirms that the ScanGov standards submodule and canonical standards data mappings are present for reporting.

## Page Technology Profiling

Each scanned page now includes a CMS/framework technology fingerprint in `technologyStack`, powered by `wappalyzer-next`.

- Default command: `wappalyzer`
- Override command path: set `VITAL_WAPPALYZER_CMD`
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
- `runs/page-state.json` (per-URL change metadata for incremental rescans)
- `runs/top-task-seeds.json` (monthly DuckDuckGo-derived priority URL seeds)

The scan workflow restores previously published run history before generating a new run, then merges and republishes the updated index.

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

1. DuckDuckGo priority seeds
2. Profile `priority_urls`
3. Filtered sitemap URLs

Discovery filters now default to:

- Host scope only (`target.base_url` host only; no wildcard subdomain fan-out)
- HTML-like URLs only (non-HTML assets such as PDF, DOCX, XLSX, XML, media, fonts, RSS excluded)

You can opt into subdomain crawling per target by setting `settings.include_subdomains: true`.

To keep large URL sets fresh across runs, the scheduled workflow now sets `VITAL_SAMPLING_SEED` per run.
This rotates sitemap sampling order while keeping each run deterministic and reproducible.

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
