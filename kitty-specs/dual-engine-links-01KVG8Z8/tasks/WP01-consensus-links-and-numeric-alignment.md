---
work_package_id: WP01
title: "Consensus links and numeric alignment"
dependencies: []
requirement_refs:
- FR-01
- FR-02
- FR-03
- FR-04
- C-01
- NFR-01
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T001
- T002
- T003
- T004
- T005
history:
- timestamp: 2026-06-20T01:03:05Z
  agent: codex
  action: Reconstructed shipped work package for model-agnostic Spec Kitty use
agent: ""
shell_pid: 0
authoritative_surface: "kitty-specs/dual-engine-links-01KVG8Z8/"
execution_mode: planning_artifact
scope: codebase-wide
owned_files:
- "src/report-html.js"
tags:
- reconstructed
- shipped
---

# WP01: Consensus links and numeric alignment

> Archive-only: this reconstructed work package documents shipped work. Do not run `spec-kitty agent action implement` from this file. Start a new mission from `main` for follow-up changes and cite this WP as historical context.

## Status

This work package was reconstructed from the shipped #147 spec. It is a durable
implementation map for future agents, not a claim that this WP was freshly
executed in this branch.

## Historical Implementation Files

- `src/report-html.js`

## Objective

Update `src/report-html.js` so the dual-engine consensus table links issues to
detailed bug anchors and numeric headers align with numeric cells throughout
report tables.

## Subtasks

### T001: Pass bugs into consensusSection() and build a rule-id to bug-instance map.

**Files**: src/report-html.js
**Validation**: Run npm run test:unit and inspect generated accessibility table markup.

### T002: Render issue cells as accessibility.html#VS-id links when a matching bug exists; otherwise retain plain text.

**Files**: src/report-html.js
**Validation**: Run npm run test:unit and inspect generated accessibility table markup.

### T003: Add td.num/th.num right-alignment and tabular numeral CSS.

**Files**: src/report-html.js
**Validation**: Run npm run test:unit and inspect generated report tables.

### T004: Ensure sortable numeric header buttons fill width and right-align label text.

**Files**: src/report-html.js
**Validation**: Run npm run test:unit and inspect generated report tables.

### T005: Add class="num" to numeric column headers across generated report tables.

**Files**: src/report-html.js
**Validation**: Run npm run test:unit and inspect generated report tables.

## Acceptance Boundary

Requirement refs: FR-01, FR-02, FR-03, FR-04, C-01, NFR-01.

## Validation

Run npm run test:unit and inspect generated accessibility/report table markup.
