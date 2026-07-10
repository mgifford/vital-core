# Work Packages: report-exclusion-exports-01rex2

_Generated from wps.yaml. Do not edit directly._

---

## Work Package WP01: Factor bugsCsvTable(bugs) — single source of truth for the CSV schema

**Dependencies**: None
**Requirement Refs**: FR-01, C-05, NFR-01
**Owned Files**: src/lib/csv.js, tests/unit/csv.test.js
**Subtasks**: T001
**Prompt**: `tasks/WP01-bugs-csv-table.md`

---

## Work Package WP02: Browser fetch → filter → download (filtered CSV/JSON)

**Dependencies**: WP01
**Requirement Refs**: FR-02, FR-03, FR-04, C-01, C-02, C-03, C-04, NFR-02
**Owned Files**: src/report-html.js, tests/unit/report-html.test.js
**Subtasks**: T002, T003
**Prompt**: `tasks/WP02-fetch-filter-download.md`

---

## Work Package WP03: Docs

**Dependencies**: WP02
**Requirement Refs**: FR-05
**Owned Files**: CLAUDE.md, FEATURES.md
**Subtasks**: T004
**Prompt**: `tasks/WP03-docs.md`

---
