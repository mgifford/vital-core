# Spec: Local repository source mapping (MCP step 4)

**Mission**: `local-repo-source-mapping-01KXCGS8`
**Branch**: `claude/vital-core-issue-214-spec-m237h3`
**Status**: Draft
**Source issue**: [#214](https://github.com/mgifford/vital-core/issues/214)

---

## Purpose

Issue #214's step 3 (mission `local-mcp-server-01KX94K7`, merged PR #223)
shipped a local MCP server that retrieves remote findings from a Vital Core
instance's `/api/v1/` — evidence only, no repository access. Issue #214's
step 4 is next: given a finding's evidence (a CSS selector/XPath, an HTML
snippet, the page URL), search the developer's own local repository
checkout and report **probable** source locations — the template, stylesheet
rule, or component most likely responsible — with an explicit confidence
level, never a claimed certainty.

This is deliberately the hard, honest layer issue #214 itself calls out:

> "The system must therefore report evidence and confidence, not pretend it
> has certain attribution."

Accessibility scanners inspect rendered output; developers edit source
code. There is rarely a perfect direct mapping. This mission's tool must
never assert a single "the answer is this file" result — it always returns
a ranked list of candidates with the signals that produced each one.

## Problem Statement

`vital_get_finding_context` (already shipped) returns a finding's evidence
verbatim — `xpath`, `html_snippet`, the affected page URL, WCAG rule. A
developer using an MCP-compatible coding agent still has to manually guess
which file in their checkout produced that markup. This mission automates
the first, generic pass of that guess: match the finding's rendered-output
signals against files in the local checkout using signals that don't
require any framework-specific knowledge (CSS selectors/classes, element
IDs, `data-*` attributes, distinctive text fragments, script/stylesheet
URLs referenced in the snippet, and route/URL-path-based directory
conventions). Framework-specific enrichment (Drupal's theme registry, Twig
template suggestions) is explicitly **out of scope** — see Out of Scope —
and is issue #214's step 5, a separate future mission.

## Scope of this mission

Add a new MCP tool, `vital_find_probable_sources`, to the existing local
MCP server (`mcp/`), gated behind a new opt-in permission
(`permissions.read_repository: true` in `.vital.yml`, default `false` —
the server does **not** read the local filesystem unless explicitly
enabled). When enabled, the tool:

1. Takes a `finding_id` (and optional `week`), fetches that finding's
   evidence via the existing `vital_get_finding_context` machinery
   (reused, not duplicated).
2. Searches a configured local repository root
   (`local.repository_path` in `.vital.yml`) for files whose content
   matches signals extracted from the finding's evidence.
3. Returns a ranked list of candidate source files, each with a confidence
   tier and the specific signal(s) that matched — never a single "this is
   the file" answer.

This mission does **not** add any write capability, does not run any
command, does not fetch anything over the network beyond what the existing
server already does (the search is 100% local-filesystem), and does not
add framework-specific (Drupal or otherwise) parsing.

---

## Functional Requirements

| ID | Requirement | Status |
|---|---|---|
| FR-001 | A new `vital_find_probable_sources` MCP tool accepts `{ finding_id: string, week?: string }` and returns a ranked list of candidate source files with confidence tiers and matched signals. It is registered alongside the three existing tools in `mcp/server.js`, following the same `{ name, description, inputSchema, handler(args, ctx) }` shape as `mcp/tools/get-finding-context.js`. | Proposed |
| FR-002 | The tool is gated behind a new `.vital.yml` field, `permissions.read_repository` (boolean, default `false`). When absent or `false`, calling the tool returns a clear, structured refusal (not a thrown error that looks like a bug) explaining the permission is disabled and how to enable it — mirroring how the server already handles a misconfigured `.vital.yml` gracefully. | Proposed |
| FR-003 | A second new `.vital.yml` field, `local.repository_path` (string, required when `permissions.read_repository` is `true`), names the root directory the tool is allowed to search. It must be an absolute path or resolved relative to the `.vital.yml` file's own location — never relative to the process's current working directory (which could differ from where `.vital.yml` lives). | Proposed |
| FR-004 | The search is strictly confined to `local.repository_path` — no path traversal outside it is possible via any tool argument or via symlink resolution (a symlink inside the repo root that resolves outside it is not followed). This mirrors `mcp/security/host-allowlist.js`'s existing pattern of a single, fixed, non-widenable boundary — implement the filesystem equivalent (`mcp/security/path-allowlist.js` or similar), not an inline check duplicated per call site. | Proposed |
| FR-005 | Candidate files are found by matching signals extracted from the finding's `xpath`/`html_snippet` evidence (already returned by `vital_get_finding_context`) against file contents: CSS class names and IDs appearing in the snippet, `data-*` attribute names/values, distinctive text fragments (a run of literal text unlikely to be boilerplate — e.g. skip common words, require a minimum length), and any script/stylesheet URL referenced in or near the snippet. No signal type requires knowledge of a specific framework or template language. | Proposed |
| FR-006 | Each candidate result includes: the file's path (relative to `local.repository_path`, never the absolute filesystem path — avoids leaking host filesystem layout beyond the configured root), a confidence tier (`high` / `medium` / `low` — defined by how many independent signal types matched, not a single opaque score), and the list of specific signals that matched in that file. | Proposed |
| FR-007 | Results are capped (a fixed limit, e.g. 20 candidates) and sorted by confidence tier then by signal count, so a large monorepo doesn't return an unbounded or unordered list. | Proposed |
| FR-008 | File content read for matching is bounded (a fixed max file size skip, and a fixed max total files scanned per call, both configurable with safe defaults) so the tool cannot be used to exhaust memory/CPU against a very large repository. | Proposed |
| FR-009 | Binary files, `node_modules/`, `.git/`, and other common non-source directories are excluded from the search by default (a small, documented default-ignore list, overridable via a `local.ignore_patterns` array in `.vital.yml`). | Proposed |
| FR-010 | `MCP.md` is updated: the tool moves from "Not yet implemented" to a documented section (config fields, the tool, its confidence-tier semantics, and the explicit statement that this is generic/framework-agnostic — Drupal-specific mapping is a separate future mission), matching the documentation depth already given to the three phase-1 tools. | Proposed |

## Non-Functional Requirements

| ID | Requirement | Status |
|---|---|---|
| NFR-001 | Read-only in every dimension: the tool never writes to, modifies, or deletes anything in the local repository — it only reads file contents and paths (same read-only posture as the phase-1 tools' read-only stance toward the remote API). | Proposed |
| NFR-002 | Confidence tiers are honestly conservative: a single weak signal (e.g. one common CSS class name shared across dozens of files) alone yields `low`, never `high`. The tool's docstring/description explicitly warns the caller (and by extension any LLM reading it) that results are probabilistic, not certain — matching issue #214's "report evidence and confidence, not pretend it has certain attribution" mandate directly in the tool's own self-description, not just in `MCP.md`. | Proposed |
| NFR-003 | No new external dependency for the core matching logic — plain Node.js `fs`/`path`/string matching, consistent with the rest of `mcp/`'s zero-framework-dependency implementation style (check `mcp/`'s existing `package.json`-equivalent dependency footprint before adding anything). | Proposed |
| NFR-004 | Remote/scan-derived text (the finding's `xpath`, `html_snippet`, rule labels) is treated as inert data when used to build search signals — never interpreted as a command, path, or code to execute (same NFR-05 requirement as the phase-1 tools, now also applied to filesystem-search-string construction, which is a new injection surface this mission introduces and must close by construction: signals are used only as literal substring/regex-escaped matches, never as shell arguments or unescaped regex). | Proposed |
| NFR-005 | `npm run test:unit` stays green; new tests use a small synthetic fixture directory under a temp path (`os.tmpdir()`), never the real repository checkout, so tests are hermetic and don't depend on `vital-core`'s own source tree shape. | Proposed |

## Constraints

| ID | Constraint | Status |
|---|---|---|
| C-001 | `permissions.read_repository` defaults to `false` — an existing `.vital.yml` from before this mission continues to work exactly as today, with the new tool refusing (FR-002) rather than the server failing to start or behaving differently by default. | Accepted |
| C-002 | Do not implement any capability beyond source-location suggestion: no reproduction, no command execution, no patch/diff generation, no upstream issue search (all remain future missions per issue #214's sequence). | Accepted |
| C-003 | Do not add Drupal-specific, or any other framework-specific, parsing (Twig template suggestions, theme registry lookups, etc.) — this mission's signals are all framework-agnostic. Framework-specific enrichment is issue #214 step 5, a separate mission, once a local Drupal dev instance is available to develop and test against. | Accepted |
| C-004 | The filesystem-boundary enforcement (FR-004) must be implemented as a single, reusable, testable module — not duplicated inline — mirroring the existing `assertAllowedUrl`/`host-allowlist.js` pattern for the network boundary. | Accepted |

## Out of Scope

- Drupal Twig-debug adapter (issue #214 step 5) — needs a local Drupal
  instance with development instrumentation enabled; a separate future
  mission once that environment exists.
- Local reproduction against a dev site (step 6).
- Dependency provenance / ownership classification (step 7).
- Upstream issue discovery (step 8).
- Any command execution, diff inspection, or patch/report preparation
  (step 9) — `permissions.run_commands`, `vital_run_validation`,
  `vital_show_change_context`, `vital_prepare_remediation_report` all stay
  unimplemented.
- WebMCP (step 10 — already shipped separately as mission
  `webmcp-bridge-01KX9BA6`, out of numerical order, per issue #214's own
  note that WebMCP is architecturally independent).
- An optional SQLite cache (step 2) for the local search results —
  out of scope; this mission's search runs fresh on every call.
- Semantic/AI-assisted matching (e.g. embedding-based similarity) — this
  mission uses literal/structural signal matching only.

---

## User Scenarios & Testing

### Scenario 1: Repository access enabled, a finding maps clearly
A developer has `.vital.yml` configured with `permissions.read_repository:
true` and `local.repository_path` pointing at their checkout. They ask
their MCP-compatible coding agent to find probable sources for a specific
finding whose HTML snippet contains a distinctive CSS class used in only
one template file in the checkout.
**Acceptance**: `vital_find_probable_sources` returns that file as the
top (or only) candidate with a `high` confidence tier and the matched
class name listed as the signal.

### Scenario 2: Repository access disabled (default)
A developer has not set `permissions.read_repository` in their
`.vital.yml` (or has it explicitly `false`).
**Acceptance**: Calling `vital_find_probable_sources` returns a structured
refusal explaining the permission is off and how to enable it — no
filesystem access is attempted, no error resembling a crash.

### Scenario 3: Weak, ambiguous signal
A finding's evidence contains only a very common CSS class (e.g. `class`)
that appears in dozens of files across the checkout.
**Acceptance**: All matching files are returned but capped at the result
limit (FR-007), each with a `low` confidence tier — the tool does not
claim any of them is "the" answer.

### Scenario 4: Path traversal attempt
A finding's evidence (hypothetically manipulated/adversarial — same
adversarial-input posture the phase-1 tools already test for) contains a
value that could be interpreted as a path traversal sequence if naively
concatenated into a file path.
**Acceptance**: No file outside `local.repository_path` is ever read; the
adversarial value is treated as inert search-string data (NFR-004), not as
a path component.

### Scenario 5: Large repository, bounded scan
A developer points `local.repository_path` at a large monorepo.
**Acceptance**: The tool completes within its configured file-count/size
bounds (FR-008) rather than scanning unboundedly; `node_modules/`, `.git/`,
and binary files are skipped by default (FR-009).

---

## Success Criteria

1. ✓ `vital_find_probable_sources` is implemented, registered, and callable
   from an MCP client, following the existing three tools' structural
   pattern exactly.
2. ✓ The tool is off by default (`permissions.read_repository: false`) and
   an existing `.vital.yml` from before this mission needs zero changes to
   keep working exactly as today.
3. ✓ No signal-matching logic can read outside the configured
   `local.repository_path`, verified by a dedicated adversarial test
   (Scenario 4).
4. ✓ Confidence tiers are demonstrably conservative — a synthetic test with
   a deliberately weak/common signal never yields `high`.
5. ✓ `npm run test:unit` passes with new tests; no regressions to the
   phase-1 tools' existing tests.
6. ✓ `MCP.md` documents the new tool, its config fields, and confidence-tier
   semantics, and explicitly states the framework-agnostic scope boundary.

## Key Entities

| Entity | Description |
|---|---|
| `vital_find_probable_sources` | New MCP tool: finding evidence → ranked list of candidate local source files with confidence + matched signals. |
| `permissions.read_repository` | New `.vital.yml` boolean, default `false` — gates all local-filesystem access. |
| `local.repository_path` | New `.vital.yml` string — the single allowed search root, required only when the above permission is `true`. |
| `local.ignore_patterns` | New optional `.vital.yml` array — additional directories/globs to exclude from search, layered on top of a small built-in default-ignore list. |
| Confidence tier | `high` / `medium` / `low`, derived from the number of independent signal types matched — never a bare numeric score presented as false precision. |

## Assumptions

- The candidate signals enumerated in FR-005 (CSS classes/IDs, `data-*`
  attributes, distinctive text, script/stylesheet URLs) are sufficient for
  a first, generic pass — issue #214's own list of possible signals
  (source maps, Git blame, component names, DOM ancestry, route/URL path)
  is broader; this mission implements the subset that requires no
  framework knowledge and no additional tooling (e.g. source-map parsing
  is deferred — it would need a build-artifact convention this mission
  doesn't assume exists). Route/URL-path-based directory heuristics may be
  added if `plan.md`'s design finds them cheap to implement generically;
  otherwise deferred alongside the framework-specific signals.
- "Local repository" means a working-tree checkout on the same machine
  running the MCP server — no support for a remote/SSH filesystem in this
  mission.
- The confidence-tier thresholds (how many signal types constitute
  `high` vs `medium` vs `low`) are a `plan.md` design decision informed by
  manual testing against a real checkout during implementation, not fixed
  in this spec — the *qualitative* requirement (NFR-002's conservatism) is
  binding; the exact thresholds are not.
