---
work_package_id: WP01
title: "Core severity contract and ranking helpers"
dependencies: []
requirement_refs:
- FR-01
- FR-02
- C-01
- C-02
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
authoritative_surface: "kitty-specs/severity-taxonomy-01KVG8Z5/"
execution_mode: planning_artifact
scope: codebase-wide
owned_files:
- "src/lib/wcag.js"
- "src/lib/accessibility-priority.js"
- "src/lib/bug-report.js"
- "src/lib/priority.js"
- "src/lib/ai-findings.js"
tags:
- reconstructed
- shipped
---

# WP01: Core severity contract and ranking helpers

> Archive-only: this reconstructed work package documents shipped work. Do not run `spec-kitty agent action implement` from this file. Start a new mission from `main` for follow-up changes and cite this WP as historical context.

## Status

This work package was reconstructed from the shipped #146 spec. It is a durable implementation map for future agents, not a claim that this WP was freshly executed in this branch.

## Historical Implementation Files

- `src/lib/wcag.js`
- `src/lib/accessibility-priority.js`
- `src/lib/bug-report.js`
- `src/lib/priority.js`
- `src/lib/ai-findings.js`

## Objective

Normalize the internal display severity contract and all priority/ranking consumers to axe-core labels without changing raw axe input values or weights.

## Subtasks

### T001: Update wcag severity mapping to emit Critical/Serious/Moderate/Minor.

**Files**: src/lib/wcag.js, src/lib/accessibility-priority.js, src/lib/bug-report.js, src/lib/priority.js, src/lib/ai-findings.js
**Validation**: Run npm run test:unit and grep src/ for High/Medium/Low severity display values.

### T002: Update priority, bug-report, and ai-findings rank maps to consume Serious/Moderate/Minor labels.

**Files**: src/lib/wcag.js, src/lib/accessibility-priority.js, src/lib/bug-report.js, src/lib/priority.js, src/lib/ai-findings.js
**Validation**: Run npm run test:unit and grep src/ for High/Medium/Low severity display values.

### T003: Verify raw axe impact strings and numeric weights remain unchanged.

**Files**: src/lib/wcag.js, src/lib/accessibility-priority.js, src/lib/bug-report.js, src/lib/priority.js, src/lib/ai-findings.js
**Validation**: Run npm run test:unit and grep src/ for High/Medium/Low severity display values.

## Acceptance Boundary

Requirement refs: FR-01, FR-02, C-01, C-02.

## Validation

Run npm run test:unit and grep src/ for High/Medium/Low severity display values.
