---
work_package_id: WP02
title: Host-restricted, bounded Vital API client
dependencies: []
requirement_refs:
- FR-07
- FR-08
- NFR-01
- NFR-03
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
scope: mcp/api, mcp/security
history:
- timestamp: '2026-07-11T00:00:00Z'
  agent: claude
  action: Backfilled after implementation — spec-kitty CLI was unavailable in the implementing environment, so the tasks phase was skipped and WP02 was implemented directly from plan.md. This file documents work already committed, not a plan for future execution.
authoritative_surface: kitty-specs/local-mcp-server-01KX94K7/
create_intent: []
execution_mode: planning_artifact
owned_files:
- mcp/security/host-allowlist.js
- mcp/api/vital-api-client.js
- tests/unit/mcp/host-allowlist.test.js
- tests/unit/mcp/vital-api-client.test.js
tags:
- reconstructed
---

# WP02: Host-restricted, bounded Vital API client

> Backfilled: this WP documents work already implemented and committed on
> `claude/vital-core-issue-214-spec-m237h3`. Do not run
> `spec-kitty agent action implement` from this file.

## Objective

A fetch layer that only ever talks to the single host configured in
`instance.api`, times out slow requests, rejects oversized responses while
streaming (not after buffering), and only ever requests the three documented
`/api/v1/` endpoints.

## Subtasks

### T001: `assertAllowedUrl` — single-origin allowlist.

**Files**: `mcp/security/host-allowlist.js`
**Validation**: Allows the configured origin; blocks a different host,
scheme, or port; rejects an unparseable URL.

### T002: `VitalApiClient` — `AbortController` timeout wrapper.

**Files**: `mcp/api/vital-api-client.js`
**Validation**: A slow fixture-server response times out with
`VitalApiTimeoutError`.

### T003: Streamed response-size cap — reject, don't parse a truncated prefix.

**Files**: `mcp/api/vital-api-client.js`
**Validation**: An oversized fixture response throws
`VitalApiResponseTooLargeError` before full buffering.

### T004: In-memory cache + `getIndex`/`getSnapshot`/`getFindings` convenience methods.

**Files**: `mcp/api/vital-api-client.js`
**Validation**: A repeated `getIndex()` call hits the fixture server once.

### T005: Unit tests against a local Node `http` fixture server (no mocking).

**Files**: `tests/unit/mcp/host-allowlist.test.js`, `tests/unit/mcp/vital-api-client.test.js`
**Validation**: `npm run test:unit` — 14 tests across both files, all passing.

## Acceptance Boundary

Requirement refs: FR-07, FR-08, NFR-01, NFR-03.

## Validation

`npm run test:unit` (full suite green); `npm run check:spec-kitty` green.
