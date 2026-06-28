---
work_package_id: WP07
title: "Secondary pages + url-lookup coverage"
dependencies:
- WP03
- WP04
requirement_refs:
- FR-03
- FR-04
- FR-05
- FR-14
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main. Merge back to main when WP is complete.
subtasks:
- T014
- T015
- T016
agent: claude
scope: codebase-wide
owned_files:
- "src/report-html.js"
- "src/locales/dynamic-strings.json"
- "src/locales/fr.json"
- "src/locales/ja.json"
- "src/locales/nl.json"
- "src/locales/template.json"
- "tests/unit/i18n-render.test.js"
---

# WP07: Secondary pages + url-lookup coverage

## Objective

Finish localization so a configured non-English build has no English leak.

## Subtasks

### T014: Secondary render functions

Wrap remaining strings in `renderReadabilityPage`, `renderTechPage`,
`renderTechFindingsPage`, `renderThirdPartyPage`, `renderImagesPage` (+
`ALT_VERDICT_INFO` via `t(label)`/`t(expl)`), `renderArchivePage`, and the
`renderLighthousePage` medians block. Localize `sortableTable` column headers once
(`t(c.label)`); register the column labels + alt-verdict pairs in
`dynamic-strings.json`.

### T015: url-lookup

Wrap the url-lookup static body, then inject translated message templates (an `L`
object) into its inline script for the status/results/export feedback and JIRA
prose. CSV column headers stay English (machine field names).

### T016: Catalog expansion + tests

Regenerate `template.json`; add the common new strings to `fr.json` and bring
`ja.json`/`nl.json` toward parity. Add a render test asserting a sortable-table
header localizes in `fr` and stays English in `en`.

## Validation

`npm run test:unit` + `npm run i18n:check` green; render smoke of
tech/images/readability/archive/url-lookup in `fr`.
