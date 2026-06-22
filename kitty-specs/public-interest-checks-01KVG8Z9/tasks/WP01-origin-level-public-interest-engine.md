---
work_package_id: WP01
title: "Origin-level public-interest engine"
dependencies: []
requirement_refs:
- FR-01
- FR-02
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
authoritative_surface: "kitty-specs/public-interest-checks-01KVG8Z9/"
execution_mode: planning_artifact
scope: codebase-wide
owned_files:
- "src/engines/public-interest.js"
- "tests/unit/public-interest.test.js"
tags:
- reconstructed
- shipped
---

# WP01: Origin-level public-interest engine

> Archive-only: this reconstructed work package documents shipped work. Do not run `spec-kitty agent action implement` from this file. Start a new mission from `main` for follow-up changes and cite this WP as historical context.

## Status

This work package was reconstructed from the shipped #150 spec. It is a durable implementation map for future agents, not a claim that this WP was freshly executed in this branch.

## Historical Implementation Files

- `src/engines/public-interest.js`
- `tests/unit/public-interest.test.js`

## Objective

Implement a no-browser origin-level checker with graceful per-check failure behavior.

## Subtasks

### T001: Create runPublicInterest(origin, domain, userAgent) with the required result shape.

**Files**: src/engines/public-interest.js, tests/unit/public-interest.test.js
**Validation**: Run npm run test:unit.

### T002: Run sub-checks concurrently and catch each failure as result: unknown.

**Files**: src/engines/public-interest.js, tests/unit/public-interest.test.js
**Validation**: Run npm run test:unit.

### T003: Add unit tests for graceful failure and unreachable origins.

**Files**: src/engines/public-interest.js, tests/unit/public-interest.test.js
**Validation**: Run npm run test:unit.

## Acceptance Boundary

Requirement refs: FR-01, FR-02, NFR-01.

## Validation

Run npm run test:unit.
