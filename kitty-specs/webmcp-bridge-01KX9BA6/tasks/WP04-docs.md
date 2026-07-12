---
work_package_id: WP04
title: WebMCP docs
dependencies:
- WP02
requirement_refs:
- FR-08
tracker_refs: []
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T001
- T002
agent: ''
shell_pid: 0
history: []
authoritative_surface: MCP.md
create_intent: []
execution_mode: code_change
owned_files:
- MCP.md
- README.md
tags: []
---

# WP04: WebMCP docs

## Objective

Document the WebMCP bridge in the same place as the local MCP server docs
(a new `## WebMCP` section in `MCP.md`, not a separate file — keeps
MCP-related documentation in one place), covering the `webmcp` config flag,
the measured size budget from WP03, what is and isn't shared with the local
MCP server (C-04), and the explicit caveat that the underlying browser API
is a pre-standardization proposal (C-05) that may require a follow-up
mission if it changes shape.

## Subtasks

### T001: `## WebMCP` section in `MCP.md`.

**Files**: `MCP.md`
**Validation**: Covers the config flag, the three tools (naming parity
with the local server's tools), the size budget (actual measured number
from WP03, not the plan's target), and the unstable-API caveat.

### T002: Short README mention.

**Files**: `README.md`
**Validation**: A one- or two-sentence addition near the existing "Local
MCP server" section, linking to the new `MCP.md` section.

## Acceptance Boundary

Requirement refs: FR-08.

## Validation

Docs-only; `npm run check:spec-kitty` green.

## Activity Log

- 2026-07-12T18:24:20Z – user – shell_pid=0 – Done override: Already implemented and merged to main via PR #229 (commits 29dc9f9b4, 012b3d6c4, 39dbaab34, bddac339f); mission tracking was stale relative to actual repo state.
