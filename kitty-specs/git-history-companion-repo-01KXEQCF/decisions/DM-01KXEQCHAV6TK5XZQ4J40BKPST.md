# Decision Moment `01KXEQCHAV6TK5XZQ4J40BKPST`

- **Mission:** `git-history-companion-repo`
- **Origin flow:** `specify`
- **Step id:** `specify.problem_statement`
- **Input key:** `problem_statement`
- **Status:** `resolved`
- **Created:** `2026-07-13T21:50:59.931703+00:00`
- **Opened by:** `mike.gifford@gmail.com`
- **Other answer:** `false`

## Question

What problem does this feature solve?

## Options

_(none)_

## Final answer

`data/` (68,703 tracked files) is committed directly into `vital-core`, and
git history keeps every blob forever even after `src/prune.js` removes files
from the working tree. Per `docs-internal/ROADMAP-2026-07.md` Mission B3
(decided 2026-07-03), the 1 GB server-side repo size trigger has now fired
(GitHub Actions run 29287101399), so this mission executes option (b):
move `data/` to a companion repo whose history can be periodically
truncated. Full problem statement recorded directly in `spec.md`.

## Rationale

The interactive `spec-kitty specify` interview session ended before this
question was answered via stdin; the answer was authored directly into
`spec.md` instead. Recording it here to close out the decision moment
rather than leaving it open with no answer.

## Change log

- `2026-07-13T21:50:59.931703+00:00` — opened
- `2026-07-13T22:00:00+00:00` — resolved: answer authored directly in spec.md
