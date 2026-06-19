# Spec: VITAL default view — tighter priority filter

**Status**: SHIPPED (2026-W25, PR #146)

## Goal

Reduce the default wall of accessibility errors shown on the accessibility
page. Show only "VITAL errors" by default; a "Show everything" toggle reveals
the rest. The filter must be deterministic and documented so engineers and
site owners understand exactly what they're seeing.

## Definition of "VITAL error"

| Condition | Priority tier | Shown by default |
|---|---|---|
| Critical or Serious + WCAG A/AA | 0 | Yes |
| Critical or Serious + Best Practice / Undetermined | 1 | Yes |
| Moderate or Minor + WCAG A/AA + ≥10 pages affected | 2 | Yes |
| Best Practice (any severity, any page count) | 5 | No |
| Moderate or Minor + WCAG A/AA + <10 pages | 5 | No |

## Acceptance criteria

- [x] `src/lib/accessibility-priority.js` — `priorityTier(bug, …)` implements the table above; returns `0 | 1 | 2 | 5`.
- [x] Visible set: `bugs.filter(b => b.priority_tier <= 2)` — no other filter logic outside this function.
- [x] `src/report-html.js` — default filter shows only tier ≤2 bugs; "Show everything" toggle removes the filter.
- [x] Filter bar label updated to reflect the new definition.
- [x] Unit test: 5-bug fixture with one Critical/WCAG, one Serious/WCAG, one Moderate/WCAG/≥10 pages, one Best Practice, one Minor/WCAG/<10 pages → 3 visible by default.
- [x] All 91 unit tests pass.

## Out of scope

- Changing what data is stored in `data/` — this is display-only filtering.
- Any change to the scoring weights used in `priority-pages.csv`.
