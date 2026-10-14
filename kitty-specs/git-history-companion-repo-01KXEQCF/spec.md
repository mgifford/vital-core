# Mission: Move `data/` into a companion repo

## Status: DONE, 2026-10-14 (companion-repo split executed)

The split this mission planned was carried out on 2026-10-14, after the
July rewrite (below) proved temporary: `.git` grew back from 128 MB to
2.4 GB by 2026-10-13.

- **Companion repo:** [mgifford/vital-core-data](https://github.com/mgifford/vital-core-data),
  built with `git filter-repo --subdirectory-filter data/` from `vital-core`
  `d2f549dc`, so it keeps the full history of `data/` (3,314 commits,
  965 MiB; tree identical to `d2f549dc:data`), plus a `.gitignore` for the
  four VA (`hf_only`) domains.
- **Code repo:** PR #272 untracked and gitignored `data/`, added a
  `data_repo` config key (global default `mgifford/vital-core-data`,
  per-target override, refused on `hf_only` targets), and pointed
  `scan.yml` / `report.yml` at the data repo, pushing with the
  `VITAL_DATA_DEPLOY_KEY` deploy key. PR #273 passed secrets to the called
  report and lowered `CODE_CEILING_MB` to 100.
- **History:** with explicit owner approval in chat (charter
  `historical-evidence-preservation` exception), `data/` was then purged
  from `vital-core` history: pack 970 MiB -> 4.7 MiB, commits 4,239 -> 915,
  `HEAD^{tree}` unchanged. Unit and e2e tests passed before the force-push.
  A day earlier, `state/` had moved to the `scan-state` release (PR #270)
  and been purged the same way.
- **Verified in CI:** dispatched scans (38547163201, 38550904552) pushed to
  the data repo; report run 38547567319 committed there and deployed Pages.

See `ARCHITECTURE.md` ("Data repo (since 2026-10-14)" and "Third history
rewrite") for the full record. The July text below is kept as history.

### Earlier status: superseded by in-place history rewrite, 2026-07-14

Root-caused first: the growth wasn't primarily page-level detail, it was
`aggregate.js`/ledger modules unconditionally rewriting unchanged content
on every run. Fixed in PR #235 by skipping no-op writes (stops the
*growth rate*, does not shrink existing history).

This mission's spec/plan/research (below) describe the companion-repo
split that was the fallback plan if the growth-rate fix proved
insufficient. Instead, the owner authorized a **one-time in-place git
history rewrite** (charter `historical-evidence-preservation` exception,
added 2026-07-14) as a simpler, equally-effective way to shrink the
already-committed ~1.9 GB, without taking on a permanent second repo,
cross-repo CI checkout/push wiring, or a new cross-repo credential
(FR-003/FR-005/R2 below, all now moot).

**What actually ran:** `git filter-repo --path data/ --path state/
--invert-paths` against a mirror-backed working clone of `main`, stripping
every historical version of those two directories from every commit, then
re-adding current `data/` + `state/` content as one fresh commit. Verified
byte-identical working tree (`HEAD^{tree}` hash match before/after),
`.git` 1.8 GB → 128 MB, `npm run test:unit` + `test:e2e` passing against
the rewritten repo, before any force-push. See `ARCHITECTURE.md`'s "Git
history policy" section and `docs-internal/ROADMAP-2026-07.md` Mission B3
for the full writeup and evidence.

In July the mission was closed as superseded. It was reopened and
completed in October (see Status above); the FR/NFR tables below now
record the October outcome.

## Problem

`data/` (68,703 tracked files as of 2026-07-13) is committed directly into
`vital-core`, and `src/prune.js` only deletes files from the working tree —
git history keeps every blob forever. The roadmap (`docs-internal/ROADMAP-2026-07.md`
Mission B3, decided 2026-07-03) accepted this growth on the condition that a
daily size check in `.github/workflows/report.yml` would flag when the
server-side repo size passed 1 GB, at which point option (b) — move `data/`
to a companion repo whose history can be periodically truncated — would be
executed.

That trigger has now fired:
- GitHub Actions run [29287101399](https://github.com/mgifford/vital-core/actions/runs/29287101399)
  reported server-side repo size over 1 GB (`::warning title=Repository over 1 GB::...`).
- Local `.git` is 1.8 GB (`git count-objects -v`: 232,210 objects, 21 packs).
- `data/` alone is 824 MB in the working tree.

This mission executes option (b) from `ARCHITECTURE.md`'s "Git history
policy" section and Mission B3.

## Goals

1. `data/` (the committed portion — VA domains under `data/www.va.gov/` etc.
   are already gitignored and excluded) moves to a new companion repo,
   `vital-core-data` (or similar), whose history can be periodically
   truncated without affecting `vital-core`'s own history.
2. `vital-core` (code repo) stops accumulating new `data/` blobs going
   forward. Existing history in `vital-core` is **not rewritten** as part of
   this mission (rewriting history conflicts with the append-only doctrine
   per B3's option (a) rejection, and requires separate charter
   coordination) — this mission only stops the bleeding and relocates
   future growth.
3. `npm run scan`, `npm run aggregate`, and CI (`report.yml`) all continue to
   work against the new location (local checkout of the companion repo, or
   equivalent), with no change in report output or the static JSON API.
4. `ARCHITECTURE.md`'s "Git history policy" paragraph and
   `docs-internal/ROADMAP-2026-07.md` Mission B3 are updated to reflect the
   decision actually executed and the date it happened.

## Non-goals (as originally scoped; superseded — see Status)

- Rewriting/squashing existing `vital-core` git history (option (a) — was
  out of scope pending its own charter decision). **That charter decision
  was subsequently obtained** (2026-07-14 exception) and this is exactly
  what resolved the mission instead — recorded here for the historical
  record, not as a still-standing non-goal.
- Changing `retention_weeks` or the working-tree pruning behavior in
  `src/prune.js` (Mission B1/B2 — already done, unrelated). Still true.
- Migrating VA domain data (already gitignored, never entered history).
  Still true.

## Functional Requirements

Executed 2026-10-14 (see Status). One deviation from the July plan: the
companion repo kept the full `data/` history rather than starting from a
fresh baseline, to preserve evidence.

| ID | Requirement | Status |
|---|---|---|
| FR-001 | A new companion repo (e.g. `vital-core-data`) is created and contains the current `data/` content, with history that can be periodically truncated independently of `vital-core` | ✓ Done 2026-10-14 — `mgifford/vital-core-data`, full history; no truncation cadence decided |
| FR-002 | `vital-core`'s `data/` directory is removed from the working tree and added to `.gitignore` (matching how VA domains are already handled) | ✓ Done 2026-10-14 — PR #272 |
| FR-003 | Access mechanism is a **separate clone/checkout step**, not a git submodule — CI and local dev explicitly clone/checkout the companion repo into `data/` (e.g. a second `actions/checkout` step in `report.yml`, and a documented local step for contributors). No submodule pointer is committed to `vital-core` | ✓ Done 2026-10-14 — second `actions/checkout` into `data/` in scan.yml and report.yml; README documents the local clone |
| FR-004 | `npm run scan` and `npm run aggregate` work unchanged from a contributor's point of view aside from the new setup step (docs updated, e.g. "clone the companion repo into data/ first" in README/CLAUDE.md dev-setup instructions) | ✓ Done 2026-10-14 — code paths unchanged (`DIRS.data`); README updated |
| FR-005 | `.github/workflows/report.yml` is updated: a checkout step fetches the companion repo into `data/` before scan/aggregate runs, and the workflow commits/pushes updates back to the companion repo instead of `vital-core` | ✓ Done 2026-10-14 — report.yml (and scan.yml) commit and push to the data repo |
| FR-006 | The 1 GB size-check gate job's warning condition and text are updated to reflect the new reality (either checking the companion repo's size too, or removing the now-resolved warning for `vital-core` itself) | ✓ Done 2026-10-14 — growth checks track the data repo; `CODE_CEILING_MB` 100 for this repo (PR #273) |
| FR-007 | `ARCHITECTURE.md` "Git history policy" paragraph is rewritten to describe the companion-repo split as implemented (repo name, how scan/aggregate reach it, truncation cadence if decided) | ✓ Done 2026-10-14 — ARCHITECTURE.md "Data repo (since 2026-10-14)" |
| FR-008 | `docs-internal/ROADMAP-2026-07.md` Mission B3 checkbox/notes are updated with resolution date and a pointer to this mission | ✓ Done — 2026-07-14 for the rewrite; 2026-10-14 for the split (B3 "SECOND FOLLOW-UP RESOLVED 2026-10-14", pointing to this mission) |

## Non-Functional Requirements

| ID | Requirement | Status |
|---|---|---|
| NFR-01 | No change to committed data shapes (summary.json/findings.json/etc schemas) — this is a storage-location change only | ✓ Done — storage location only; data repo tree identical to `data/` |
| NFR-02 | Existing `vital-core` git history is not rewritten or squashed as part of this mission | Superseded by owner decision — `vital-core` history was rewritten (2026-07-14, and again 2026-10-13/14 to purge `state/` and `data/`), each under an explicit one-time charter exception; the data history is preserved in the data repo |
| NFR-03 | `npm run test:unit` and `npm run test:e2e` pass after the change | ✓ Done — 533 unit tests and e2e passed on the rewritten repo before each force-push |

## Sustainability gate

This mission is infrastructure/storage-location only — no new client-side
JavaScript, no new page weight, no change to build-time vs request-time
work. The change is justified as a housekeeping fix for unbounded git
history growth (the exact kind of resource waste the sustainability charter
cares about at the infra level), not a new feature. No progressive
enhancement consideration applies.

## Context / prior decisions

See `docs-internal/ROADMAP-2026-07.md` Mission B ("Data lifecycle: keep
trends, forget detail") and `ARCHITECTURE.md`'s "Retention contract" /
"Git history policy" paragraphs for the full owner-decided context this
mission builds on.
