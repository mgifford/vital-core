# vital-core
A quality scanner for websites built for the US government. 

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
