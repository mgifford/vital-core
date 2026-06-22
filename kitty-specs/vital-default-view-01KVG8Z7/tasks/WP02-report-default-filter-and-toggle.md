---
work_package_id: WP02
title: "Report default filter and toggle"
dependencies: ["WP01"]
requirement_refs:
- FR-03
- FR-04
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T004
- T005
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
- "src/report-html.js"
tags:
- reconstructed
- shipped
---

# WP02: Report default filter and toggle

> Archive-only: this reconstructed work package documents shipped work. Do not run `spec-kitty agent action implement` from this file. Start a new mission from `main` for follow-up changes and cite this WP as historical context.

## Status

This work package was reconstructed from the shipped #148 spec. It is a durable implementation map for future agents, not a claim that this WP was freshly executed in this branch.

## Historical Implementation Files

- `src/report-html.js`

## Objective

Apply the priority tier contract in the accessibility report and keep full findings available on demand.

## Subtasks

### T004: Filter default report bugs to priority_tier <= 2.

**Files**: src/report-html.js
**Validation**: Generate or inspect report HTML and run npm run test:unit.

### T005: Update the filter label and Show everything toggle behavior.

**Files**: src/report-html.js
**Validation**: Generate or inspect report HTML and run npm run test:unit.

## Acceptance Boundary

Requirement refs: FR-03, FR-04.

## Validation

Generate or inspect report HTML and run npm run test:unit.
