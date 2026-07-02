---
work_package_id: WP03
title: "Diagnostic CLI"
dependencies: ["WP01"]
requirement_refs:
- FR-06
- C-01
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T007
- T008
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
- "scripts/check-public-interest.js"
- "package.json"
tags:
- reconstructed
- shipped
---

# WP03: Diagnostic CLI

> Archive-only: this reconstructed work package documents shipped work. Do not run `spec-kitty agent action implement` from this file. Start a new mission from `main` for follow-up changes and cite this WP as historical context.

## Status

This work package was reconstructed from the shipped #150 spec. It is a durable implementation map for future agents, not a claim that this WP was freshly executed in this branch.

## Historical Implementation Files

- `scripts/check-public-interest.js`
- `package.json`

## Objective

Provide a quick local diagnostic that shares engine behavior and never acts as a CI gate.

## Subtasks

### T007: Create scripts/check-public-interest.js with text and --json output.

**Files**: scripts/check-public-interest.js, package.json
**Validation**: Run npm run check:public-interest www.cms.gov -- --json or the documented local equivalent.

### T008: Add package.json script and preserve exit 0 diagnostic semantics.

**Files**: scripts/check-public-interest.js, package.json
**Validation**: Run npm run check:public-interest www.cms.gov -- --json or the documented local equivalent.

## Acceptance Boundary

Requirement refs: FR-06, C-01.

## Validation

Run npm run check:public-interest www.cms.gov -- --json or the documented local equivalent.
