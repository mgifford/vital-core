---
work_package_id: WP01
title: "i18n foundation"
dependencies: []
requirement_refs:
- FR-01
- FR-02
- FR-12
- FR-13
- FR-15
- NFR-01
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main. Merge back to main when WP is complete.
subtasks:
- T001
- T002
- T003
agent: claude
scope: codebase-wide
owned_files:
- "src/lib/i18n.js"
- "src/lib/config.js"
- "config/targets.yml"
- "scripts/i18n-extract.js"
- "tests/unit/i18n.test.js"
- "tests/unit/config.test.js"
---

# WP01: i18n foundation

## Objective

Add the Drupal/gettext-style `t()` primitive, the language config schema, and the
translator tooling — with no visible change to the English report.

## Context

- `src/report-html.js:29` has a `setSustainabilityMetric()` module-level-state
  precedent; mirror it with `setLocale()` so render functions don't grow new args.
- `src/lib/config.js` `loadConfig()` merges defaults into targets — add language
  resolution/validation here.
- Node ≥20 ships full ICU, so `Intl.NumberFormat` works for fr/ja/nl.

## Subtasks

### T001: `src/lib/i18n.js`

`t(source, args)` (English source is the key; missing **or empty** translation
falls back to source; `@token` substitution), `setLocale`/`getLocale`,
`loadCatalog`, `nf()` (locale-aware numbers), and `SUPPORTED_LOCALES`
(`en`, `fr`, `ja`, `nl`). Catalogs load lazily from `src/locales/<locale>.json`.

### T002: Config schema

Parse + validate global `languages` / `default_language` (and per-target
overrides) in `src/lib/config.js`: every locale must be supported, de-duplicate,
and `default_language ∈ languages`. Expose resolved `languages` /
`defaultLanguage` on every target. Document the keys in `config/targets.yml`
(global default `[en]`).

### T003: Extraction tooling + tests

`scripts/i18n-extract.js` scrapes `t('…')` call sites (+ a
`src/locales/dynamic-strings.json` registry) into a sorted
`src/locales/template.json`; add `--check` mode for CI. Unit tests:
`tests/unit/i18n.test.js` (fallback, interpolation, `nf`, catalog-key lint) and
`tests/unit/config.test.js` (language resolution/validation).

## Validation

`npm run test:unit` passes; English output is unchanged.
