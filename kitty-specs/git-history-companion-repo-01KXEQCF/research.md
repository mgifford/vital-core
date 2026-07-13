# Research: Move `data/` into a companion repo

## R1 — Does the companion repo need to carry `data/`'s existing git history?

**Decision**: No. Start the companion repo with a single fresh baseline
commit containing the current `data/` tree; do not port `vital-core`'s
existing history for that subtree.

**Rationale**: Mission B3's stated goal (`docs-internal/ROADMAP-2026-07.md`,
`ARCHITECTURE.md` "Git history policy") is a repo whose history *can be
periodically truncated* — the whole point is to stop paying for permanent
history retention on scan-bot data. Porting existing history via
`git filter-repo --path data/` (or a subtree split) would recreate the same
1.8 GB problem inside the new repo on day one, just moved sideways instead
of solved. A fresh baseline commit gets the immediate benefit (small repo,
truncatable going forward) with zero migration risk of accidentally
mangling history semantics. `vital-core`'s own history keeps every past
`data/` blob unless/until Mission B3 option (a) (history rewrite) is
separately decided — this mission doesn't need to touch that to satisfy its
acceptance criteria (NFR-02 explicitly says don't rewrite `vital-core`
history).

**Alternatives considered**: `git filter-repo` subtree split preserving
history — rejected as pointless overhead for a repo whose whole purpose is
disposable/truncatable history. A shallow/depth-limited clone as a
middle ground — rejected as unnecessary complexity; the companion repo can
simply be truncated (e.g. squash-and-force-push, or a fresh orphan branch
periodically) whenever it grows too large, same idea applied later rather
than at creation.

## R2 — How does CI authenticate to push to the companion repo?

**Finding**: `.github/workflows/report.yml` currently uses the default
`${{ github.token }}` (`permissions: contents: write` at workflow level,
`.github/workflows/report.yml:28-31`). The default `GITHUB_TOKEN` is scoped
to the triggering repository only — it cannot authenticate a push to a
second, separate GitHub repository (`vital-core-data`).

**Decision needed (open, not resolved by this mission)**: a cross-repo
credential must be added as a new repository secret before IC-03 can be
implemented. Options, in order of preference:

1. **Fine-grained PAT** scoped only to `vital-core-data`, contents:
   read/write, stored as a new Actions secret (e.g. `DATA_REPO_TOKEN`).
   Simplest to set up; owned by whichever GitHub account creates it
   (expires on a schedule, needs periodic rotation).
2. **GitHub App installation token** scoped to `vital-core-data` — more
   setup (register an App, install it on the target repo) but doesn't tie
   the credential to a personal account and doesn't expire the same way.
3. Reject cross-repo push entirely and instead have the companion repo's
   own workflow pull from `vital-core`'s published `docs/api/v1/` JSON —
   rejected: `data/` is raw scan/audit output that `docs/` summarizes,
   not a superset; the companion repo needs the raw `data/` tree itself,
   not the aggregated API output.

**This is a real, user-facing decision** — creating a secret in repository
settings is exactly the kind of "explicit permission required" /
account-settings action this project's operating rules reserve for the
user. It should be surfaced at `/spec-kitty.tasks` or WP-implementation
time as a blocking prerequisite for IC-03, not silently assumed.

## R3 — Companion repo visibility and naming

**Decision**: Public, named `vital-core-data`, owned by the same GitHub
account/org as `vital-core` (`mgifford`). Rationale: `vital-core`'s own
`data/` content is already public (published to GitHub Pages via `docs/`,
which is built from it), so there is no new disclosure by making the raw
`data/` companion repo public too — keeping it public also avoids needing
any read-side authentication for local dev clones or for a possible future
public mirror/archive use. VA domains never enter this repo (already
gitignored upstream, confirmed in `data/.gitignore` entries for
`data/www.va.gov/` etc. — see spec.md Non-goals).

## R4 — Migration mechanics (one-time cutover)

**Sequence** (maps to plan.md's IC-01/IC-02):

1. Create `vital-core-data` (empty, on GitHub).
2. From a scratch clone of `vital-core` at current `HEAD`: copy `data/`
   content into the new repo's working tree, commit as a single baseline
   commit, push to `vital-core-data` `main`.
3. In `vital-core`: `git rm -r --cached data/`, add `data/` to
   `.gitignore`, commit. This is a large single commit (68,703 file
   removals from the index) — confirm no pre-commit hook chokes on commit
   size before running it for real (flagged as a risk in plan.md IC-02).
4. Re-clone `vital-core-data` into `vital-core`'s local `data/` afterward
   so local `npm run scan`/`npm run aggregate` keep working immediately.

**Rollback**: until step 3 is pushed, nothing is destructive — `data/`
still exists in `vital-core`'s tracked history regardless of what's copied
elsewhere. After step 3, reverting means re-running
`git checkout <commit-before-step-3> -- data/` and un-ignoring — recorded
here so a future reader knows the cutover commit is the point of no
easy return (though `vital-core`'s history still has the data, just no
longer in the working tree by default).

## Open questions carried into tasks/implementation

- R2's credential choice needs a user decision before IC-03 can be
  implemented (who creates the PAT/App, expiration policy).
- Truncation cadence/mechanism for `vital-core-data` itself (how often,
  squash vs. orphan-branch vs. just periodically deleting the repo and
  reseeding) is intentionally left for a future mission — Mission B3's
  acceptance criteria only require that the companion repo's history *can*
  be truncated, not that a cadence is implemented now.
