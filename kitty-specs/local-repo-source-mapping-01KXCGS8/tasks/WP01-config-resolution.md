---
work_package_id: WP01
title: Config resolution
dependencies: []
requirement_refs:
- C-001
- FR-002
- FR-003
tracker_refs: []
planning_base_branch: claude/vital-core-issue-214-spec-m237h3
merge_target_branch: claude/vital-core-issue-214-spec-m237h3
branch_strategy: Planning artifacts for this mission were generated on claude/vital-core-issue-214-spec-m237h3. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/vital-core-issue-214-spec-m237h3 unless the human explicitly redirects the landing branch.
subtasks:
- T001
- T002
- T003
- T004
agent: "claude:sonnet:implementer:implementer"
shell_pid: "68606"
history: []
authoritative_surface: mcp/config/vital-config.js
create_intent: []
execution_mode: code_change
owned_files:
- mcp/config/vital-config.js
- mcp/server.js
- tests/unit/mcp/vital-config.test.js
tags: []
---

## ⚡ Do This First: Load Agent Profile

Before reading anything else in this prompt, load the assigned agent profile
(see this WP's frontmatter `agent_profile`/`role` if set) via the
`ad-hoc-profile-load` skill/command. If no profile is assigned, proceed as a
general implementer.

## Objective

Add `.vital.yml` support for `permissions.read_repository`,
`local.repository_path`, and `local.ignore_patterns` — the three new
config fields WP03's tool depends on. `local.repository_path` must resolve
relative to `.vital.yml`'s own file location, never the process's current
working directory. This WP touches `mcp/config/vital-config.js`'s public
function signatures, so it also verifies every existing call site and test
still works.

Read `kitty-specs/local-repo-source-mapping-01KXCGS8/spec.md` (FR-002,
FR-003, C-001) and `plan.md`'s "Design → Config resolution" subsection
before starting.

## Context: current code (read before editing)

`mcp/config/vital-config.js`'s current exports:

```js
export function resolveVitalConfig(raw) {
  if (raw?.version !== 1) { throw new Error(...); }
  const instance = raw.instance;
  // ... validates instance.api, instance.domain ...
  return { apiBase, domain, host, warnings: [] };
}

export function parseVitalConfig(yamlText) {
  const { text, warnings: envWarnings } = substituteEnvVars(yamlText);
  const raw = YAML.parse(text);
  const resolved = resolveVitalConfig(raw);
  return { ...resolved, warnings: [...envWarnings, ...resolved.warnings] };
}

export function loadVitalConfig(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return parseVitalConfig(text);
}
```

`mcp/server.js`'s only call site: `const config = loadVitalConfig(configPath);`
(line 18) — `configPath` is already an absolute path (resolved from
`process.env.VITAL_MCP_CONFIG` or `path.resolve(process.cwd(),
'.vital.yml')` in `main()`).

`tests/unit/mcp/vital-config.test.js` has 12 tests; none currently pass a
second argument to `parseVitalConfig`/`resolveVitalConfig`. Read the full
file before starting (it's short, ~140 lines).

## Subtasks

### T001: Add the three new fields to `resolveVitalConfig()`.

**Files**: `mcp/config/vital-config.js`

Add a second parameter, `configFilePath`, defaulting to
`process.cwd()`:

```js
export function resolveVitalConfig(raw, configFilePath = process.cwd()) {
  // ... existing version/instance validation unchanged ...

  const permissions = raw.permissions ?? {};
  const readRepository = permissions.read_repository === true; // strict opt-in, no inheritance — mirrors src/lib/config.js's webmcpEnabled pattern (t.webmcpEnabled = t.webmcp === true)

  const local = raw.local ?? {};
  let repositoryPath = null;
  if (readRepository) {
    if (typeof local.repository_path !== 'string' || local.repository_path.trim() === '') {
      throw new Error('.vital.yml: "local.repository_path" is required when "permissions.read_repository" is true.');
    }
    const configDir = path.dirname(configFilePath);
    repositoryPath = path.isAbsolute(local.repository_path)
      ? local.repository_path
      : path.resolve(configDir, local.repository_path);
  }
  const ignorePatterns = Array.isArray(local.ignore_patterns) ? local.ignore_patterns : [];

  return {
    apiBase: apiBaseNormalized,
    domain,
    host: apiUrl.origin,
    readRepository,
    repositoryPath,
    ignorePatterns,
    warnings: [],
  };
}
```

Import `path` from `node:path` at the top of the file (not currently
imported — check before assuming it is).

Note: `configFilePath` defaulting to `process.cwd()` means
`path.dirname(configFilePath)` on the default is `path.dirname(cwd)`,
which is almost certainly *not* what you want semantically when no real
config path is known — but since `repositoryPath` is only computed at all
when `readRepository` is `true`, and no existing test ever sets
`permissions.read_repository: true`, this default value is never actually
exercised by pre-existing tests. It exists purely so the function
signature is backward-compatible for callers that don't care about this
feature. WP04's new tests (via `loadVitalConfig(FIXTURE_PATH)` on a
fixture `.vital.yml` that *does* set `read_repository: true`) are what
actually exercises the real resolution path with a real `configFilePath`.

### T002: Thread `configFilePath` through `parseVitalConfig()` and `loadVitalConfig()`.

**Files**: `mcp/config/vital-config.js`

```js
export function parseVitalConfig(yamlText, configFilePath = process.cwd()) {
  const { text, warnings: envWarnings } = substituteEnvVars(yamlText);
  let raw;
  try {
    raw = YAML.parse(text);
  } catch (err) {
    throw new Error(`.vital.yml: invalid YAML — ${err.message}`);
  }
  const resolved = resolveVitalConfig(raw, configFilePath);
  return { ...resolved, warnings: [...envWarnings, ...resolved.warnings] };
}

export function loadVitalConfig(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return parseVitalConfig(text, filePath);
}
```

`loadVitalConfig` now passes its own `filePath` through — this is the one
meaningful behavior change: a real `.vital.yml` file loaded via
`loadVitalConfig` now resolves `local.repository_path` relative to that
file's directory, satisfying FR-003. `mcp/server.js`'s existing call site
(`loadVitalConfig(configPath)`) needs **no code change** — it already
passes the right argument in the right position; only the exported
function's internals changed.

### T003: Verify existing call sites and tests are unaffected.

**Files**: `mcp/server.js` (read-only verification), `tests/unit/mcp/vital-config.test.js` (read-only verification, no edits — WP01's new tests go in T004, not modifications to existing ones)

Run the existing test suite (`node --test tests/unit/mcp/vital-config.test.js`)
before writing any new tests, to confirm all 12 pre-existing tests still
pass unmodified against your changes. If any fail, the default-parameter
approach in T001/T002 has a bug — do not "fix" it by editing the existing
tests; fix the default so backward compatibility genuinely holds (per
spec.md C-001's intent, extended here to the config-loading layer itself,
not just the new tool's runtime behavior).

Also grep `mcp/` for any other caller of `resolveVitalConfig`/
`parseVitalConfig`/`loadVitalConfig` beyond `mcp/server.js:18` — the
mission's research (see plan.md) found exactly one production call site
at the time of planning, but re-verify against your current checkout in
case anything changed since.

**Validation**: `node --test tests/unit/mcp/vital-config.test.js` — all
12 pre-existing tests pass with zero modifications to their source.

### T004: Add new tests for the three new fields.

**Files**: `tests/unit/mcp/vital-config.test.js`

Add tests covering:
- `permissions.read_repository` absent → `readRepository: false`,
  `repositoryPath: null`, `ignorePatterns: []` (defaults, matching an
  existing `.vital.yml` from before this mission — the C-001 compatibility
  case).
- `permissions.read_repository: false` explicit → same as absent.
- `permissions.read_repository: true` with `local.repository_path` set
  and an absolute path → `repositoryPath` equals that path exactly.
- `permissions.read_repository: true` with `local.repository_path` set
  to a **relative** path, loaded via `loadVitalConfig()` against a real
  fixture file (create a small fixture `.vital.yml` under
  `tests/fixtures/mcp/`, e.g. `tests/fixtures/mcp/.vital-with-repo.yml`,
  alongside the existing `tests/fixtures/mcp/.vital.yml` — check that
  file's exact location/naming convention first) → `repositoryPath`
  resolves relative to the fixture file's own directory, **not**
  `process.cwd()` (this is the test that actually proves FR-003; use a
  relative path like `../../../` or a sibling directory that exists in
  the test fixtures tree, and assert the resolved absolute path matches
  `path.resolve(path.dirname(fixturePath), relativeValue)`).
- `permissions.read_repository: true` with `local.repository_path`
  **missing** → throws, matching the error message pattern in T001's
  code (`assert.throws(..., /"local.repository_path" is required/)`).
- `local.ignore_patterns` as an array → passed through unchanged.
- `local.ignore_patterns` absent or non-array → resolves to `[]`.

**Validation**: `npm run test:unit` passes in full, including all new and
pre-existing `mcp/`-related tests.

## Definition of Done

- [ ] `resolveVitalConfig(raw, configFilePath)` resolves `readRepository`, `repositoryPath`, `ignorePatterns`.
- [ ] `local.repository_path` resolves relative to the `.vital.yml` file's own directory when given a relative path, and passes through unchanged when given an absolute path.
- [ ] `parseVitalConfig`/`loadVitalConfig` thread `configFilePath` correctly; `loadVitalConfig` needs no caller-side change in `mcp/server.js`.
- [ ] All 12 pre-existing tests in `tests/unit/mcp/vital-config.test.js` pass unmodified.
- [ ] New tests (T004) cover every bullet listed above.
- [ ] `npm run check:spec-kitty` passes.

## Risks

- **Backward-compatibility regression is the primary risk** — a subtle
  bug in the default-parameter threading could silently break the 12
  existing tests or `mcp/server.js`'s startup path. Run the existing test
  suite *before* writing any new tests (T003), not just at the end, so a
  regression is caught immediately and attributed to the right change.
- Relative-path resolution is easy to get backwards (resolving against
  `process.cwd()` instead of the config file's directory would silently
  pass in a test run from the repo root but break for any real user whose
  cwd differs from where `.vital.yml` lives) — the dedicated relative-path
  test in T004 is what actually catches this, not incidental coverage.

## Reviewer Guidance

Confirm: (1) `path.dirname(configFilePath)` is genuinely what
`local.repository_path` resolves against, not `process.cwd()`; (2) all 12
pre-existing tests pass with zero source changes to their assertions; (3)
`readRepository` is `false` for any input that doesn't literally set
`permissions.read_repository: true` (no truthy-string coercion, no
inheritance from a hypothetical global default — this mirrors the
`webmcpEnabled` precedent's strict-boolean-equality style).

## Activity Log

- 2026-07-13T01:44:24Z – claude:sonnet:implementer:implementer – shell_pid=64948 – Assigned agent via action command
- 2026-07-13T02:08:55Z – claude:sonnet:implementer:implementer – shell_pid=68031 – Started implementation via action command
- 2026-07-13T02:09:32Z – claude:sonnet:implementer:implementer – shell_pid=68361 – Started implementation via action command
- 2026-07-13T02:09:53Z – claude:sonnet:implementer:implementer – shell_pid=68606 – Started implementation via action command
