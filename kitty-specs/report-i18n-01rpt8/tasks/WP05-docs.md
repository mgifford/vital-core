---
work_package_id: WP05
title: "Docs + tooling scripts"
dependencies:
- WP01
requirement_refs:
- FR-15
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main. Merge back to main when WP is complete.
subtasks:
- T011
agent: claude
scope: codebase-wide
owned_files:
- "CLAUDE.md"
- "README.md"
- "package.json"
---

# WP05: Docs + tooling scripts

## Objective

Document the i18n model and expose the translator tooling as npm scripts.

## Subtasks

### T011: Docs + scripts

- `CLAUDE.md`: an Internationalization section — the `t()` model, `@token`
  placeholders, supported locales, config, scope/limits, and a "how to add or
  update a translation" workflow.
- `README.md`: a Languages section for operators (how to enable, fallback,
  scope).
- `package.json`: `i18n:extract` (refresh the template) and `i18n:check` (CI
  drift guard) scripts.

## Validation

`npm run i18n:check` runs; docs match the implemented behaviour.
