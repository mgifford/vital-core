---
work_package_id: WP04
title: "Catalogs fr/ja/nl"
dependencies:
- WP01
- WP02
requirement_refs:
- FR-14
- FR-16
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main. Merge back to main when WP is complete.
subtasks:
- T009
- T010
agent: claude
scope: codebase-wide
owned_files:
- "src/locales/fr.json"
- "src/locales/ja.json"
- "src/locales/nl.json"
- "src/locales/dynamic-strings.json"
- "src/locales/template.json"
- "config/targets.yml"
---

# WP04: Catalogs fr/ja/nl

## Objective

Seed human-reviewed translation catalogs and register the indirectly-translated
strings so the template is a complete checklist.

## Context

- Catalogs are flat `{ "English source": "translation" }`; missing/empty keys
  fall back to English, so partial catalogs are safe.
- Strings reached via `t(variable)` / label tables never appear in a literal
  `t('…')` call, so the extractor can't see them.

## Subtasks

### T009: dynamic-strings registry

Create `src/locales/dynamic-strings.json` listing strings translated indirectly
(subnav labels, WCAG categories, `RESOURCE_LABELS`/`LH_CATEGORY_LABELS`,
trajectory words, empty-state messages). `i18n-extract.js` merges it into
`template.json`. Regenerate `template.json` with `npm run i18n:extract`.

### T010: fr/ja/nl catalogs + config examples

Fill `src/locales/{fr,ja,nl}.json` with the common UI chrome (French most
complete). Document per-target `languages` examples (Canada/Japan/NL) in
`config/targets.yml`. The catalog-key lint must pass.

## Validation

`npm run test:unit` (catalog-key lint) and `npm run i18n:check` green; spot-check a
rendered fr page.
