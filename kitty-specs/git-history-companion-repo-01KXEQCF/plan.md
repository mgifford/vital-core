# Implementation Plan: Move `data/` into a companion repo

**Branch**: `kitty/mission-git-history-companion-repo-01KXEQCF`
**Spec**: [spec.md](spec.md)
**Mission**: `git-history-companion-repo-01KXEQCF`

**SUPERSEDED 2026-07-14** — this plan was not executed. The mission was
resolved instead by a one-time in-place `git filter-repo` history rewrite
(owner-authorized charter exception). See spec.md's Status section and
ARCHITECTURE.md's "Git history policy" for what actually happened. The
plan below is retained as the considered companion-repo design in case
that approach is separately revisited later (e.g. for ongoing truncatable
history rather than a one-time size fix) — none of its Implementation
Concern Map items (IC-01 through IC-05) were carried out.

## Summary

Split `data/` out of `vital-core` into a new companion repo (working name
`vital-core-data`) so its history can be truncated independently of the code
repo. `vital-core` stops tracking `data/` (added to `.gitignore`, matching
the existing VA-domain pattern) and instead expects it to be populated by an
explicit clone/checkout step — a second checkout in `.github/workflows/report.yml`
CI, and a documented local step for contributors — rather than a git
submodule. `npm run scan` / `npm run aggregate` keep writing to `data/` as a
plain directory; only the git-tracking boundary changes. This mission does
not rewrite `vital-core`'s existing history (Mission B3 option (a) is
explicitly out of scope) — it only stops future growth and relocates it.

## Technical Context

**Language/Version**: Node.js ESM ≥20 (existing project stack, unchanged) plus git/bash for the CI checkout and migration scripting; no new runtime.
**Primary Dependencies**: `actions/checkout` (GitHub Action, already used in `report.yml`) for the companion-repo checkout step; no new npm dependencies.
**Storage**: A new git repo (`vital-core-data` or similar) holding the current `data/` tree; `vital-core` itself gains no new storage, it loses tracked storage.
**Testing**: `npm run test:unit` and `npm run test:e2e` must pass unchanged against a `data/` directory populated by the new checkout step instead of git-tracked commits — no test behavior change, only how `data/` gets onto disk before tests run.
**Target Platform**: GitHub Actions CI (`report.yml`) and local contributor machines (macOS/Linux dev setup, per existing README/CLAUDE.md instructions).
**Project Type**: single (existing vital-core layout; no frontend/backend split).
**Performance Goals**: N/A — infrastructure change, not a runtime performance change.
**Constraints**: Must not rewrite existing `vital-core` git history (NFR-02); must not change committed data shapes (NFR-01); CI workflow changes must keep the existing daily schedule and publish behavior working.
**Scale/Scope**: `data/` is currently 824 MB / 68,703 tracked files; `.git` is 1.8 GB. The companion repo inherits this scale and is expected to need periodic truncation itself (that cadence/mechanism is a follow-up, not required by this mission's acceptance criteria).

## Charter Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Sustainability gate**: this mission is pure infrastructure/storage-location
  housekeeping — no new client-side JavaScript, no new page weight, no
  change to build-time vs. request-time work. It directly serves the
  sustainability charter's concern with unbounded resource growth (git
  history size). PASS by construction; spec.md's Sustainability Acceptance
  Criterion documents this.
- **Security rules**: does not touch `.env`/`HF_TOKEN` handling or VA-domain
  `hf_only` gating. VA domains are already gitignored and never enter
  `data/`'s git history, so this migration does not touch them. PASS.
- **Severity taxonomy / IA conventions**: not applicable — no report-facing
  change, no page renames, no new findings surfaced.

## Project Structure

### Documentation (this mission)

```
kitty-specs/git-history-companion-repo-01KXEQCF/
├── spec.md               # Mission specification
├── plan.md               # This file
├── research.md           # Phase 0 output (companion-repo creation approach)
├── tasks/                # Phase 2 output (/spec-kitty.tasks — not this phase)
```

### Source Code (repository root)

```
vital-core/                       # this repo — code only after migration
├── .gitignore                    # gains a `data/` entry (mirrors va.gov domain entries)
├── .github/workflows/report.yml  # gains a companion-repo checkout step + push-back step
├── ARCHITECTURE.md                # "Git history policy" paragraph rewritten
├── docs-internal/ROADMAP-2026-07.md  # Mission B3 marked resolved with date
├── CLAUDE.md / README.md          # dev-setup note: clone companion repo into data/
└── data/                          # untracked working directory, populated by checkout

vital-core-data/                  # new companion repo (separate GitHub repo)
└── <domain>/<week>/...           # same tree currently under vital-core's data/
```

**Structure Decision**: Single-project layout is unchanged; the only
structural addition is the new companion repo as a sibling GitHub
repository, referenced from `vital-core` via an explicit checkout step (not
a submodule, not a subtree).

## Complexity Tracking

*Fill ONLY if Charter Check has violations that must be justified*

No charter violations — table intentionally left empty.

## Implementation Concern Map

### IC-01 — Companion repo creation and initial content migration

- **Purpose**: Create the new companion repo and populate it with the
  current `data/` content so nothing is lost when `vital-core` stops
  tracking it.
- **Relevant requirements**: FR-001
- **Affected surfaces**: new external repo (not in this codebase); one-time
  migration script/commands (not part of `src/`).
- **Sequencing/depends-on**: none — must happen first.
- **Risks**: Decide during task breakdown whether to carry `data/`'s existing
  git history into the companion repo (via `git filter-repo`/subtree split)
  or start with a single fresh baseline commit. Given B3's stated goal is a
  repo whose history *can be truncated*, starting fresh (no inherited
  history) is the simpler and likely preferred option — but this is a real
  decision to confirm before implementation, not assumed here.

### IC-02 — Stop tracking `data/` in vital-core

- **Purpose**: Remove `data/` from `vital-core`'s working tree tracking and
  add it to `.gitignore`.
- **Relevant requirements**: FR-002
- **Affected surfaces**: `.gitignore`, one commit removing `data/` from the
  index (`git rm -r --cached data/`).
- **Sequencing/depends-on**: IC-01 (must not remove tracking until content is
  safely in the companion repo).
- **Risks**: `git rm --cached` on 68,703 files is a large single commit;
  confirm it doesn't trip any pre-commit hook size limits.

### IC-03 — CI checkout/push-back wiring

- **Purpose**: `.github/workflows/report.yml` checks out the companion repo
  into `data/` before scan/aggregate, and commits/pushes result back to the
  companion repo instead of `vital-core`.
- **Relevant requirements**: FR-003, FR-004, FR-005
- **Affected surfaces**: `.github/workflows/report.yml` (checkout step,
  commit/push step, any `GITHUB_TOKEN`/PAT scoping needed for cross-repo
  push), README/CLAUDE.md dev-setup docs.
- **Sequencing/depends-on**: IC-01, IC-02.
- **Risks**: Cross-repo push from Actions needs a token with write access to
  the companion repo — the default `GITHUB_TOKEN` is scoped to the
  triggering repo only, so a PAT or GitHub App token will likely be needed
  as a new repo secret. This is a real operational dependency to flag before
  implementation.

### IC-04 — Size-check gate update

- **Purpose**: Update or replace the 1 GB size-check warning in
  `report.yml` now that its trigger condition has been acted on.
- **Relevant requirements**: FR-006
- **Affected surfaces**: `.github/workflows/report.yml` (the "Check
  repository size" step).
- **Sequencing/depends-on**: IC-03.
- **Risks**: Decide whether to also monitor the companion repo's size (so a
  future truncation trigger exists) or drop the check now that `vital-core`
  itself is no longer expected to grow unbounded.

### IC-05 — Documentation updates

- **Purpose**: `ARCHITECTURE.md` and `docs-internal/ROADMAP-2026-07.md`
  reflect the decision as executed, not just as planned.
- **Relevant requirements**: FR-007, FR-008
- **Affected surfaces**: `ARCHITECTURE.md` ("Git history policy" paragraph),
  `docs-internal/ROADMAP-2026-07.md` (Mission B3 entry).
- **Sequencing/depends-on**: IC-01 through IC-04 (docs should describe what
  was actually built).
- **Risks**: none significant.
