---
work_package_id: WP03
title: "Size budget, render, and adversarial tests"
dependencies:
- WP02
requirement_refs:
- NFR-01
- NFR-05
- NFR-06
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During implementation this WP branches from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T001
- T002
- T003
- T004
agent: ""
shell_pid: 0
authoritative_surface: tests/
execution_mode: code_change
owned_files:
- tests/unit/webmcp-bridge.test.js
tags: []
---

# WP03: Size budget, render, and adversarial tests

## Objective

Prove the mission's sustainability gate holds: the bridge script is small
(NFR-01's ~2 KB gzipped target), correctly opt-in (present only when
enabled), inert where unsupported, and safe against hostile finding
content — with real measurements and tests, not just a design claim in
plan.md.

## Subtasks

### T001: Gzip-size assertion against the NFR-01 budget.

**Files**: `tests/unit/webmcp-bridge.test.js`
**Validation**: Generate the script string for an enabled target, gzip it
(Node's built-in `zlib`), assert the byte length is under the plan.md
budget. If it doesn't fit, trim WP02's scope (e.g. drop client-side sorting)
rather than raise the budget quietly — record the actual measured size in
the WP's completion note either way.

### T002: Render tests — Scenario 2 and Scenario 3 from spec.md.

**Files**: `tests/unit/webmcp-bridge.test.js`
**Validation**: A target without `webmcp: true` produces zero bytes of
bridge-script output (byte-identical to pre-mission output for that
target); a target with it enabled emits the script regardless of whether
the visiting browser supports the WebMCP API (that's a runtime concern the
script itself handles via `detectWebMcp()`, not something the build can
know).

### T003: Hostile-finding-text fixture — Scenario 4 / NFR-05.

**Files**: `tests/unit/webmcp-bridge.test.js`
**Validation**: Same adversarial case as the local MCP server
(`tests/unit/mcp/findings-tools.test.js`'s hostile-text fixture): a finding
whose `rule_label` reads like an instruction passes through
`listFindings`/`getFindingContext` verbatim with no change to control flow.

### T004 (best-effort, environment-permitting): real headless-Chromium check.

**Files**: a new e2e script (exact location decided here, per plan.md)
**Validation**: Using this sandbox's pre-installed Playwright + Chromium,
inject a stub `navigator.modelContext` before loading a generated report
page, and assert the bridge script registers tools and a tool call round
-trips correctly. If the environment can't run this (as has happened for
other missions' e2e steps in this repo), say so explicitly rather than
skip silently — do not claim this was verified if it wasn't run.

## Acceptance Boundary

Requirement refs: NFR-01, NFR-05, NFR-06.

## Validation

`npm run test:unit` green; the measured gzipped size is recorded and under
budget; adversarial cases pass.
