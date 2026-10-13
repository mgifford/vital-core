# Spec: Crawl State as Release Assets, Not Git Blobs

**Mission**: `crawl-state-release-assets-01M4VRB7`
**Target branch**: `main`
**Status**: Implemented; CI round-trip verified (runs 38483595325, 38483424311); PR #270; post-merge bootstrap pending

---

## Purpose

Stop committing `state/<domain>/crawl.json` to git. Keep it on GitHub as a
per-domain asset on one rolling GitHub Release, so scan state stays durable
while `.git` stops growing with every scan.

## Problem statement

The July 2026 history rewrite took `.git` from 1.8 GB down to 128 MB. On
2026-10-13 it is back to 2.4 GB. Most of that growth is crawl state:

- `state/<domain>/crawl.json` accounts for about 1,449 MB of the pack.
- 1,101 commits touched it in 30 days.
- The largest copies are 57 MB (`www.cms.gov`), 26 MB (`www.medicaid.gov`)
  and 24 MB (`www.cdc.gov`). Each one is a single line of JSON from
  `saveState()`, so git cannot delta them well.

The file is the crawler's only mutable state. Reports never read it
(`src/scan.js` header). History of it has no evidentiary value.

The `report.yml` size watchdog also missed the problem. It only warns on
more than 50 MB of growth between two report runs, and steady growth of
about 25 MB a day never crossed that line.

## Scope

In scope:

1. CI persistence of crawl state via release assets in `scan.yml` (matrix
   job and scan job).
2. Removing `state/` from the git index and ignoring it going forward.
3. A one-time bootstrap that copies the last committed state into the
   release, so the crawl does not restart from scratch.
4. A size watchdog in `report.yml` that catches slow, steady growth.
5. Documentation: ARCHITECTURE.md, CLAUDE.md, README.md.

Out of scope:

- Rewriting git history to reclaim the 1.4 GB already in the pack. That is
  a separate, later step that needs its own explicit in-chat approval under
  the charter's `historical-evidence-preservation` directive.
- Moving `data/` out of git.
- Changing the crawl-state format or `src/lib/state.js` behavior.

## Design (confirmed by owner 2026-10-13)

- **Release**: one release, tag `scan-state`, marked prerelease so it never
  shows as the repo's "Latest" release. It is created on first upload if it
  does not exist.
- **Asset**: `<domain-key>.crawl.json.gz`, one per domain. Gzip shrinks
  `www.cms.gov` from 57 MB to 5.7 MB.
- **Scan job**: download the domain's asset into `state/<key>/crawl.json`
  before `node src/scan.js`, then upload it with `--clobber` afterwards. Each
  matrix job touches only its own asset, which keeps today's per-domain
  isolation.
- **Matrix job**: `scripts/list-scan-domains.js` reads every domain's state
  to skip domains with no budget left, so this job downloads all assets
  (about 12 MB compressed in total).
- **Missing vs failed download**: a missing asset (or missing release)
  means "seed fresh", as when `crawl.json` is absent today. Any other
  download error fails the job before scanning. A transient API error must
  never cause a fresh seed that then overwrites good state.
- **Upload guard**: upload only if the download step succeeded, so a failed
  download never clobbers the stored asset.
- **`hf_only` domains (VA)**: never touched. The matrix filter stays, and
  the helper script refuses `hf_only` targets as a second guard. Their
  `.gitignore` entries stay.
- **Local development**: unchanged. `state/` stays a plain on-disk
  directory; nothing in `src/` knows about releases.

## Acceptance criteria

1. ✓ **AC1 State not committed.** `state/` is in `.gitignore`. `git ls-files
   state/` is empty on the PR branch. Working-tree files are kept
   (`git rm -r --cached`).
2. ✓ **AC2 Workflow no longer stages state.** `scan.yml` has no `state` entry
   in either sparse checkout, and the commit step runs `git add data/` only.
3. ✓ **AC3 Round-trip.** A `workflow_dispatch` scan of one small non-VA
   domain shows, in its log: asset downloaded (or "no asset, seeding
   fresh"), scan resumed from that state, asset uploaded. The resulting
   commit contains no `state/` paths.
4. ✓ **AC4 Safe failure.** A download failure other than "not found" fails
   the job before `scan.js` runs, and the upload step does not run.
5. ✓ **AC5 VA isolation.** The helper script exits non-zero for any `hf_only`
   target. The `!t.hf_only` matrix filter is unchanged.
6. ✓ **AC6 Local dev.** `npm run scan` with `VITAL_DOMAIN` set works with no
   GitHub access, reading and writing `state/<key>/crawl.json` on disk.
7. **AC7 Bootstrap.** After merge, each non-VA domain's asset in
   `scan-state` matches the last committed `crawl.json` (same JSON after
   gunzip).
8. ✓ **AC8 Size watchdog.** `report.yml` warns when the server-reported repo
   size grows by more than a set amount over about 7 days, and when it
   exceeds a set absolute ceiling. Existing run-over-run behavior is kept.
9. ✓ **AC9 Docs.** ARCHITECTURE.md storage and alerting sections describe the
   current state (not the July 128 MB baseline as current). The retention
   text says what `config/targets.yml` actually sets (2). CLAUDE.md and
   README.md no longer say that `state/` is committed.
10. ✓ **AC10 Tests.** `npm run test:unit` passes. New pure helpers (asset
    naming, `hf_only` guard) have unit tests.

## Sustainability acceptance criterion

**AC-S.** No client-side JavaScript, page weight or report output changes.
The change cuts data transfer and storage: each scan stops adding up to
57 MB of uncompressed JSON to git history, and CI moves gzip-compressed
assets (about 10x smaller) instead of checking out raw state. Work stays at
build/CI time. No web fonts, no CSS changes.

## Risks and assumptions

- `gh release upload --clobber` may delete the old asset before the new
  upload finishes. If an upload fails mid-way, that domain loses its state
  and reseeds on the next run. That is safe (it is the existing
  "state lost" path) but it rescans pages already done that week. This is
  accepted. A stronger design would upload under a temporary name and then
  rename.
- Release assets have no history. That is intended: crawl state is
  disposable.
- The GitHub API `size` field lags behind pushes, so the watchdog is a
  trend signal, not an exact measure.
