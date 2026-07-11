---
work_package_id: WP03
title: "vital_get_project_context tool"
dependencies:
- WP01
- WP02
requirement_refs:
- FR-04
planning_base_branch: main
merge_target_branch: main
branch_strategy: Implemented directly on claude/vital-core-issue-214-spec-m237h3; merges back into main via the PR opened for that branch (#223) unless redirected.
subtasks:
- T001
- T002
history:
- timestamp: 2026-07-11T00:00:00Z
  agent: claude
  action: Backfilled after implementation — spec-kitty CLI was unavailable in the implementing environment, so the tasks phase was skipped and WP03 was implemented directly from plan.md. This file documents work already committed, not a plan for future execution.
agent: "claude"
shell_pid: 0
authoritative_surface: "kitty-specs/local-mcp-server-01KX94K7/"
execution_mode: planning_artifact
scope: mcp/tools
owned_files:
- "mcp/tools/get-project-context.js"
- "tests/unit/mcp/get-project-context.test.js"
tags:
- reconstructed
---

# WP03: vital_get_project_context tool

> Backfilled: this WP documents work already implemented and committed on
> `claude/vital-core-issue-214-spec-m237h3`. Do not run
> `spec-kitty agent action implement` from this file.

## Objective

A static, argument-free tool that returns exactly the resolved config
(`apiBase`, `domain`, `warnings`) — never secrets, never anything beyond
those three fields, even if an extra field ever ends up on the config
object.

## Subtasks

### T001: `getProjectContextTool` static definition + handler.

**Files**: `mcp/tools/get-project-context.js`
**Validation**: Static schema has no properties/no `additionalProperties`;
handler returns exactly `{ apiBase, domain, warnings }`.

### T002: Unit tests, including an extra-field leak test.

**Files**: `tests/unit/mcp/get-project-context.test.js`
**Validation**: A config object with a simulated `secretToken` field never
appears in the tool's output.

## Acceptance Boundary

Requirement refs: FR-04.

## Validation

`npm run test:unit` (full suite green); `npm run check:spec-kitty` green.
