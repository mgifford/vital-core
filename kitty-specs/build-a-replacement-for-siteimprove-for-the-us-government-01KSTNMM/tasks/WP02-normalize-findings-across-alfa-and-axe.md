---
work_package_id: WP02
title: Normalize findings across Alfa and Axe
dependencies:
- WP01
requirement_refs:
- FR-4
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts were generated on main; completed changes must merge back into main.
subtasks:
- T001
- T002
- T003
phase: Phase 1 - Foundation
assignee: ''
agent: ''
history:
- timestamp: '2026-05-29T00:00:00Z'
  agent: copilot
  action: Initial WP scaffold generated
owned_files: []
tags: []
---

# Work Package Prompt: WP02 - Normalize findings across Alfa and Axe

## Goals

- Define and implement canonical finding schema.
- Preserve source engine metadata and standards references.
- Add rule crosswalk contract and fixtures.

## Deliverables

- Shared normalized finding types/contracts.
- Adapter logic for both engines.
- Unit tests for schema and mapping correctness.

## Activity Log

- 2026-05-29T23:07:13Z – unknown – Started WP02 T001: canonical normalized finding schema and tests
