# Tasks: Siteimprove Replacement for US Government

## Phase 1 - Foundation

### WP01: Establish Alfa integration baseline

- [ ] T001 Add Alfa execution path suitable for CI and local runs
- [ ] T002 Capture and persist raw Alfa result payloads for scanned pages

Depends on: None
Refs: FR-1, FR-2, FR-3

### WP02: Normalize findings across Alfa and Axe

- [ ] T001 Define canonical normalized finding schema
- [ ] T002 Implement Alfa + Axe adapters to normalized schema
- [ ] T003 Add crosswalk fixtures and normalization unit tests

Depends on: WP01
Refs: FR-4

## Phase 2 - Prioritization and Reporting

### WP03: Implement consensus prioritization

- [ ] T001 Build overlap classifier (consensus/alfa-only/axe-only)
- [ ] T002 Apply priority tiers and deterministic sorting logic

Depends on: WP02
Refs: FR-5

### WP04: Extend JSON exports and dashboard summaries

- [ ] T001 Add consensus fields to run JSON artifacts
- [ ] T002 Add consensus and trend summary views to dashboard

Depends on: WP03
Refs: FR-6, FR-9

## Phase 3 - CI and Hardening

### WP05: Harden CI, history persistence, and rollout docs

- [ ] T001 Validate workflow reliability and runtime guardrails
- [ ] T002 Finalize operational docs and rollout guidance

Depends on: WP04
Refs: FR-7, FR-8
