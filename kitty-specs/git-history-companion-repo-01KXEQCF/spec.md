# Mission: Move `data/` into a companion repo

## Status: ON HOLD (fallback plan) — 2026-07-14

Root-caused instead: the growth wasn't primarily page-level detail, it was
`aggregate.js`/ledger modules unconditionally rewriting unchanged content
on every run. Fixed in PR #235 by skipping no-op writes rather than
executing this mission's companion-repo split — see
`ARCHITECTURE.md`'s "Git history policy" section and
`docs-internal/ROADMAP-2026-07.md` Mission B3 for the full writeup.

This does **not** shrink the history already committed (~1.9 GB) — only
this mission's companion-repo split, or a history rewrite, would do that.
The spec/plan/research below remain valid if the write-pattern fix proves
insufficient (watch `report.yml`'s new run-over-run growth alert — it now
fires on renewed fast growth rather than the one-time 1 GB threshold,
which already fired and won't fire usefully again). Resume from `plan.md`'s
Implementation Concern Map if this mission needs to be picked back up.

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

## Non-goals

- Rewriting/squashing existing `vital-core` git history (option (a) — out of
  scope, needs its own charter decision).
- Changing `retention_weeks` or the working-tree pruning behavior in
  `src/prune.js` (Mission B1/B2 — already done, unrelated).
- Migrating VA domain data (already gitignored, never entered history).

## Functional Requirements

| ID | Requirement | Status |
|---|---|---|
| FR-001 | A new companion repo (e.g. `vital-core-data`) is created and contains the current `data/` content, with history that can be periodically truncated independently of `vital-core` | Pending |
| FR-002 | `vital-core`'s `data/` directory is removed from the working tree and added to `.gitignore` (matching how VA domains are already handled) | Pending |
| FR-003 | Access mechanism is a **separate clone/checkout step**, not a git submodule — CI and local dev explicitly clone/checkout the companion repo into `data/` (e.g. a second `actions/checkout` step in `report.yml`, and a documented local step for contributors). No submodule pointer is committed to `vital-core` | Pending |
| FR-004 | `npm run scan` and `npm run aggregate` work unchanged from a contributor's point of view aside from the new setup step (docs updated, e.g. "clone the companion repo into data/ first" in README/CLAUDE.md dev-setup instructions) | Pending |
| FR-005 | `.github/workflows/report.yml` is updated: a checkout step fetches the companion repo into `data/` before scan/aggregate runs, and the workflow commits/pushes updates back to the companion repo instead of `vital-core` | Pending |
| FR-006 | The 1 GB size-check gate job's warning condition and text are updated to reflect the new reality (either checking the companion repo's size too, or removing the now-resolved warning for `vital-core` itself) | Pending |
| FR-007 | `ARCHITECTURE.md` "Git history policy" paragraph is rewritten to describe the companion-repo split as implemented (repo name, how scan/aggregate reach it, truncation cadence if decided) | Pending |
| FR-008 | `docs-internal/ROADMAP-2026-07.md` Mission B3 checkbox/notes are updated with resolution date and a pointer to this mission | Pending |

## Non-Functional Requirements

| ID | Requirement | Status |
|---|---|---|
| NFR-01 | No change to committed data shapes (summary.json/findings.json/etc schemas) — this is a storage-location change only | Pending |
| NFR-02 | Existing `vital-core` git history is not rewritten or squashed as part of this mission | Pending |
| NFR-03 | `npm run test:unit` and `npm run test:e2e` pass after the change | Pending |

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
