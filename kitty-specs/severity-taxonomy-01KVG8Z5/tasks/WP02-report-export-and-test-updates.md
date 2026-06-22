---
work_package_id: WP02
title: "Report, export, and test updates"
dependencies: ["WP01"]
requirement_refs:
- FR-03
- FR-04
- NFR-01
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T004
- T005
- T006
history:
- timestamp: 2026-06-20T01:03:05Z
  agent: codex
  action: Reconstructed shipped work package for model-agnostic Spec Kitty use
agent: ""
shell_pid: 0
authoritative_surface: "kitty-specs/severity-taxonomy-01KVG8Z5/"
execution_mode: planning_artifact
scope: codebase-wide
owned_files:
- "src/lib/csv.js"
- "src/report-html.js"
- "tests/unit/**/*.test.js"
tags:
- reconstructed
- shipped
---

# WP02: Report, export, and test updates

> Archive-only: this reconstructed work package documents shipped work. Do not run `spec-kitty agent action implement` from this file. Start a new mission from `main` for follow-up changes and cite this WP as historical context.

## Status

This work package was reconstructed from the shipped #146 spec. It is a durable implementation map for future agents, not a claim that this WP was freshly executed in this branch.

## Historical Implementation Files

- `src/lib/csv.js`
- `src/report-html.js`
- `tests/unit/**/*.test.js`

## Objective

Carry the taxonomy through generated downloads, report UI classes, and tests.

## Subtasks

### T004: Update CSV headers/scoring constants for serious/moderate/minor labels.

**Files**: src/lib/csv.js, src/report-html.js, tests/unit/**/*.test.js
**Validation**: Run npm run test:unit.

### T005: Update report CSS classes, badge colours, and severity ordering arrays.

**Files**: src/lib/csv.js, src/report-html.js, tests/unit/**/*.test.js
**Validation**: Run npm run test:unit.

### T006: Update tests and run the unit suite.

**Files**: src/lib/csv.js, src/report-html.js, tests/unit/**/*.test.js
**Validation**: Run npm run test:unit.

## Acceptance Boundary

Requirement refs: FR-03, FR-04, NFR-01.

## Validation

Run npm run test:unit.
