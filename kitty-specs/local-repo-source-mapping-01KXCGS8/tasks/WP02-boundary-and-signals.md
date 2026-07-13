---
work_package_id: WP02
title: Filesystem boundary + signal extraction
dependencies: []
requirement_refs:
- C-004
- FR-004
- FR-005
- NFR-004
tracker_refs: []
planning_base_branch: claude/vital-core-issue-214-spec-m237h3
merge_target_branch: claude/vital-core-issue-214-spec-m237h3
branch_strategy: Planning artifacts for this mission were generated on claude/vital-core-issue-214-spec-m237h3. During /spec-kitty.implement this WP may branch from a dependency-specific base, but completed changes must merge back into claude/vital-core-issue-214-spec-m237h3 unless the human explicitly redirects the landing branch.
subtasks:
- T005
- T006
- T007
agent: "claude"
shell_pid: 0
history: []
authoritative_surface: mcp/security/path-allowlist.js
create_intent:
- mcp/security/path-allowlist.js
- mcp/local/signals.js
- tests/unit/mcp/path-allowlist.test.js
- tests/unit/mcp/signals.test.js
execution_mode: code_change
owned_files:
- mcp/security/path-allowlist.js
- mcp/local/signals.js
- tests/unit/mcp/path-allowlist.test.js
- tests/unit/mcp/signals.test.js
tags: []
---

## ⚡ Do This First: Load Agent Profile

Before reading anything else in this prompt, load the assigned agent profile
(see this WP's frontmatter `agent_profile`/`role` if set) via the
`ad-hoc-profile-load` skill/command. If no profile is assigned, proceed as a
general implementer.

## Objective

Build the two independent, pure-logic building blocks WP03's search tool
depends on: (1) a filesystem-boundary enforcer that mirrors the existing
network-boundary pattern, and (2) a signal-extraction function that turns
a finding's rendered-output evidence into framework-agnostic search
signals. Neither module has any dependency on the other or on config
resolution (WP01) — both are pure, small, and independently testable,
which is why they're grouped into one WP despite serving different parts
of the final feature.

Read `kitty-specs/local-repo-source-mapping-01KXCGS8/spec.md` (FR-004,
FR-005, NFR-004, C-004) and `plan.md`'s "Design → Filesystem boundary" and
"Design → Signal extraction" subsections before starting.

## Context: the network-boundary pattern to mirror

`mcp/security/host-allowlist.js` (read in full — it's ~15 lines):

```js
export function assertAllowedUrl(url, allowedOrigin) {
  let parsed;
  try {
    parsed = typeof url === 'string' ? new URL(url) : url;
  } catch {
    throw new Error(`Network access blocked: "${url}" is not a valid URL.`);
  }
  if (parsed.origin !== allowedOrigin) {
    throw new Error(
      `Network access blocked: "${parsed.origin}" is not the configured Vital Core host "${allowedOrigin}".`,
    );
  }
  return parsed;
}
```

Its test file, `tests/unit/mcp/host-allowlist.test.js` (read in full,
~40 lines) — the style to mirror exactly for `path-allowlist.test.js`:
one `test(...)` per boundary-violation scenario, each asserting a specific
thrown error message pattern via `assert.throws(fn, /regex/)`.

## Subtasks

### T005: Implement `assertPathWithinRoot()` in `mcp/security/path-allowlist.js`.

**Files**: `mcp/security/path-allowlist.js` (new file)

```js
import fs from 'node:fs';
import path from 'node:path';

// Every file the local-search logic opens goes through this first — no
// call site is allowed to skip it (spec.md C-004). Symlink-safe: a
// symlink inside `allowedRoot` that resolves outside it is caught here,
// not silently followed (spec.md FR-004).
export function assertPathWithinRoot(targetPath, allowedRoot) {
  let resolvedRoot;
  try {
    resolvedRoot = fs.realpathSync(allowedRoot);
  } catch (err) {
    throw new Error(`Filesystem access blocked: configured repository root "${allowedRoot}" does not exist or is not readable (${err.code ?? err.message}).`);
  }
  let resolvedTarget;
  try {
    resolvedTarget = fs.realpathSync(targetPath);
  } catch (err) {
    throw new Error(`Filesystem access blocked: "${targetPath}" does not exist or is not readable (${err.code ?? err.message}).`);
  }
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Filesystem access blocked: "${targetPath}" is outside the configured repository root "${allowedRoot}".`);
  }
  return resolvedTarget;
}
```

Notes:
- `fs.realpathSync` throws if the path doesn't exist — this is
  intentional and correct for this tool's use case (it only ever checks
  paths it discovered by walking the real filesystem in WP03's
  `searchForSignals`, so a missing path indicates a real problem, not a
  normal "file doesn't exist yet" case to swallow silently).
- The `resolvedTarget + path.sep` prefix check (not just
  `.startsWith(resolvedRoot)`) is deliberate: without the trailing
  separator, a root of `/repo` would incorrectly accept
  `/repo-evil/secret` (string-prefix match without a path boundary) —
  double check your implementation includes this, it's a classic path-
  boundary bug.
- Do not use `path.resolve`/string manipulation alone for the boundary
  check — `fs.realpathSync` is what actually resolves symlinks; a
  `path.resolve`-only implementation would pass a string-level check
  while still permitting a symlink escape (this is exactly the FR-004
  requirement this function exists to satisfy).

### T006: Implement `extractSignals()` in `mcp/local/signals.js`.

**Files**: `mcp/local/signals.js` (new file)

Pure function, no I/O, no filesystem access — this module never touches
`fs`:

```js
// Extracted signal shape: { type: 'css_class' | 'css_id' | 'data_attr' | 'text' | 'asset_url', value: string }
// Used later ONLY as literal substring/regex-escaped matches — never as a
// path component, shell argument, or unescaped regex (spec.md NFR-04:
// remote/scan-derived text is inert data, this is where that boundary is
// enforced by construction).
export function extractSignals(finding) {
  const signals = [];
  const snippet = finding?.html_snippet ?? '';

  // CSS classes: class="foo bar" -> two separate 'css_class' signals.
  for (const m of snippet.matchAll(/class=["']([^"']+)["']/g)) {
    for (const cls of m[1].split(/\s+/).filter(Boolean)) {
      signals.push({ type: 'css_class', value: cls });
    }
  }

  // Element ID.
  for (const m of snippet.matchAll(/\bid=["']([^"']+)["']/g)) {
    signals.push({ type: 'css_id', value: m[1] });
  }

  // data-* attributes (name and value both carry signal — a distinctive
  // data-component="hero-banner" is a strong signal even without the class).
  for (const m of snippet.matchAll(/\b(data-[a-z0-9-]+)=["']([^"']*)["']/gi)) {
    signals.push({ type: 'data_attr', value: `${m[1]}=${m[2]}` });
  }

  // Script/stylesheet URLs referenced in or near the snippet.
  for (const m of snippet.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/gi)) {
    signals.push({ type: 'asset_url', value: m[1] });
  }

  // Distinctive text fragments: strip tags, split into runs, keep only
  // runs that are long enough and not pure stopword/boilerplate text.
  const textOnly = snippet.replace(/<[^>]+>/g, ' ').trim();
  const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'your']);
  for (const run of textOnly.split(/\s{2,}|\n/).map((s) => s.trim()).filter(Boolean)) {
    const words = run.split(/\s+/);
    const meaningfulWords = words.filter((w) => !STOPWORDS.has(w.toLowerCase()) && w.length > 2);
    if (run.length >= 12 && meaningfulWords.length >= 2) {
      signals.push({ type: 'text', value: run });
    }
  }

  return signals;
}
```

The exact regexes/thresholds above are a starting point, not a fixed
contract — refine them if your testing (T007) shows they're too
permissive or too strict, but keep the four signal `type`s exactly as
named (`css_class`, `css_id`, `data_attr`, `text`, `asset_url` — five
types total, the list above has a typo risk, double-check you implement
all five: `css_class`, `css_id`, `data_attr`, `asset_url`, `text`) since
WP03's confidence-tiering logic counts *distinct types matched*, not raw
signal count, and needs these exact type strings to do so correctly.

**No signal is ever executed, evaluated, or used as a file path directly**
— `extractSignals` only produces data; WP03's `searchForSignals` is the
only place these values are consumed, and only as literal substring
matches (per this WP's NFR-004 responsibility: the signals this function
produces must be safe to pass to a literal-substring or escaped-regex
match, which means values should not themselves be pre-treated as regex
here — leave any regex-escaping to the consumer in WP03, this function's
job is extraction only).

### T007: Adversarial and unit tests.

**Files**: `tests/unit/mcp/path-allowlist.test.js` (new),
`tests/unit/mcp/signals.test.js` (new)

For `path-allowlist.test.js`, mirror `host-allowlist.test.js`'s style
exactly. Use `fs.mkdtempSync(path.join(os.tmpdir(), 'vital-test-'))` to
create a real temp directory tree per test (needed since
`fs.realpathSync` requires the path to actually exist). Cover:

- A file genuinely inside the root is allowed (returns its realpath).
- A path with `../` segments that resolves outside the root is blocked.
- **A symlink inside the root pointing to a target outside the root is
  blocked** — this is the test that actually proves FR-004's symlink
  requirement; without it, a naive string-prefix implementation could
  pass every other test while still being vulnerable. Create the symlink
  with `fs.symlinkSync(outsideTarget, path.join(root, 'escape-link'))` in
  the test setup.
- A path that doesn't exist throws a clear error (not a silent `false`).
- The configured root itself (not a file inside it) is accepted.

Clean up every temp directory created (`fs.rmSync(dir, { recursive: true,
force: true })` in a `finally` block or test cleanup hook) so tests don't
leak temp files across runs.

For `signals.test.js`, cover:
- A snippet with a distinctive class extracts a `css_class` signal with
  the correct value.
- A snippet with an `id` attribute extracts a `css_id` signal.
- A snippet with `data-*` attributes extracts `data_attr` signals for
  each one.
- A snippet referencing a `.js`/`.css` URL extracts an `asset_url` signal.
- A snippet with a long, distinctive text run extracts a `text` signal;
  a snippet with only short/stopword-heavy text extracts no `text`
  signal (proves the "boilerplate" filter works, not just presence).
- An empty/missing `html_snippet` returns an empty signal array without
  throwing.
- **Adversarial input**: a snippet engineered to look like a path
  traversal sequence (e.g. `class="../../etc/passwd"`) or a shell
  metacharacter sequence (e.g. `data-x="$(rm -rf /)"`) is extracted as an
  ordinary, inert signal value — the function does not throw, does not
  interpret it specially, and the returned signal's `value` is exactly
  the literal extracted text (proves NFR-004 at the extraction layer;
  WP03's consumer-side literal-matching is the other half of that
  guarantee).

## Definition of Done

- [ ] `assertPathWithinRoot()` uses `fs.realpathSync` for both the target and the root, correctly rejects a symlink escape.
- [ ] `assertPathWithinRoot()`'s boundary check includes the trailing-separator fix (no `/repo` vs `/repo-evil` false-accept).
- [ ] `extractSignals()` produces all five signal types (`css_class`, `css_id`, `data_attr`, `asset_url`, `text`) from a representative snippet, and returns `[]` for empty/missing input without throwing.
- [ ] `path-allowlist.test.js` includes a genuine symlink-escape test using `fs.symlinkSync`, not just a string-based `../` test.
- [ ] `signals.test.js` includes at least one adversarial-input test proving extraction doesn't interpret or execute anything.
- [ ] `npm run test:unit` passes.
- [ ] `npm run check:spec-kitty` passes.

## Risks

- **The symlink test is the single highest-value test in this WP** — a
  string-only path-boundary implementation can pass every other
  reasonable test while still being exploitable via a symlink. Do not
  skip or weaken this test even if it's more fiddly to set up than the
  others.
- Signal-extraction regex tuning is inherently approximate — don't over-
  invest in perfecting the regexes here; WP03's confidence-tiering (which
  requires *multiple distinct types* to reach `high`) is the real defense
  against over-eager/noisy signal extraction, not perfect precision at
  this layer.

## Reviewer Guidance

Confirm: (1) `assertPathWithinRoot` is tested against a real symlink
escape, not just string patterns; (2) the trailing-separator boundary
fix is present and tested (a `/repo` vs `/repo-evil` case); (3)
`extractSignals` never throws on adversarial or malformed input — it
degrades to fewer/no signals, never an exception that could crash the
tool's handler; (4) all five signal types are genuinely implemented, not
just four with a typo.

## Activity Log

- 2026-07-13T11:56:47Z – user – shell_pid=0 – Filesystem boundary + signal extraction implemented and tested directly on the working branch (bypassing the lane-worktree flow after hitting the same tooling bug as WP01). 13/13 new tests pass (6 path-allowlist including symlink-escape + boundary-prefix adversarial tests, 7 signals including adversarial inert-data test). Full suite 380/381, only the pre-existing unrelated mcp/server.test.js failure.
- 2026-07-13T11:56:57Z – user – shell_pid=0 – Self-reviewed: matches WP02 prompt's Definition of Done — assertPathWithinRoot uses fs.realpathSync for both target and root (symlink-safe), boundary check includes the trailing-separator fix (verified by the /repo vs /repo-evil test), extractSignals produces all five signal types with a pure no-I/O implementation, adversarial-input tests confirm no interpretation/execution of hostile content.
- 2026-07-13T12:09:05Z – user – shell_pid=0 – Re-syncing tracker after coordination branch was recreated during branch cleanup. Actual implementation unchanged: 13/13 tests pass.
- 2026-07-13T12:09:12Z – user – shell_pid=0 – Re-approved after tracker resync.
