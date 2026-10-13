# Plan: Crawl State as Release Assets

Mission `crawl-state-release-assets-01M4VRB7`. Owner decisions (2026-10-13,
in chat): design approved as written (`--clobber`, no temp-name rename);
bootstrap by script right after merge; watchdog at 100 MB per ~7 days and
a 2.6 GB ceiling.

Mission scaffolded by hand: `spec-kitty specify` refuses to run inside a
git worktree, and the main checkout is shared with other sessions.

## WP01: Release-asset helper (AC5, AC10)

- `src/lib/state-release.js`: pure helpers (tag, asset name, `hf_only`
  guard, not-found classifier).
- `scripts/state-release.js`: `download`, `download-all`, `upload`,
  `bootstrap <ref>` over the `gh` CLI, with gzip via `node:zlib`.
- `tests/unit/state-release.test.js`.
- Check: unit tests; `download www.va.gov` exits 1; a missing release gives
  "seed fresh" with exit 0; bad credentials exit 1.

## WP02: Workflows (AC2, AC4, AC8)

- `scan.yml`: drop `state` from both sparse checkouts; matrix runs
  `download-all` before `list-scan-domains.js`; scan job adds "Restore
  crawl state" (id `restore`) and "Save crawl state" (`if: always() &&
  steps.restore.outcome == 'success'`); commit step stages `data/` only.
- `report.yml`: keep run-over-run; add `data/.repo-size-history` (60
  lines), a 7-day growth check and an absolute ceiling.
- Check: awk lookup tested on sample history; workflow_dispatch run (AC3).

## WP03: Untrack state (AC1)

- `.gitignore` adds `state/` (VA entries kept); `git rm -r --cached state/`.
- Check: `git ls-files state/` is empty; working-tree files still present.

## WP04: Docs (AC9)

- ARCHITECTURE.md: regrowth note, crawl-state storage, alerting, retention
  value, pipeline text. README.md and CLAUDE.md state bullets.

## WP05: Verify and roll out (AC3, AC6, AC7)

1. Before merge: `node scripts/state-release.js bootstrap origin/main
   <small-domain>`, then run workflow_dispatch `scan.yml` on the PR branch
   for that domain with a small budget. Check the log for restore, resume
   and upload, and that the commit has no `state/` paths.
2. `npm run test:e2e` covers local on-disk state (AC6).
3. Right after merge (before that night's scans):
   `node scripts/state-release.js bootstrap <merge-commit>^1` uploads every
   non-VA domain's last committed state (AC7).

## Follow-up (separate, needs its own approval)

A one-time history rewrite to drop the ~1.4 GB of `state/` blobs already in
the pack, under the charter's `historical-evidence-preservation` directive.
