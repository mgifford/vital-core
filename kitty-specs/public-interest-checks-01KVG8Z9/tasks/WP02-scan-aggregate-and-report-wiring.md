---
work_package_id: WP02
title: "Scan, aggregate, and report wiring"
dependencies: ["WP01"]
requirement_refs:
- FR-03
- FR-04
- FR-05
- C-01
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
authoritative_surface: "kitty-specs/public-interest-checks-01KVG8Z9/"
execution_mode: planning_artifact
scope: codebase-wide
owned_files:
- "src/scan.js"
- "src/aggregate.js"
- "src/report-html.js"
- "config/targets.yml"
tags:
- reconstructed
- shipped
---

# WP02: Scan, aggregate, and report wiring

> Archive-only: this reconstructed work package documents shipped work. Do not run `spec-kitty agent action implement` from this file. Start a new mission from `main` for follow-up changes and cite this WP as historical context.

## Status

This work package was reconstructed from the shipped #150 spec. It is a durable implementation map for future agents, not a claim that this WP was freshly executed in this branch.

## Historical Implementation Files

- `src/scan.js`
- `src/aggregate.js`
- `src/report-html.js`
- `config/targets.yml`

## Objective

Surface the latest public-interest check in weekly summaries and Standards reports without changing scoring/gating.

## Subtasks

### T004: Wire public-interest sampling into scan.js once per origin per week.

**Files**: src/scan.js, src/aggregate.js, src/report-html.js, config/targets.yml
**Validation**: Run npm run test:unit; run npm run test:e2e for pipeline confidence if changing scan/aggregate behavior.

### T005: Roll up the latest public-interest result into summary.publicInterest.

**Files**: src/scan.js, src/aggregate.js, src/report-html.js, config/targets.yml
**Validation**: Run npm run test:unit; run npm run test:e2e for pipeline confidence if changing scan/aggregate behavior.

### T006: Render the Standards-page badge table when summary data exists.

**Files**: src/scan.js, src/aggregate.js, src/report-html.js, config/targets.yml
**Validation**: Run npm run test:unit; run npm run test:e2e for pipeline confidence if changing scan/aggregate behavior.

## Acceptance Boundary

Requirement refs: FR-03, FR-04, FR-05, C-01.

## Validation

Run npm run test:unit; run npm run test:e2e for pipeline confidence if changing scan/aggregate behavior.
