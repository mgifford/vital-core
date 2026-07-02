# Work Packages: report-i18n-01rpt8

_Generated from wps.yaml. Do not edit directly._

---

## Work Package WP01: i18n foundation

**Dependencies**: None
**Requirement Refs**: FR-01, FR-02, FR-12, FR-13, FR-15, NFR-01
**Owned Files**: src/lib/i18n.js, src/lib/config.js, config/targets.yml, scripts/i18n-extract.js, tests/unit/i18n.test.js, tests/unit/config.test.js
**Subtasks**: T001, T002, T003
**Prompt**: `tasks/WP01-i18n-foundation.md`

---

## Work Package WP02: Wrap high-traffic report chrome

**Dependencies**: WP01
**Requirement Refs**: FR-03, FR-04, FR-07, C-01, C-02
**Owned Files**: src/report-html.js
**Subtasks**: T004, T005, T006
**Prompt**: `tasks/WP02-wrap-chrome.md`

---

## Work Package WP03: Multi-language output + language switcher

**Dependencies**: WP02
**Requirement Refs**: FR-06, FR-08, C-05
**Owned Files**: src/report-html.js, src/aggregate.js, tests/unit/i18n-render.test.js
**Subtasks**: T007, T008
**Prompt**: `tasks/WP03-multi-language-output.md`

---

## Work Package WP04: Catalogs fr/ja/nl

**Dependencies**: WP01, WP02
**Requirement Refs**: FR-14, FR-16
**Owned Files**: src/locales/fr.json, src/locales/ja.json, src/locales/nl.json, src/locales/dynamic-strings.json, src/locales/template.json, config/targets.yml
**Subtasks**: T009, T010
**Prompt**: `tasks/WP04-catalogs.md`

---

## Work Package WP05: Docs + tooling scripts

**Dependencies**: WP01
**Requirement Refs**: FR-15
**Owned Files**: CLAUDE.md, README.md, package.json
**Subtasks**: T011
**Prompt**: `tasks/WP05-docs.md`

---

## Work Package WP06: Runtime language selection (?lang / localStorage)

**Dependencies**: WP03
**Requirement Refs**: FR-09, FR-10, FR-11
**Owned Files**: src/report-html.js, tests/unit/i18n-render.test.js, CLAUDE.md
**Subtasks**: T012, T013
**Prompt**: `tasks/WP06-runtime-selection.md`

---

## Work Package WP07: Secondary pages + url-lookup coverage

**Dependencies**: WP03, WP04
**Requirement Refs**: FR-03, FR-04, FR-05, FR-14
**Owned Files**: src/report-html.js, src/locales/dynamic-strings.json, src/locales/fr.json, src/locales/ja.json, src/locales/nl.json, src/locales/template.json, tests/unit/i18n-render.test.js
**Subtasks**: T014, T015, T016
**Prompt**: `tasks/WP07-secondary-pages.md`

---
