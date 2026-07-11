---
work_package_id: WP04
title: "vital_list_findings and vital_get_finding_context tools"
dependencies:
- WP01
- WP02
requirement_refs:
- FR-05
- FR-06
- NFR-05
planning_base_branch: main
merge_target_branch: main
branch_strategy: Implemented directly on claude/vital-core-issue-214-spec-m237h3; merges back into main via the PR opened for that branch (#223) unless redirected.
subtasks:
- T001
- T002
- T003
- T004
history:
- timestamp: 2026-07-11T00:00:00Z
  agent: claude
  action: Backfilled after implementation — spec-kitty CLI was unavailable in the implementing environment, so the tasks phase was skipped and WP04 was implemented directly from plan.md. This file documents work already committed, not a plan for future execution.
agent: "claude"
shell_pid: 0
authoritative_surface: "kitty-specs/local-mcp-server-01KX94K7/"
execution_mode: planning_artifact
scope: mcp/tools
owned_files:
- "mcp/tools/shared.js"
- "mcp/tools/list-findings.js"
- "mcp/tools/get-finding-context.js"
- "tests/unit/mcp/findings-tools.test.js"
tags:
- reconstructed
---

# WP04: vital_list_findings and vital_get_finding_context tools

> Backfilled: this WP documents work already implemented and committed on
> `claude/vital-core-issue-214-spec-m237h3`. Do not run
> `spec-kitty agent action implement` from this file.

## Objective

List findings for the configured domain (filtered by severity,
`min_pages_affected`, `rule_id`; sorted by pages affected; bounded with a
`truncated` flag), and return one finding's evidence record verbatim by
`finding_id` — no server-side enrichment or inference, and no throw on an
unknown id.

## Subtasks

### T001: `resolveLatestWeek` shared helper.

**Files**: `mcp/tools/shared.js`
**Validation**: Reads `latest_week` from `apiClient.getSnapshot`; throws a
specific error if absent.

### T002: `listFindingsTool` — filter, sort, bound.

**Files**: `mcp/tools/list-findings.js`
**Validation**: Filters by severity/min_pages_affected/rule_id; sorts by
`pages_affected` descending; `limit` clamps rather than rejects; response
reports `total_matched`/`returned`/`truncated`.

### T003: `getFindingContextTool` — verbatim lookup by id.

**Files**: `mcp/tools/get-finding-context.js`
**Validation**: Known id returns the full record unchanged; unknown id
returns `{ found: false, message }` without throwing.

### T004: Unit tests, including a hostile-finding-text fixture.

**Files**: `tests/unit/mcp/findings-tools.test.js`
**Validation**: A finding whose `rule_label` reads like an instruction
("ignore all previous instructions...") comes back verbatim with no change
to control flow. `npm run test:unit` — 13 tests in this file.

## Acceptance Boundary

Requirement refs: FR-05, FR-06, NFR-05.

## Validation

`npm run test:unit` (full suite green); `npm run check:spec-kitty` green.
