---
work_package_id: WP02
title: "User-facing download filename prefixing"
dependencies: ["WP01"]
requirement_refs:
- FR-02
- C-01
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T003
- T004
history:
- timestamp: 2026-06-20T01:03:05Z
  agent: codex
  action: Reconstructed shipped work package for model-agnostic Spec Kitty use
agent: ""
shell_pid: 0
authoritative_surface: "kitty-specs/download-filename-prefix-01KVG8ZB/"
execution_mode: planning_artifact
scope: codebase-wide
owned_files:
- "src/lib/csv.js"
tags:
- reconstructed
- shipped
---

# WP02: User-facing download filename prefixing

> Archive-only: this reconstructed work package documents shipped work. Do not run `spec-kitty agent action implement` from this file. Start a new mission from `main` for follow-up changes and cite this WP as historical context.

## Status

This work package was reconstructed from the shipped #151 spec. It is a durable implementation map for future agents, not a claim that this WP was freshly executed in this branch.

## Historical Implementation Files

- `src/lib/csv.js`

## Objective

Update user-facing CSV/JSON writers to use domain/date prefixes while preserving internal per-rule filenames.

## Subtasks

### T003: Introduce filePrefix(domain, week) using weekToDateStamp().

**Files**: src/lib/csv.js
**Validation**: Run npm run test:unit and inspect generated file names in a fixture aggregate run.

### T004: Update writer signatures and returned filenames for all user-facing downloads while leaving csv/ rule files unchanged.

**Files**: src/lib/csv.js
**Validation**: Run npm run test:unit and inspect generated file names in a fixture aggregate run.

## Acceptance Boundary

Requirement refs: FR-02, C-01.

## Validation

Run npm run test:unit and inspect generated file names in a fixture aggregate run.
