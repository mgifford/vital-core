---
work_package_id: WP01
title: Config loading and validation
dependencies: []
requirement_refs:
- FR-02
- FR-03
- NFR-01
tracker_refs: []
planning_base_branch: main
merge_target_branch: main
branch_strategy: Planning artifacts for this mission were generated on main. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into main unless the human explicitly redirects the landing branch.
subtasks:
- T001
- T002
- T003
- T004
agent: claude
shell_pid: 0
scope: mcp/config
history:
- timestamp: '2026-07-11T00:00:00Z'
  agent: claude
  action: Backfilled after implementation — spec-kitty CLI was unavailable in the implementing environment, so the tasks phase was skipped and WP01 was implemented directly from plan.md. This file documents work already committed, not a plan for future execution.
authoritative_surface: kitty-specs/local-mcp-server-01KX94K7/
create_intent: []
execution_mode: planning_artifact
owned_files:
- mcp/config/vital-config.js
- tests/fixtures/mcp/.vital.yml
- tests/unit/mcp/vital-config.test.js
tags:
- reconstructed
---

# WP01: Config loading and validation

> Backfilled: this WP documents work already implemented and committed on
> `claude/vital-core-issue-214-spec-m237h3`. Do not run
> `spec-kitty agent action implement` from this file.

## Objective

Load and validate the phase-1 subset of `.vital.yml` (`version`,
`instance.api`, `instance.domain`), with `${ENV_VAR}` substitution, and
resolve it to exactly the fields the rest of the server needs
(`apiBase`, `domain`, `host`, `warnings`) — no path for an unvalidated or
secret-bearing field to reach a later tool response.

## Subtasks

### T001: `substituteEnvVars` — `${VAR}` substitution over raw YAML text.

**Files**: `mcp/config/vital-config.js`
**Validation**: Set/unset an env var and assert substitution vs. a warning
for the unset case (no throw).

### T002: `resolveVitalConfig` — pure validation over a parsed object.

**Files**: `mcp/config/vital-config.js`
**Validation**: Reject wrong `version`, missing `instance`, non-`https`
`instance.api`, unparseable URL, empty `instance.domain`, each with a
specific error message.

### T003: `parseVitalConfig` / `loadVitalConfig` — YAML parse + file read wrappers.

**Files**: `mcp/config/vital-config.js`
**Validation**: `loadVitalConfig` reads a real fixture file
(`tests/fixtures/mcp/.vital.yml`); invalid YAML surfaces a specific error.

### T004: Unit tests, including a secret-non-echo assertion.

**Files**: `tests/unit/mcp/vital-config.test.js`
**Validation**: `npm run test:unit` — 13 tests in this file, all passing.

## Acceptance Boundary

Requirement refs: FR-02, FR-03, NFR-01.

## Validation

`npm run test:unit` (full suite green); `npm run check:spec-kitty` green.
