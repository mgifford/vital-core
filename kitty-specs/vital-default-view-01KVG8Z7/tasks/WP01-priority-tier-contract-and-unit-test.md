---
work_package_id: WP01
title: "Priority tier contract and unit test"
dependencies: []
requirement_refs:
- FR-01
- FR-02
- C-01
- NFR-01
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T001
- T002
- T003
history:
- timestamp: 2026-06-20T01:03:05Z
  agent: codex
  action: Reconstructed shipped work package for model-agnostic Spec Kitty use
agent: ""
shell_pid: 0
authoritative_surface: "kitty-specs/vital-default-view-01KVG8Z7/"
execution_mode: planning_artifact
scope: codebase-wide
owned_files:
- "src/lib/accessibility-priority.js"
- "tests/unit/**/*.test.js"
tags:
- reconstructed
- shipped
---

# WP01: Priority tier contract and unit test

> Archive-only: this reconstructed work package documents shipped work. Do not run `spec-kitty agent action implement` from this file. Start a new mission from `main` for follow-up changes and cite this WP as historical context.

## Status

This work package was reconstructed from the shipped #148 spec. It is a durable implementation map for future agents, not a claim that this WP was freshly executed in this branch.

## Historical Implementation Files

- `src/lib/accessibility-priority.js`
- `tests/unit/**/*.test.js`

## Objective

Define the VITAL default visibility contract in priorityTier() and prove it with the canonical fixture.

## Subtasks

### T001: Implement the five-row VITAL priority table in priorityTier().

**Files**: src/lib/accessibility-priority.js, tests/unit/**/*.test.js
**Validation**: Run npm run test:unit.

### T002: Keep data record shape unchanged; expose only computed/display priority.

**Files**: src/lib/accessibility-priority.js, tests/unit/**/*.test.js
**Validation**: Run npm run test:unit.

### T003: Add or update the five-bug unit fixture proving three default-visible findings.

**Files**: src/lib/accessibility-priority.js, tests/unit/**/*.test.js
**Validation**: Run npm run test:unit.

## Acceptance Boundary

Requirement refs: FR-01, FR-02, C-01, NFR-01.

## Validation

Run npm run test:unit.
