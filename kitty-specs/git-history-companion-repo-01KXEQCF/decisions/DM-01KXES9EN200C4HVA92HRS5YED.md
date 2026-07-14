# Decision Moment `01KXES9EN200C4HVA92HRS5YED`

- **Mission:** `git-history-companion-repo-01KXEQCF`
- **Origin flow:** `plan`
- **Step id:** `plan.approach`
- **Input key:** `approach`
- **Status:** `resolved`
- **Created:** `2026-07-13T22:24:16.035019+00:00`
- **Resolved:** `2026-07-13T22:44:26.356467+00:00`
- **Resolved by:** `mike.gifford@gmail.com`
- **Opened by:** `mike.gifford@gmail.com`
- **Other answer:** `false`

## Question

What is the high-level implementation approach?

## Options

_(none)_

## Final answer

Split data/ into a new companion repo (vital-core-data). vital-core untracks data/ (adds to .gitignore) and stops committing new blobs; a separate clone/checkout step (not a submodule) populates data/ in CI and for local dev. Existing vital-core history is not rewritten. Full technical approach recorded in plan.md (Technical Context, Charter Check, Implementation Concern Map IC-01..IC-05).

## Rationale

Answer authored directly in plan.md; the interactive stdin interview session ended before this question was answered live.

## Change log

- `2026-07-13T22:24:16.035019+00:00` — opened
- `2026-07-13T22:44:26.356467+00:00` — resolved (final_answer="Split data/ into a new companion repo (vital-core-data). vital-core untracks data/ (adds to .gitignore) and stops committing new blobs; a separate clone/checkout step (not a submodule) populates data/ in CI and for local dev. Existing vital-core history is not rewritten. Full technical approach recorded in plan.md (Technical Context, Charter Check, Implementation Concern Map IC-01..IC-05).")
