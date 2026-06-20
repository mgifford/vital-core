---
work_package_id: WP03
title: "Aggregate and report download links"
dependencies: ["WP02"]
requirement_refs:
- FR-03
- FR-04
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T005
- T006
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
- "src/aggregate.js"
- "src/report-html.js"
tags:
- reconstructed
- shipped
---

# WP03: Aggregate and report download links

> Archive-only: this reconstructed work package documents shipped work. Do not run `spec-kitty agent action implement` from this file. Start a new mission from `main` for follow-up changes and cite this WP as historical context.

## Status

This work package was reconstructed from the shipped #151 spec. It is a durable implementation map for future agents, not a claim that this WP was freshly executed in this branch.

## Historical Implementation Files

- `src/aggregate.js`
- `src/report-html.js`

## Objective

Thread generated filenames through summary/reporting metadata and use them in report download links.

## Subtasks

### T005: Pass domain/week through aggregate writer call sites and store returned JSON filenames.

**Files**: src/aggregate.js, src/report-html.js
**Validation**: Run npm run test:unit; run npm run test:e2e if aggregate/report behavior changes.

### T006: Update report download links to use stored names with old-name fallbacks.

**Files**: src/aggregate.js, src/report-html.js
**Validation**: Run npm run test:unit; run npm run test:e2e if aggregate/report behavior changes.

## Acceptance Boundary

Requirement refs: FR-03, FR-04.

## Validation

Run npm run test:unit; run npm run test:e2e if aggregate/report behavior changes.
