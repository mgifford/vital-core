---
work_package_id: WP01
title: webmcp config flag
dependencies: []
requirement_refs:
- FR-01
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
authoritative_surface: src/lib/
create_intent: []
execution_mode: code_change
owned_files:
- config/targets.yml
- src/lib/config.js
- tests/unit/config.test.js
tags: []
---

# WP01: webmcp config flag

## Objective

Add an opt-in, per-target `webmcp` boolean to `config/targets.yml`
(default `false`), resolved in `src/lib/config.js` as `t.webmcpEnabled`,
mirroring the existing `t.showLanguageSwitcher` resolution pattern but
opt-in rather than opt-out.

## Subtasks

### T001: Resolve `t.webmcpEnabled` in `loadConfig()`.

**Files**: `src/lib/config.js`
**Validation**: `t.webmcpEnabled = t.webmcp === true;` — absent or falsy
`webmcp` on a target resolves to `false`; only literal `true` resolves to
`true`. No global default (single flag, single behavior, per spec.md C-02
scope discipline).

### T002: Unit tests + a documented example target.

**Files**: `tests/unit/config.test.js`, `config/targets.yml` (a commented
example, not necessarily enabling it for a real production target)
**Validation**: Tests cover: flag absent → `false`; `webmcp: true` →
`true`; `webmcp: false` explicit → `false`; a non-boolean value (e.g.
`webmcp: "yes"`) → `false` (only literal `true` opts in).

## Acceptance Boundary

Requirement refs: FR-01 (spec.md).

## Validation

`npm run test:unit` green; `npm run check:spec-kitty` green.

## Activity Log

- 2026-07-12T18:24:06Z – user – shell_pid=0 – Done override: Already implemented and merged to main via PR #229 (commits 29dc9f9b4, 012b3d6c4, 39dbaab34, bddac339f); mission tracking was stale relative to actual repo state.
