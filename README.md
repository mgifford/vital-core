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

- CI-safe checks (`npm test` / `npm run test:ci`): type validation, profile contract checks, and deterministic unit tests.
- Live phase checks (`npm run test:phase:live`): network and browser-dependent validations for discovery/browser/worker/reporter flows.

Coverage reports are generated to `coverage/` and uploaded by the CI workflow (`.github/workflows/ci-tests.yml`).

## Third-Party Tool Submodules

This repository tracks upstream scanner source repositories as submodules to make updates easy and reviewable.

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
