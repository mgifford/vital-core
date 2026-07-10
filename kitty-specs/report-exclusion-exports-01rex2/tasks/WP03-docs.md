---
work_package_id: WP03
title: "Docs"
dependencies: [WP02]
requirement_refs: [FR-05]
planning_base_branch: main
merge_target_branch: main
branch_strategy: Branch from main. Merge back to main when WP is complete.
subtasks: [T004]
agent: claude
owned_files:
- "CLAUDE.md"
- "FEATURES.md"
---

# WP03: Docs

## Objective
Document that the viewer exclusion layer can now export a filtered copy.

## Subtasks
### T004: Update docs
- CLAUDE.md "URL exclusion (three layers)": note the viewer layer can download a
  filtered bugs.json/bugs.csv, following on-screen (<=25-sample) semantics.
- FEATURES.md viewer-exclusion bullet: add the filtered-export capability.

## Validation
`npm run test:unit`, `i18n:check`, `check:spec-kitty` green.
