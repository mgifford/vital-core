# Spec: Scanner aggregator wishlist

**Status**: DRAFT

## Goal

Extend vital-core reports with four capabilities requested by site-owner
reviewers: configurable score display, browser-side issue triage
(status/notes/export), training priority summaries, and tech-aware
remediation suggestions.

The changes must not alter committed `data/` schema, must not require a
server, and must degrade gracefully without JavaScript.

---

## Requirements

### Configurable score display

| ID | Type | Requirement |
|---|---|---|
| FR-01 | Functional | `targets.yml` defaults block accepts `display.score_format` with allowed values `letter`, `percent`, `both`, `none`. Per-target overrides are also accepted. |
| FR-02 | Functional | The report renders the score section according to `score_format`. `none` suppresses the score section entirely. Omitting the key preserves current behaviour (`both`). |

### Template vs content source heuristic

| ID | Type | Requirement |
|---|---|---|
| FR-03 | Functional | `src/lib/bug-report.js` computes `likely_source` for each finding: `"template"` when `pages_affected ≥ template_page_threshold` (default 10), `"content"` when `pages_affected ≤ 2`, `"unknown"` otherwise. |
| FR-04 | Functional | `reporting.template_page_threshold` is configurable in `targets.yml` defaults; per-target overrides accepted. |
| FR-05 | Functional | The accessibility report renders a source badge ("Template" / "Content") on the collapsed finding header when `likely_source` is not `"unknown"`. |

### Training priorities section

| ID | Type | Requirement |
|---|---|---|
| FR-06 | Functional | The accessibility report includes a "Training Priorities" section listing the top 5 WCAG success criteria by total pages-affected across all findings for that week, with plain-English SC labels. |
| FR-07 | Functional | If ≥ 3 distinct `rule_id` values fire the same WCAG SC and each appears on ≥ 5 pages, the Training Priorities section flags a "possible component inconsistency" for that SC. |
| FR-08 | Functional | When Ollama is configured and reachable, a plain-English paragraph of training advice is requested from the model and inserted below the table; absent or unreachable = no change to output. |

### Tech-aware remediation prompts

| ID | Type | Requirement |
|---|---|---|
| FR-09 | Functional | `src/lib/remediation-prompts.js` exports a mapping of `rule_id` → per-tech-stack remediation tip templates for a minimum of two CMS platforms (Drupal, WordPress) and at least the five most common axe rules. |
| FR-10 | Functional | When the site's detected tech stack (from the existing tech-findings module) includes a platform with a matching template, the finding renders the specialised tip in place of the generic one. |
| FR-11 | Functional | Falls back to the existing generic remediation tip when no tech-specific template exists. |

### Browser-side issue triage

| ID | Type | Requirement |
|---|---|---|
| FR-12 | Functional | Each finding in the accessibility report has a triage panel (progressive enhancement) with a status dropdown (`unreviewed`, `valid`, `false_positive`, `duplicate`, `deferred`, `fixed`) and a notes textarea. |
| FR-13 | Functional | Triage state persists in `localStorage` keyed by `{domain}:{week}:{pattern_id}`. State survives page reload and browser restart. |
| FR-14 | Functional | The collapsed finding header shows the current triage status as a badge so the reviewer sees state without expanding the finding. |
| FR-15 | Functional | An "Export triage" button downloads a file named `{domain}_{DDMONYYYY}_triage.json` containing all per-pattern triage records for that report (status + notes + timestamp). |
| FR-16 | Functional | An "Import triage" button accepts a triage JSON file, merges it into `localStorage`, and re-applies all badges without a page reload. |

---

## Constraints

| ID | Type | Constraint |
|---|---|---|
| C-01 | Hard | No change to committed `data/` schema. All new fields are computed at report-generation time only. |
| C-02 | Hard | Triage state is browser-local only. The Git repo is never modified by triage actions. |
| C-03 | Hard | All report content (source badges, training priorities, remediation tips) is present in generated HTML and readable without JavaScript. Triage UI (dropdown, notes, badges) is progressive enhancement only. |
| C-04 | Hard | Score computation in `src/lib/score.js` is unchanged; only display is affected. |
| C-05 | Hard | No new npm runtime dependencies. |

---

## Non-functional requirements

| ID | Type | Requirement |
|---|---|---|
| NFR-01 | Testing | Unit tests cover: `likely_source` boundary conditions (values 1, 2, 3, 9, 10, 11), training-priority grouping (top-5 selection and component-inconsistency detection), `score_format` config loading for all four values. |

---

## Acceptance criteria

- [ ] `config/targets.yml` defaults block accepts `display.score_format`; per-target override works.
- [ ] `none` suppresses the score section; `letter`, `percent`, `both` render as described; unset = `both`.
- [ ] `likely_source` is computed correctly at all boundary conditions (unit test).
- [ ] Source badge appears on collapsed finding header for template and content findings.
- [ ] `reporting.template_page_threshold` is configurable in `targets.yml`.
- [ ] Training Priorities section appears on the accessibility report with top 5 SCs.
- [ ] Component-inconsistency flag fires for the correct WCAG SCs (unit test).
- [ ] Ollama training-priorities integration falls back cleanly when Ollama is absent.
- [ ] `src/lib/remediation-prompts.js` exists with Drupal and WordPress templates for ≥ 5 rules.
- [ ] Tech-aware tip renders when the tech stack matches; generic tip renders otherwise.
- [ ] Triage panel renders per finding with status dropdown + notes textarea.
- [ ] Triage state persists in `localStorage` across reload.
- [ ] Status badge visible on collapsed finding header without expanding.
- [ ] Export downloads correctly named `triage.json` with expected schema.
- [ ] Import restores state and re-applies badges without page reload.
- [ ] All unit tests pass (`npm run test:unit`).

---

## Out of scope

- CMS API integration for content authorship (who wrote a page, when last edited).
- Sharing triage state via a server, database, or Git commit.
- Changing the score algorithm or weighting.
- Per-user identity in triage records.
