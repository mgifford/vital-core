# Implementation Plan: Scanner aggregator wishlist

**Status**: DRAFT
**Date**: 2026-06-26
**Spec**: [spec.md](spec.md)

---

## Summary

Six ordered work packages ship four reviewer-requested capabilities:
configurable score display, source heuristic badges, training priority
summaries, tech-aware remediation, and browser-side triage with
export/import. All changes are display-side or client-side; the committed
`data/` schema is untouched.

---

## Technical Context

**Language/Version**: Node.js ESM ≥ 20  
**Primary files**: `src/report-html.js`, `src/lib/bug-report.js`, `src/aggregate.js`  
**New files**: `src/lib/training-priorities.js`, `src/lib/remediation-prompts.js`  
**Config**: `config/targets.yml` defaults + per-target overrides  
**Testing**: Node built-in test runner via `npm run test:unit`  
**Constraints**: No new npm dependencies; no data/ schema change; JS is progressive enhancement

---

## Charter Check

- Plain Node.js ESM; no build step introduced.
- Historical weekly data compatibility preserved (no data/ schema change).
- Report content remains usable as generated static HTML without JS.
- Focused unit coverage for all new behaviour.
- Ollama remains fully optional with graceful fallback.

---

## Work Packages

### WP01 — Configurable score display

Add `display.score_format` (letter | percent | both | none) to `targets.yml`
defaults and per-target overrides. Propagate into report rendering so the
score section can be suppressed or reformatted per site without touching the
score algorithm.

**Req refs**: FR-01, FR-02, C-04, NFR-01  
**Deps**: none  
**Owned files**: `config/targets.yml`, `src/aggregate.js` (pass config into render), `src/report-html.js` (score section), `tests/unit/score-display.test.js` (new)

---

### WP02 — Template vs content source heuristic

Compute `likely_source` in `src/lib/bug-report.js` based on `pages_affected`
vs configurable threshold. Add a source badge to the collapsed finding header
in the accessibility report. Add threshold to `targets.yml`.

**Req refs**: FR-03, FR-04, FR-05, C-01, NFR-01  
**Deps**: none  
**Owned files**: `config/targets.yml`, `src/lib/bug-report.js`, `src/report-html.js` (bug detail block), `tests/unit/source-heuristic.test.js` (new)

---

### WP03 — Training priorities section

New module `src/lib/training-priorities.js` groups findings by WCAG SC,
selects top 5 by pages-affected, detects component inconsistencies (≥ 3 rules,
same SC, ≥ 5 pages each), and optionally queries Ollama for plain-English
advice. `aggregate.js` calls the module; `report-html.js` renders the new
section above the bug list.

**Req refs**: FR-06, FR-07, FR-08, C-01, NFR-01  
**Deps**: none  
**Owned files**: `src/lib/training-priorities.js` (new), `src/aggregate.js`, `src/report-html.js` (new Training Priorities section), `tests/unit/training-priorities.test.js` (new)

---

### WP04 — Tech-aware remediation prompts

New module `src/lib/remediation-prompts.js` maps rule_id → { drupal, wordpress,
generic } tip templates for the 5+ most common axe rules. `bug-report.js`
selects the right template at construction time using the site's detected tech
stack. Falls back to existing generic tip.

**Req refs**: FR-09, FR-10, FR-11, C-01, C-05  
**Deps**: WP02 (both modify `src/lib/bug-report.js`)  
**Owned files**: `src/lib/remediation-prompts.js` (new), `src/lib/bug-report.js`, `src/report-html.js` (remediation tip section)

---

### WP05 — Browser-side triage (status + notes + badges)

Add a triage panel (status dropdown + notes textarea) to each finding via
progressive-enhancement JS. Persist to `localStorage` keyed by
`{domain}:{week}:{pattern_id}`. Restore state and render a status badge on
the collapsed finding header on load.

**Req refs**: FR-12, FR-13, FR-14, C-02, C-03  
**Deps**: WP02, WP04 (bug detail block must be stable before adding triage UI layer)  
**Owned files**: `src/report-html.js` (client JS block + triage panel markup)

---

### WP06 — Triage export/import

Add "Export triage" (downloads `{domain}_{DDMONYYYY}_triage.json`) and
"Import triage" (file picker → localStorage merge + live badge refresh) buttons
to the accessibility report toolbar.

**Req refs**: FR-15, FR-16, C-02  
**Deps**: WP05  
**Owned files**: `src/report-html.js` (toolbar buttons + import/export JS)

---

## Validation Plan

- `npm run test:unit` — must pass after every WP.
- `npm run test:e2e` — after WP03 and WP05 (aggregate and report pipeline change).
- Manual check: generate a report with `npm run aggregate` and open in browser
  after WP05 and WP06 to verify triage persistence and export.

## Rollback Plan

Each WP is a single focused commit. Revert the commit to roll back that WP
independently. WP06 → WP05 ordering means WP06 reverts cleanly without
touching WP05 work.
