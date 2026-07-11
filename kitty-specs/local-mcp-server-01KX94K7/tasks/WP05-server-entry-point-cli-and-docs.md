---
work_package_id: WP05
title: Server entry point, CLI, and docs
dependencies:
- WP01
- WP02
- WP03
- WP04
requirement_refs:
- FR-01
- FR-09
tracker_refs: []
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T001
- T002
- T003
- T004
- T005
agent: claude
shell_pid: 0
scope: mcp, docs
history:
- timestamp: '2026-07-11T00:00:00Z'
  agent: claude
  action: Backfilled after implementation — spec-kitty CLI was unavailable in the implementing environment, so the tasks phase was skipped and WP05 was implemented directly from plan.md. This file documents work already committed, not a plan for future execution.
authoritative_surface: kitty-specs/local-mcp-server-01KX94K7/
create_intent: []
execution_mode: planning_artifact
owned_files:
- mcp/server.js
- package.json
- package-lock.json
- MCP.md
- README.md
- tests/unit/mcp/server.test.js
tags:
- reconstructed
---

# WP05: Server entry point, CLI, and docs

> Backfilled: this WP documents work already implemented and committed on
> `claude/vital-core-issue-214-spec-m237h3`. Do not run
> `spec-kitty agent action implement` from this file.

## Objective

Wire the config, API client, and three tools into a real
`@modelcontextprotocol/sdk` stdio server; add a `vital-mcp` bin entry; and
document installation, `.vital.yml`, the tools, security boundaries, and
what's explicitly *not yet* implemented.

## Subtasks

### T001: `mcp/server.js` — `buildContext`, `listToolsResult`, `callTool`, `createServer`, `main`.

**Files**: `mcp/server.js`
**Validation**: Transport-independent functions (`listToolsResult`,
`callTool`) unit tested directly; `createServer` smoke-tested against the
real stdio transport via a spawned child process (`initialize` →
`tools/list` → `tools/call`).

### T002: `package.json` — `@modelcontextprotocol/sdk` dependency + `vital-mcp` bin entry.

**Files**: `package.json`, `package-lock.json`
**Validation**: `npm ci` installs cleanly; `node mcp/server.js` starts and
serves over stdio.

### T003: `MCP.md` — architecture, `.vital.yml`, tools, security boundaries, "not yet implemented" list.

**Files**: `MCP.md`

### T004: README section linking to `MCP.md`.

**Files**: `README.md`

### T005: Unit tests, including a real spawned-process stdio smoke test.

**Files**: `tests/unit/mcp/server.test.js`
**Validation**: `npm run test:unit` — 9 tests in this file; separately, a
spawned `mcp/server.js` process was driven through `initialize`/`tools/list`/
`tools/call` over real stdio and confirmed working end-to-end.

## Acceptance Boundary

Requirement refs: FR-01, FR-09.

## Validation

`npm run test:unit` — 366/366 passing across the full suite.
`npm run check:spec-kitty` green. `npm run test:e2e` has a pre-existing,
unrelated failure reproduced on a clean checkout of this branch before any
`mcp/` changes — not caused by this mission.
