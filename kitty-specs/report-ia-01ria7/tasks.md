# Work Packages: report-ia-01ria7

_Generated from wps.yaml. Do not edit directly._

---

## Work Package WP01: Reusable stat component (statTile)

**Dependencies**: None
**Requirement Refs**: FR-01, NFR-01
**Owned Files**: src/report-html.js, tests/unit/report-html.test.js
**Subtasks**: T001
**Prompt**: `tasks/WP01-stat-component.md`

---

## Work Package WP02: Layer-1 domain landing page

**Dependencies**: WP01
**Requirement Refs**: FR-02, FR-03, FR-04, FR-05, C-02, C-03, C-06
**Owned Files**: src/report-html.js, src/lib/progress.js, src/aggregate.js, tests/unit/report-html.test.js, tests/unit/progress.test.js
**Subtasks**: T002, T003, T004
**Prompt**: `tasks/WP02-landing-page.md`

---

## Work Package WP03: Progress panel

**Dependencies**: WP02
**Requirement Refs**: FR-06, FR-07, FR-08, FR-09, C-03, C-04, NFR-02
**Owned Files**: src/report-html.js, src/lib/progress.js, tests/unit/progress.test.js
**Subtasks**: T005, T006, T007
**Prompt**: `tasks/WP03-progress-panel.md`

---

## Work Package WP04: Outcome nav regroup + redirect stubs

**Dependencies**: WP02
**Requirement Refs**: FR-10, FR-11, FR-12, C-01, C-05, NFR-01
**Owned Files**: src/report-html.js, src/aggregate.js, tests/e2e.mjs, tests/unit/i18n-render.test.js, tests/unit/report-html.test.js
**Subtasks**: T008, T009, T010
**Prompt**: `tasks/WP04-outcome-nav.md`

---

## Work Package WP05: Docs

**Dependencies**: WP02, WP03, WP04
**Requirement Refs**: FR-13
**Owned Files**: CLAUDE.md, README.md
**Subtasks**: T011
**Prompt**: `tasks/WP05-docs.md`

---
