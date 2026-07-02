# Work Packages: scanner-aggregator-wishlist-01rjts

_Generated from wps.yaml. Do not edit directly._

---

## Work Package WP01: Configurable score display

**Dependencies**: None
**Requirement Refs**: FR-01, FR-02, C-04, NFR-01
**Owned Files**: config/targets.yml, src/aggregate.js, src/report-html.js, tests/unit/score-display.test.js
**Subtasks**: T001, T002, T003
**Prompt**: `tasks/WP01-configurable-score-display.md`

---

## Work Package WP02: Template vs content source heuristic

**Dependencies**: None
**Requirement Refs**: FR-03, FR-04, FR-05, C-01, NFR-01
**Owned Files**: config/targets.yml, src/lib/bug-report.js, src/report-html.js, tests/unit/source-heuristic.test.js
**Subtasks**: T004, T005, T006
**Prompt**: `tasks/WP02-source-heuristic.md`

---

## Work Package WP03: Training priorities section

**Dependencies**: None
**Requirement Refs**: FR-06, FR-07, FR-08, C-01, NFR-01
**Owned Files**: src/lib/training-priorities.js, src/aggregate.js, src/report-html.js, tests/unit/training-priorities.test.js
**Subtasks**: T007, T008, T009, T010
**Prompt**: `tasks/WP03-training-priorities.md`

---

## Work Package WP04: Tech-aware remediation prompts

**Dependencies**: WP02
**Requirement Refs**: FR-09, FR-10, FR-11, C-01, C-05
**Owned Files**: src/lib/remediation-prompts.js, src/lib/bug-report.js, src/report-html.js
**Subtasks**: T011, T012, T013
**Prompt**: `tasks/WP04-tech-aware-remediation.md`

---

## Work Package WP05: Browser-side triage (status + notes + badges)

**Dependencies**: WP02, WP04
**Requirement Refs**: FR-12, FR-13, FR-14, C-02, C-03
**Owned Files**: src/report-html.js
**Subtasks**: T014, T015, T016
**Prompt**: `tasks/WP05-browser-triage.md`

---

## Work Package WP06: Triage export/import

**Dependencies**: WP05
**Requirement Refs**: FR-15, FR-16, C-02
**Owned Files**: src/report-html.js
**Subtasks**: T017, T018
**Prompt**: `tasks/WP06-triage-export-import.md`

---
