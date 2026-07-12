---
work_package_id: WP01
title: Config field resolution
dependencies: []
requirement_refs:
- C-001
- FR-001
- FR-002
tracker_refs: []
planning_base_branch: claude/vital-core-issue-214-spec-m237h3
merge_target_branch: claude/vital-core-issue-214-spec-m237h3
branch_strategy: Planning artifacts for this mission were generated on claude/vital-core-issue-214-spec-m237h3. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/vital-core-issue-214-spec-m237h3 unless the human explicitly redirects the landing branch.
subtasks:
- T001
- T002
- T003
agent: ''
shell_pid: 0
history: []
authoritative_surface: src/lib/
create_intent: []
execution_mode: code_change
owned_files:
- config/targets.yml
- src/lib/config.js
tags: []
---

## ⚡ Do This First: Load Agent Profile

Before reading anything else in this prompt, load the assigned agent profile
(see this WP's frontmatter `agent_profile`/`role` if set) via the
`ad-hoc-profile-load` skill/command. If no profile is assigned, proceed as a
general implementer.

## Objective

Add three new per-target config fields — `domain_scan_cadence`,
`url_rescan_interval_days`, `priority_url_rescan_interval_days` — to
`config/targets.yml`'s `defaults:` block, and resolve them onto every target
in `src/lib/config.js`'s `loadConfig()`. This is the foundation the rest of
the mission (WP02+) builds on: `state.js`'s eligibility rewrite reads
`target.domainScanCadence` / `target.urlRescanIntervalDays` /
`target.priorityUrlRescanIntervalDays`, which this WP creates.

## Context

Read `kitty-specs/scan-cadence-config-01KXBWGE/spec.md` (Functional
Requirements FR-001, FR-002; Constraint C-001) and
`kitty-specs/scan-cadence-config-01KXBWGE/plan.md` (Design → "Config fields"
subsection) before starting — they contain the exact field names, defaults,
and the established merge pattern this WP must follow.

The existing pattern to mirror is in `src/lib/config.js`:
- `config.js:46` — `const targets = (cfg.targets ?? []).map((t) => ({ ...defaults, ...t }));` — plain scalar fields declared in `defaults:` flow through automatically via this shallow merge; a target's own value wins.
- `config.js:54` — `t.showLanguageSwitcher = (t.language_switcher ?? cfg.language_switcher) !== false;` — an example of a resolved/derived field computed after the merge.
- `config.js:55-56` — `t.webmcpEnabled = t.webmcp === true;` — an example of a strict opt-in boolean with no inheritance.
- `config.js:57-63` — the `design_system` validation block — the pattern to mirror for `domain_scan_cadence`'s enum validation (throw a clear error naming the target and the supported values on an invalid value).

## Subtasks

### T001: Document the three new fields in `config/targets.yml`'s `defaults:` block.

**Files**: `config/targets.yml`

Add these three lines to the `defaults:` block (near the other scheduling-
adjacent defaults like `max_pages_per_week`, `retention_weeks`):

```yaml
domain_scan_cadence: incremental   # incremental (default) | daily
url_rescan_interval_days: 7        # ordinary URLs: min days between rescans
priority_url_rescan_interval_days: 7  # priority URLs: min days between rescans
```

Add a one-line comment above each explaining its purpose (see the existing
comments on `max_pages_per_week`/`retention_weeks` for the house style —
short, inline, no essay).

**Validation**: `config/targets.yml` still parses as valid YAML
(`npm run test:unit` includes a YAML-parse-adjacent config test — see
`tests/unit/config.test.js`'s `loadConfig()` calls, which will throw on
malformed YAML).

### T002: Resolve the three fields in `loadConfig()`.

**Files**: `src/lib/config.js`

Inside the per-target loop in `loadConfig()` (the `for (const t of targets)`
block, right after the existing `t.webmcpEnabled = t.webmcp === true;` line
at `config.js:56`), add:

```js
const DOMAIN_SCAN_CADENCES = new Set(['incremental', 'daily']);
// ...
t.domainScanCadence = t.domain_scan_cadence ?? 'incremental';
if (!DOMAIN_SCAN_CADENCES.has(t.domainScanCadence)) {
  throw new Error(`Unsupported domain_scan_cadence "${t.domainScanCadence}" in target ${t.domain}. Supported: incremental, daily.`);
}
t.urlRescanIntervalDays = Number(t.url_rescan_interval_days ?? 7);
t.priorityUrlRescanIntervalDays = Number(t.priority_url_rescan_interval_days ?? 7);
```

Declare `DOMAIN_SCAN_CADENCES` as a module-level `const` near the top of the
file, alongside the existing `DESIGN_SYSTEMS` constant (`config.js:7`) —
same style, same scope.

Note: `t.url_rescan_interval_days` and `t.priority_url_rescan_interval_days`
already flow through from `defaults:` via the shallow spread at
`config.js:46` (they're plain scalars, same mechanism as
`max_pages_per_week`). The `Number(...)` coercion here is a safety net in
case a target's YAML value comes through as a string (e.g. a quoted
number) — it should be a no-op for well-formed config. The `?? 7` fallback
also covers the case where `config/targets.yml` doesn't define
`defaults:` at all (defensive; `config.js` should be self-contained and not
assume the YAML always declares every default).

**Validation**: `loadConfig().targets` — every target object has
`domainScanCadence` (`'incremental'` or `'daily'`), `urlRescanIntervalDays`
(a number), and `priorityUrlRescanIntervalDays` (a number) after this
change, whether or not that target's YAML block sets any of the three raw
fields.

### T003: Confirm `www.cms.gov` is untouched and inherits defaults correctly.

**Files**: none (verification only — do not edit `www.cms.gov`'s block in
`config/targets.yml`)

Per spec.md Constraint C-001, `www.cms.gov`'s target entry must **not** be
given an explicit `domain_scan_cadence`, `url_rescan_interval_days`, or
`priority_url_rescan_interval_days` override. Run a quick manual check
(e.g. `node -e "import('./src/lib/config.js').then(m => console.log(m.loadConfig().targets.find(t => t.domain === 'www.cms.gov')))"`)
and confirm the resolved values are `domainScanCadence: 'incremental'`,
`urlRescanIntervalDays: 7`, `priorityUrlRescanIntervalDays: 7` — i.e.
exactly the global defaults, nothing target-specific.

**Validation**: `www.cms.gov`'s `config/targets.yml` block has zero lines
changed by this WP; its resolved config fields equal the global defaults.

## Definition of Done

- [ ] `config/targets.yml`'s `defaults:` block has the three new documented fields.
- [ ] `src/lib/config.js` resolves `domainScanCadence`, `urlRescanIntervalDays`, `priorityUrlRescanIntervalDays` onto every target.
- [ ] Invalid `domain_scan_cadence` values throw a clear, target-named error (mirroring the `design_system` validation pattern).
- [ ] `www.cms.gov`'s target block in `config/targets.yml` is unmodified.
- [ ] `npm run test:unit` passes (existing `tests/unit/config.test.js` tests must not regress — this WP does not add new tests; that is WP04's job, but existing config tests must still pass since `loadConfig()`'s shape changed).
- [ ] `npm run check:spec-kitty` passes.

## Risks

Low. This WP follows two already-established, already-tested patterns in
the same file (`design_system` enum validation, `webmcpEnabled` opt-in
resolution) and touches no other module. The main risk is a typo in the
enum values or default numbers that WP02/WP03/WP04 would then build on
incorrectly — double-check the exact strings (`'incremental'`, `'daily'`)
and default number (`7`) against spec.md before finishing.

## Reviewer Guidance

Confirm: (1) the three fields resolve correctly for a target with no
overrides (defaults apply), (2) a target-level override wins over the
global default for each of the three fields independently, (3) an invalid
`domain_scan_cadence` throws rather than silently falling back, (4)
`www.cms.gov` truly has zero diff in `config/targets.yml`.
