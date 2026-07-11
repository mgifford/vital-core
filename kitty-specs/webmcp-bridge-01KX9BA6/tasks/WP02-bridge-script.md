---
work_package_id: WP02
title: webmcpBridgeScript() client-side bridge
dependencies:
- WP01
requirement_refs:
- FR-02
- FR-03
- FR-04
- FR-05
- FR-06
- FR-07
- NFR-02
- NFR-03
- NFR-04
- C-05
tracker_refs: []
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T001
- T002
- T003
- T004
agent: ''
shell_pid: 0
history: []
authoritative_surface: src/
create_intent: []
execution_mode: code_change
owned_files:
- src/report-html.js
tags: []
---

# WP02: webmcpBridgeScript() client-side bridge

## Objective

Add `webmcpBridgeScript(target)` to `src/report-html.js`, following the
exact inline-`<script>` convention `exclusionFilterScript()` already
establishes in the same file: plain ES5, no build step, feature-detects the
WebMCP registration API at runtime, and — only when both `target.webmcpEnabled`
is true and the API is present — registers three read-only tools sourced
from same-origin `/api/v1/` fetches.

## Subtasks

### T001: `detectWebMcp()` feature-detection, isolated behind one function.

**Files**: `src/report-html.js`
**Validation**: Before writing the real detection call, check the current
state of the WebMCP explainer at https://github.com/webmachinelearning/webmcp
— the exact API shape (`navigator.modelContext` or otherwise) is pinned at
implementation time, per spec.md C-05, not guessed in advance. Isolate it
in one small function so a future spec change is a one-function edit.

### T002: Same-origin fetch + in-memory cache for `/api/v1/` data.

**Files**: `src/report-html.js`
**Validation**: Fetches only `snapshot.json` and `<week>/findings.json` for
the current page's own domain (FR-04) — no cross-domain requests, no new
server endpoint.

### T003: The three tool handlers.

**Files**: `src/report-html.js`
**Validation**: `vital_get_project_context` (domain, latest week, report
link — no fetch needed, data already on the page); `vital_list_findings`
(severity/min_pages_affected/rule_id filters, sort by pages_affected
descending, bounded with a `limit`, mirrors `mcp/tools/list-findings.js`'s
semantics — a deliberate hand-written duplicate, not a shared import, per
C-04); `vital_get_finding_context` (verbatim lookup by `finding_id`,
`found: false` for an unknown id, mirrors `mcp/tools/get-finding-context.js`).
Tool names/descriptions/schemas are static in source (NFR-04).

### T004: Wire into both existing `exclusionFilterScript()` call sites.

**Files**: `src/report-html.js`
**Validation**: `webmcpBridgeScript(target)` returns `''` when
`!target.webmcpEnabled` (literally zero bytes emitted — FR-01/NFR-01 depend
on this); called alongside `exclusionFilterScript()` on both
`renderDomainReport` and the accessibility page render path.

## Acceptance Boundary

Requirement refs: FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, NFR-02, NFR-03, NFR-04, C-05.

## Validation

`npm run test:unit` green; a generated report page with `webmcp: true`
contains the script; one without it is byte-identical to today's output.
