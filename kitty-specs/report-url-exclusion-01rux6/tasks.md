# Work Packages: report-url-exclusion-01rux6

_Generated from wps.yaml. Do not edit directly._

---

## Work Package WP01: Regex-aware exclusion filter (shared semantics)

**Dependencies**: None
**Requirement Refs**: FR-07, NFR-01
**Owned Files**: src/report-html.js, tests/unit/url-exclusion.test.js
**Subtasks**: T001
**Prompt**: `tasks/WP01-regex-filter.md`

---

## Work Package WP02: Viewer exclusion control on the accessibility page

**Dependencies**: WP01
**Requirement Refs**: FR-01, FR-02, FR-03, FR-04, FR-05, C-01, C-02, C-03, C-04, C-07, C-08
**Owned Files**: src/report-html.js, tests/unit/report-html.test.js
**Subtasks**: T002, T003, T004
**Prompt**: `tasks/WP02-viewer-control.md`

---

## Work Package WP03: Landing-page placement + cross-page shared state

**Dependencies**: WP02
**Requirement Refs**: FR-01, FR-03, FR-04, FR-05, C-01, C-02, C-04
**Owned Files**: src/report-html.js, tests/unit/report-html.test.js
**Subtasks**: T005, T006
**Prompt**: `tasks/WP03-landing-placement.md`

---

## Work Package WP04: Export / import / share of the exclusion set

**Dependencies**: WP02
**Requirement Refs**: FR-06, C-04, C-08, NFR-02
**Owned Files**: src/report-html.js, tests/unit/report-html.test.js
**Subtasks**: T007, T008
**Prompt**: `tasks/WP04-share-io.md`

---

## Work Package WP05: Docs

**Dependencies**: WP02, WP03, WP04
**Requirement Refs**: FR-08
**Owned Files**: CLAUDE.md, README.md, FEATURES.md, config/targets.yml
**Subtasks**: T009
**Prompt**: `tasks/WP05-docs.md`

---
