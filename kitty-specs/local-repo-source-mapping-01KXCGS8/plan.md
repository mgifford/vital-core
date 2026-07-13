# Implementation Plan: Local repository source mapping (MCP step 4)

**Branch**: `claude/vital-core-issue-214-spec-m237h3` | **Date**: 2026-07-13 | **Spec**: [spec.md](spec.md)
**Mission**: `local-repo-source-mapping-01KXCGS8`

## Summary

Add a fourth MCP tool, `vital_find_probable_sources`, to the existing
`mcp/` package. Given a `finding_id`, it reuses the already-shipped
`vital_get_finding_context` machinery to fetch that finding's evidence
(`xpath`, `html_snippet`), extracts framework-agnostic signals from that
evidence (CSS classes/IDs, `data-*` attributes, distinctive text,
script/stylesheet URLs), and searches a configured local repository root
for files whose contents match those signals. Off by default
(`permissions.read_repository: false`); when enabled,
`local.repository_path` names the single directory the search may touch,
enforced by a new filesystem-boundary module mirroring the existing
`mcp/security/host-allowlist.js` network-boundary pattern. Every result
carries an honest confidence tier (`high`/`medium`/`low`) and the specific
matched signals — never a single claimed answer.

## Technical Context

**Language/Version**: Node.js ESM ≥20, no build step, no bundler — consistent with `mcp/`'s existing implementation and the rest of the repo.
**Primary Dependencies**: None new. Uses only `node:fs`, `node:path` for filesystem walking/reading (NFR-003) — no glob/ignore library added; the small built-in default-ignore list (FR-009) is a plain array of directory-name/extension checks.
**Storage**: None new. The search runs fresh on every tool call — no cache, no SQLite (spec.md Out of Scope; issue #214 step 2 remains deferred).
**Testing**: Node built-in test runner (`npm run test:unit`), new tests under `tests/unit/mcp/`. Per spec.md NFR-005, filesystem tests use a synthetic fixture directory created under `os.tmpdir()` per test (`fs.mkdtempSync`), never the real repository checkout — hermetic and deletable.
**Target Platform**: Same as the existing `mcp/` package — a local developer machine, invoked by an MCP-compatible coding client over stdio.
**Project Type**: Single project; this mission extends the existing `mcp/` module, adding no new top-level directory.
**Performance Goals**: Not perf-sensitive in the traditional sense — bounded by the file-count/size caps in FR-008, not throughput. A call against a large repository must still return within the existing tool-call timeout conventions the MCP client expects (no explicit SLA in spec.md beyond "bounded," per NFR-003's minimal-dependency constraint keeping the implementation simple enough to reason about).
**Constraints**: No write access anywhere (NFR-001). No path traversal outside `local.repository_path` under any input, including via symlinks (FR-004). No shell/command execution of any kind (unchanged repo-wide constraint, also explicit in spec.md C-002).
**Scale/Scope**: One repository root per `.vital.yml`, one `vital_find_probable_sources` call per finding investigated — same "one developer session" scope as the existing three tools.

## Charter Check

*GATE: checked before design, re-checked after design below.*

- **Sustainability gate**: N/A — this ships a local CLI tool addition, not report HTML/JS/CSS output. No client-side bytes added, no report-page change. PASS.
- **Security rules**: no VA-domain interaction, no `.env`/`HF_TOKEN` handling, no `data/`/`state/` access. This mission introduces the package's **first** local-filesystem-reading capability — the Charter's baseline security rules don't speak to this directly, but the mission's own constraints (C-001 default-off, C-004 single reusable boundary module, NFR-004 inert-signal handling) are the applicable gate here, enforced by adversarial tests (spec.md Scenario 4), not review alone. PASS, contingent on WP03's path-traversal test suite actually landing.
- No other charter directive in tension with a local, opt-in, read-only filesystem search tool.

*Re-check after Design: unchanged — the concrete module layout below introduces exactly one new trust boundary (the filesystem root), and it is enforced the same way the existing network boundary already is: one shared, tested module, not per-call-site logic.*

## Project Structure

### Documentation (this mission)

```
kitty-specs/local-repo-source-mapping-01KXCGS8/
├── spec.md
├── plan.md              # this file
└── tasks.md             # produced by the tasks phase, not this plan
```

No `research.md` / `data-model.md` / `quickstart.md` / `contracts/` — this
mission is small enough to live entirely in this plan, matching how
`local-mcp-server-01KX94K7` (the phase-1 mission this one extends) was
planned. `MCP.md` remains the user-facing documentation, updated in WP04.

### Source Code (repository root)

```
mcp/
├── server.js                         # + register findProbableSourcesTool in TOOLS
├── config/
│   └── vital-config.js               # + permissions.read_repository, local.repository_path,
│                                      #   local.ignore_patterns resolution
├── tools/
│   └── find-probable-sources.js      # NEW: the tool itself
├── security/
│   ├── host-allowlist.js             # unchanged (network boundary)
│   └── path-allowlist.js             # NEW: filesystem boundary (mirrors host-allowlist.js)
└── local/
    ├── signals.js                    # NEW: extract signals from xpath/html_snippet
    ├── search.js                     # NEW: bounded directory walk + signal matching
    └── default-ignore.js             # NEW: the small built-in ignore list (FR-009)

tests/
└── unit/
    └── mcp/
        ├── path-allowlist.test.js    # NEW: boundary enforcement + traversal/symlink tests
        ├── signals.test.js           # NEW: signal-extraction unit tests
        ├── search.test.js            # NEW: bounded-search + confidence-tier tests
        └── find-probable-sources.test.js  # NEW: end-to-end tool test against a synthetic fixture tree
```

**Structure Decision**: extend the existing single-project `mcp/` module
with two new subdirectories (`mcp/security/path-allowlist.js` alongside
the existing `host-allowlist.js`; a new `mcp/local/` for the
filesystem-search-specific logic, kept separate from `mcp/tools/` so the
tool file itself stays thin and delegates to testable, single-purpose
modules — matching how `mcp/api/vital-api-client.js` is kept separate from
the tools that call it).

## Design

### Config resolution (`mcp/config/vital-config.js`)

`resolveVitalConfig(raw)` gains three new optional fields, resolved
defensively (absent input never throws — the tool itself refuses cleanly
per FR-002, the config loader just resolves what's present):

```js
const permissions = raw.permissions ?? {};
const readRepository = permissions.read_repository === true; // strict opt-in, like webmcpEnabled in src/lib/config.js
const local = raw.local ?? {};
let repositoryPath = null;
if (readRepository) {
  if (typeof local.repository_path !== 'string' || local.repository_path.trim() === '') {
    throw new Error('.vital.yml: "local.repository_path" is required when "permissions.read_repository" is true.');
  }
  // Resolved relative to .vital.yml's own directory, never process.cwd() (FR-003).
  repositoryPath = path.isAbsolute(local.repository_path)
    ? local.repository_path
    : path.resolve(path.dirname(configFilePath), local.repository_path);
}
const ignorePatterns = Array.isArray(local.ignore_patterns) ? local.ignore_patterns : [];
```

`loadVitalConfig(filePath)` already has `filePath` in scope — it must now
pass it through to `parseVitalConfig`/`resolveVitalConfig` (a small
signature change: `resolveVitalConfig(raw, configFilePath)`,
`parseVitalConfig(yamlText, configFilePath)`) so the relative-path
resolution in FR-003 has something to resolve against. `configFilePath`
should default to `process.cwd()` (via `path.resolve('.')` as the
"directory" input when the parameter is omitted) so every existing call
site that doesn't care about `local.repository_path` — i.e. every test in
`tests/unit/mcp/vital-config.test.js` that calls `parseVitalConfig(yaml)`
or `resolveVitalConfig(obj)` with no second argument — keeps compiling and
passing unmodified. This is the one call-site-touching change to existing
production code in this mission (`mcp/server.js:18`'s `loadVitalConfig(configPath)`
call needs no change at all, since it already passes `configPath` as the
first argument and the new second parameter only matters for tests/callers
that explicitly want repository-path resolution). Grep
`tests/unit/mcp/vital-config.test.js` for every `parseVitalConfig(`/
`resolveVitalConfig(` call before starting, to confirm none of them break
under the optional-parameter default (WP01 owns verifying this, not just
assuming it).

The resolved config object gains `readRepository` (boolean),
`repositoryPath` (absolute string or `null`), `ignorePatterns` (array) —
following the existing resolved-config field naming style (`apiBase`,
`domain`, `host`).

### Filesystem boundary (`mcp/security/path-allowlist.js`)

Mirrors `host-allowlist.js`'s `assertAllowedUrl` shape exactly:

```js
export function assertPathWithinRoot(targetPath, allowedRoot) {
  const resolved = fs.realpathSync(targetPath); // resolves symlinks — a link escaping the root is caught here
  const normalizedRoot = fs.realpathSync(allowedRoot);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`Filesystem access blocked: "${targetPath}" is outside the configured repository root "${allowedRoot}".`);
  }
  return resolved;
}
```

Using `fs.realpathSync` (not just string-prefix checks on the unresolved
path) is what satisfies FR-004's symlink requirement — a symlink inside
`repositoryPath` that points outside it resolves to its real target before
the boundary check runs, so it's caught rather than silently followed.
Every file the search logic opens goes through this function first — no
call site is allowed to skip it (C-004).

### Signal extraction (`mcp/local/signals.js`)

Pure function, no I/O: `extractSignals(finding)` takes the finding object
`vital_get_finding_context` already returns (`{ xpath, html_snippet, ... }`)
and returns a typed list of signals, each tagged with its type (so
confidence scoring in `search.js` can count *distinct types* matched, not
just total match count — spec.md NFR-002's "single weak signal ⇒ low"
requirement depends on this distinction):

```js
// Returns [{ type: 'css_class' | 'css_id' | 'data_attr' | 'text' | 'asset_url', value: string }, ...]
export function extractSignals(finding) { /* parse html_snippet for class="...", id="...",
  data-*="...", and any <script src>/<link href>; parse xpath for element IDs if present;
  extract distinctive text runs (min length threshold, stopword-filtered) from html_snippet's
  text content */ }
```

All extracted `value` strings are used later **only** as literal
substring/escaped-regex matches (never as raw regex, never as a path
component, never passed to any shell) — this is what closes NFR-004's
injection-surface requirement by construction: the boundary is enforced at
the one place values flow out of this module, not scattered across call
sites.

### Bounded search (`mcp/local/search.js`)

```js
export function searchForSignals(repositoryRoot, signals, { maxFiles = 5000, maxFileSizeBytes = 1_000_000, ignorePatterns = [] } = {}) {
  // Walk repositoryRoot (fs.readdirSync recursive, or manual stack-based walk
  // for wider Node-version compatibility), skipping DEFAULT_IGNORE ∪ ignorePatterns
  // and any entry that assertPathWithinRoot rejects. Stop after maxFiles files
  // visited (FR-008) — files-visited count, not just matches found, since an
  // unbounded walk is the actual cost even with zero matches. Skip any file
  // whose size exceeds maxFileSizeBytes before reading its content.
  // For each surviving file, check which signals' values appear as literal
  // substrings in its content; a file with zero matches is dropped.
  // Confidence tier per matched file = f(distinct signal TYPES matched):
  //   >=3 distinct types -> 'high', 2 -> 'medium', 1 -> 'low' (spec.md
  //   Assumptions: exact thresholds are a plan.md decision, not spec-fixed;
  //   these three numbers are this plan's choice, validated by WP03's tests
  //   against spec.md Scenario 1 (clear single-file match with a distinctive
  //   class -> at least 'medium', likely 'high' if the snippet yields >=2
  //   signal types from that one match) and Scenario 3 (one common class
  //   alone -> 'low', never higher).
  // Return candidates sorted by (tier desc, distinct-signal-count desc),
  // capped at 20 (FR-007), each as { path: <relative to repositoryRoot>,
  // confidence: 'high'|'medium'|'low', matched_signals: [...] }.
}
```

`DEFAULT_IGNORE` (in `mcp/local/default-ignore.js`) is a small, explicit
list: `node_modules`, `.git`, `.svn`, `vendor` (common in PHP/Drupal repos
— excluding it by default is reasonable even in a framework-agnostic
mission, since vendored code is never the source of a project's own
markup), plus a short binary-extension denylist (`.png`, `.jpg`, `.gif`,
`.woff`, `.woff2`, `.ttf`, `.zip`, `.pdf`, ...) checked by extension before
any read — cheaper than sniffing file content, sufficient for FR-009's
intent.

### The tool (`mcp/tools/find-probable-sources.js`)

Follows the existing tool shape exactly (`{ name, description, inputSchema,
async handler(args, ctx) }`), reusing `resolveLatestWeek`/the API client
from `mcp/tools/shared.js` and `ctx.apiClient` the same way
`get-finding-context.js` does to fetch the finding, then delegates to
`extractSignals`/`searchForSignals`:

```js
export const findProbableSourcesTool = {
  name: 'vital_find_probable_sources',
  description:
    'Search the local repository for files that probably produced a finding\'s rendered output. ' +
    'Returns ranked candidates with a confidence tier (high/medium/low) and matched signals — ' +
    'this is a probabilistic estimate, never a certain attribution; verify before assuming a result is correct. ' +
    'Requires permissions.read_repository: true and local.repository_path in .vital.yml.',
  inputSchema: { /* same shape as get-finding-context: finding_id required, week optional */ },
  async handler(args, ctx) {
    if (!ctx.config.readRepository) {
      return {
        found: false,
        reason: 'permission_disabled',
        message: 'Local repository search is disabled. Set "permissions.read_repository: true" and "local.repository_path" in .vital.yml to enable vital_find_probable_sources.',
      };
    }
    // fetch finding via the same path get-finding-context.js uses (extract
    // that fetch-by-id logic to mcp/tools/shared.js if not already
    // reusable as-is, to avoid duplicating it — WP02 decides the exact
    // refactor, minimal footprint preferred)
    // ...
    const signals = extractSignals(finding);
    const candidates = searchForSignals(ctx.config.repositoryPath, signals, {
      ignorePatterns: ctx.config.ignorePatterns,
    });
    return { found: true, finding_id: args.finding_id, week, candidate_count: candidates.length, candidates };
  },
};
```

Note the NFR-002 warning is embedded directly in the tool's own
`description` string (not just `MCP.md`) — this is what makes it visible
to an MCP client (and by extension any LLM reading the tool list) at the
point of use, per spec.md's explicit requirement that this isn't only
documentation-level.

### Registration (`mcp/server.js`)

One-line addition to the `TOOLS` array:
```js
export const TOOLS = [getProjectContextTool, listFindingsTool, getFindingContextTool, findProbableSourcesTool];
```
No other change to `server.js`'s transport/dispatch logic — `callTool`'s
generic try/catch and `isError` handling already covers this tool's error
paths (a thrown `Error` from `assertPathWithinRoot`, for instance) with no
special-casing needed.

## Work Breakdown

1. **WP01 — Config resolution** — `permissions.read_repository`,
   `local.repository_path` (resolved relative to `.vital.yml`'s own path,
   not cwd), `local.ignore_patterns` in `mcp/config/vital-config.js`;
   update `loadVitalConfig`'s signature threading and every existing call
   site/test that constructs a resolved config. Covers FR-002, FR-003,
   C-001.
2. **WP02 — Filesystem boundary + signal extraction** —
   `mcp/security/path-allowlist.js` (symlink-safe root enforcement) and
   `mcp/local/signals.js` (pure signal extraction from finding evidence,
   no I/O). Covers FR-004, FR-005, NFR-004, C-004. These two are grouped
   because both are small, pure, independently-testable modules with no
   dependency on each other or on WP03's search logic, and both are
   prerequisites for WP03.
3. **WP03 — Bounded search + the tool itself** —
   `mcp/local/search.js` (walk, match, confidence tiering, capping),
   `mcp/local/default-ignore.js`, `mcp/tools/find-probable-sources.js`,
   registration in `mcp/server.js`. Covers FR-001, FR-006, FR-007, FR-008,
   FR-009, NFR-001, NFR-002, NFR-003. Depends on WP01 (needs resolved
   config fields) and WP02 (needs the boundary + signal modules).
4. **WP04 — Tests + docs** — the four new test files under
   `tests/unit/mcp/` (boundary/traversal adversarial tests are the
   highest-priority subset — spec.md Scenario 4 is a hard gate per the
   Charter Check above), plus the `MCP.md` update moving this tool out of
   "Not yet implemented" into a documented section. Covers NFR-005,
   FR-010, and is the acceptance gate for Success Criteria 3 and 4
   (adversarial path test; confidence-tier conservatism test). Depends on
   WP01–WP03 (tests the final, integrated shape).

Dependency order: WP01 has no dependencies. WP02 has no dependencies
(independent of WP01 — pure modules, no config coupling). WP03 depends on
WP01 and WP02. WP04 depends on WP01, WP02, and WP03.

## Complexity Tracking

*Fill ONLY if Charter Check has violations that must be justified.*

No charter violations. The one meaningful new risk this mission
introduces — a filesystem-reading tool where none existed before — is
addressed directly by design (default-off, single enforced boundary,
bounded scan, honest confidence tiers) rather than deferred or waived.
