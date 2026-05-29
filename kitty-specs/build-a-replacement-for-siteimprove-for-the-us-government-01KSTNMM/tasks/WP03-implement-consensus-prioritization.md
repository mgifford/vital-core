---
work_package_id: WP03
title: Implement consensus prioritization
dependencies:
- WP02
requirement_refs:
- FR-5
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts were generated on main; completed changes must merge back into main.
subtasks:
- T001
- T002
phase: Phase 2 - Prioritization and Reporting
assignee: ''
agent: ''
history:
- timestamp: '2026-05-29T00:00:00Z'
  agent: copilot
  action: Initial WP scaffold generated
owned_files: []
tags: []
---

# Work Package Prompt: WP03 - Implement consensus prioritization

## Goals

- Classify findings as consensus, alfa-only, or axe-only.
- Apply priority tiers and tie-break logic.
- Expose priority fields in machine-readable outputs.

## Deliverables

- Correlation logic and classification model.
- Priority sorting implementation.
- Unit tests for deterministic prioritization.
