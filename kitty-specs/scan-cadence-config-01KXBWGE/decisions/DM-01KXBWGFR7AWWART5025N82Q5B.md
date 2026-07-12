# Decision Moment `01KXBWGFR7AWWART5025N82Q5B`

- **Mission:** `scan-cadence-config`
- **Origin flow:** `specify`
- **Step id:** `specify.problem_statement`
- **Input key:** `problem_statement`
- **Status:** `resolved`
- **Created:** `2026-07-12T19:22:48.967193+00:00`
- **Resolved:** `2026-07-12T19:28:05.803324+00:00`
- **Opened by:** `mike.gifford@gmail.com`
- **Other answer:** `false`

## Question

What problem does this feature solve?

## Options

_(none)_

## Final answer

The scanner currently enforces one hard-coded scheduling rule everywhere (once-per-ISO-week URL eligibility) with no domain-level cadence control. This mission makes both dimensions configurable per target via new config/targets.yml fields, with defaults that reproduce today's exact behavior. Full detail in spec.md's Purpose and Problem Statement sections.

## Rationale

_(none)_

## Change log

- `2026-07-12T19:22:48.967193+00:00` — opened
- `2026-07-12T19:28:05.803324+00:00` — resolved (final_answer="The scanner currently enforces one hard-coded scheduling rule everywhere (once-per-ISO-week URL eligibility) with no domain-level cadence control. This mission makes both dimensions configurable per target via new config/targets.yml fields, with defaults that reproduce today's exact behavior. Full detail in spec.md's Purpose and Problem Statement sections.")
