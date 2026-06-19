# Spec: Severity taxonomy — axe-core labels throughout

**Status**: SHIPPED (2026-W25, PR #146)

## Goal

Replace the non-standard Critical/High/Medium/Low severity labels with
axe-core's own four-level vocabulary verbatim: Critical, Serious, Moderate,
Minor. Every file that maps, ranks, or displays severity must use the same
four strings so the codebase is internally consistent and matches what
axe-core itself reports.

## Acceptance criteria

- [x] `src/lib/wcag.js` — `severityFor()` returns `'Critical' | 'Serious' | 'Moderate' | 'Minor'`; input mapping from axe impact strings updated.
- [x] `src/lib/accessibility-priority.js` — `SEVERITY_RANK` keyed on new labels; `priorityTier()` branches on `'Serious'` not `'High'`.
- [x] `src/lib/bug-report.js` — `sevRank` map updated.
- [x] `src/lib/priority.js` — `SEVERITY_WEIGHT` map updated.
- [x] `src/lib/ai-findings.js` — `SEVERITY_RANK`, `PRIORITY_THRESHOLDS`, and `priorityFor()` updated.
- [x] `src/lib/csv.js` — CSV headers and scoring constants use `a11y_serious_bugs`, `a11y_moderate_bugs`, `a11y_minor_bugs`.
- [x] `src/report-html.js` — CSS classes (`sev-serious`, `sev-moderate`, `sev-minor`), badge colours, and severity order arrays updated.
- [x] All unit tests updated to use new label casing; 91 tests pass.
- [x] No occurrence of `'High'`, `'Medium'`, or `'Low'` as a severity value anywhere in `src/`.

## Out of scope

- Changing the four raw axe impact strings (`critical`, `serious`, `moderate`, `minor`) that arrive from axe-core — those are raw input, not display labels.
- Any change to the scoring weights (Critical=40, Serious=20, Moderate=8, Minor=2).
