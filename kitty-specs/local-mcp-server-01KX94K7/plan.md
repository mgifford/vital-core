# Implementation Plan: Local Vital MCP Server — Read-Only Findings Retrieval (Phase 1)

**Branch**: `claude/vital-core-issue-214-spec-m237h3` | **Spec**: [spec.md](spec.md)
**Mission**: `local-mcp-server-01KX94K7`

## Summary

Stand up a new, self-contained `mcp/` package that runs a stdio-transport MCP
server. It loads and validates a repository-owned `.vital.yml`, fetches from a
single configured `/api/v1/` host, and exposes exactly three read-only tools:
`vital_get_project_context`, `vital_list_findings`, `vital_get_finding_context`.
No local filesystem access beyond the package's own directory, no process
execution, no network access outside the configured host. This is step 3 of
issue #214's 10-step sequence; everything after step 3 (source mapping,
reproduction, command execution, upstream discovery, WebMCP) is out of scope
and left to later missions, per spec.md's Out of Scope section.

## Technical Context

- **Language**: Node.js ESM ≥20, no build step, no bundler — consistent with
  the rest of the repo.
- **Primary dependency (new)**: `@modelcontextprotocol/sdk` (the official MCP
  server SDK) for the stdio transport and tool registration. Exact version
  pinned in `package.json` when WP01 lands; no other new runtime dependency.
- **Testing**: Node built-in test runner (`npm run test:unit`), fixtures
  under `tests/fixtures/mcp/` mirroring the shipped `/api/v1/` JSON shape
  (reuse `src/api/schema/*.schema.json` as the contract, not internal report
  objects — C-03).
- **Storage**: none required for phase 1. An in-memory `Map` per server
  process is sufficient for response caching; no SQLite (deferred to issue
  #214 step 2).
- **Target Platform**: local developer machine, invoked by an MCP-compatible
  coding client over stdio. No network port opened (C-02).
- **Project Type**: single project, new `mcp/` module inside the existing repo.
- **Performance Goals**: not perf-sensitive; bound is correctness + the
  timeout/size caps in NFR-03, not throughput.
- **Constraints**: no filesystem access outside the package directory, no
  process execution, single-host network access only (see Design).
- **Scale/Scope**: one server process per developer session, one configured
  Vital Core instance/domain per `.vital.yml`.

## Charter Check

*GATE: checked before design, re-checked after design below.*

- **Sustainability gate**: N/A to `docs/` output — this ships a local CLI
  process, not report HTML/JS/CSS. No client-side bytes added. PASS (see
  spec.md's Sustainability Acceptance Criterion).
- **Security rules**: no VA-domain interaction, no `.env`/`HF_TOKEN` handling,
  no `data/`/`state/` access. The mission's own constraints (C-01/C-02, NFR-01
  through NFR-05) are stricter than the repo's baseline security rules and
  are enforced by tests, not just review. PASS.

*Re-check after Design section below: unchanged — no new charter risk introduced
by the concrete module layout.*

## Project Structure

### Documentation (this feature)

```
kitty-specs/local-mcp-server-01KX94K7/
├── spec.md
├── plan.md              # this file
└── tasks.md             # produced by the tasks phase, not this plan
```

No `research.md` / `data-model.md` / `quickstart.md` / `contracts/` — this
mission's design is small enough to live entirely in this plan; `MCP.md` in
the repo root is the user-facing quickstart (see Design).

### Source Code (repository root)

```
mcp/
├── server.js                    # stdio transport entry point, tool registration
├── config/
│   └── vital-config.js          # .vital.yml load + validate + env substitution
├── api/
│   └── vital-api-client.js      # host-restricted fetch, timeout + size bound, cache
├── tools/
│   ├── get-project-context.js
│   ├── list-findings.js
│   └── get-finding-context.js
└── security/
    └── host-allowlist.js        # single-host enforcement shared by api client

tests/
├── unit/
│   └── mcp/
│       ├── vital-config.test.js
│       ├── vital-api-client.test.js
│       ├── get-project-context.test.js
│       └── findings-tools.test.js
└── fixtures/
    └── mcp/                     # static JSON fixtures shaped like /api/v1/
```

**Structure Decision**: single-project layout (Option 1), scoped to a new
`mcp/` top-level directory — the boundary issue #214 itself recommends —
plus matching test/fixture directories under the repo's existing `tests/`
convention. `mapping/`, `frameworks/`, `reproduction/`, `provenance/`,
`validation/` are **not** created in this mission; later missions add them
without needing to touch `server.js`'s transport wiring (C-05).

## Design

### Config (`.vital.yml`, phase-1 subset)

```yaml
version: 1
instance:
  api: https://mgifford.github.io/vital-core/api/v1/
  domain: www.cms.gov
```

`vital-config.js`:
- Parses with the already-used `yaml` dependency (no new YAML parser).
- Validates required fields (`version === 1`, `instance.api` is an `https://`
  URL, `instance.domain` is a non-empty string) and rejects anything else
  with a specific error (FR-02).
- Supports `${ENV_VAR}` substitution in string values; substituted values are
  never echoed back by any tool (FR-03) — secrets stay out of tool output.
- Resolved config exposes only `{ apiBase, domain, warnings }` to the rest of
  the server — nothing else is threaded through, so there's no accidental
  path for a secret to leak into a tool response.

### API client (`vital-api-client.js`)

- Single allowed host: derived from `instance.api`'s origin at startup and
  frozen. `host-allowlist.js` exposes `assertAllowedUrl(url)`, called before
  every fetch; anything outside the configured origin throws (FR-08, NFR-01).
- `fetch` wrapped with an `AbortController` timeout (default 10s, hardcoded
  constant for phase 1, documented in `MCP.md`) and a response-size cap
  (reject/truncate above e.g. 5 MB) per NFR-03. Truncated responses set
  `truncated: true` rather than silently dropping data.
- In-memory cache keyed by URL for the lifetime of the server process — no
  disk writes (the SQLite cache is step 2, not this mission).
- Reads only the three documented endpoints: `index.json`, `snapshot.json`,
  `<week>/findings.json` (FR-07). No other path is ever requested.

### Tools

- `vital_get_project_context` — returns `{ apiBase, domain, warnings }` from
  the resolved config. Static schema, no arguments (FR-04).
- `vital_list_findings` — fetches `<domain>/<week>/findings.json` (default:
  latest available week per `snapshot.json`), applies filters (`severity[]`,
  `min_pages_affected`, `rule_id`), sorts by `pages_affected` descending, caps
  the returned list size (bounded output, NFR-03) (FR-05).
- `vital_get_finding_context` — looks up one `finding_id` in the cached
  findings/snapshot data already fetched by `vital_list_findings`, returning
  the full evidence record verbatim from the API payload — no server-side
  enrichment or inference beyond what the API already provides (FR-06).

All three tool schemas and descriptions are defined as static objects in
`mcp/tools/*.js` — never built from remote content (NFR-04). Remote text
(rule descriptions, page URLs, HTML excerpts) is passed through as opaque
string data in the response payload; nothing from a fetched finding is ever
interpolated into a path, a shell argument (none exist in this mission), or a
tool definition (NFR-05).

### Server wiring (`server.js`)

Boots: load+validate config → construct API client with the single allowed
host → register the three tools with the MCP SDK's stdio transport → serve.
Any config validation failure exits with a clear message before the
transport starts (FR-02). CLI entry point added as a `bin` entry in
`package.json` (`vital-mcp`) per FR-09; `MCP.md` documents registering it
with an MCP client (e.g. Claude Code's `mcp` config) and lists, explicitly,
which of issue #214's proposed tools are *not yet* implemented.

### Testing strategy

- Unit tests per module (`tests/unit/mcp/*.test.js`), no network/filesystem
  mocking beyond small synthetic fixtures, consistent with the repo's
  existing test conventions (real module APIs, no DB/FS mocks).
- Adversarial fixtures cover: oversized API response (size cap), malformed
  JSON (parse failure surfaced as a tool error, not a crash), a finding whose
  text contains prompt-injection-style content (asserted to come back
  verbatim with no behavior change), and a config pointing at a
  non-configured host (asserted rejected before any fetch).
- A small local HTTP fixture server (Node's `http` module, no new
  dependency) stands in for a Vital Core instance in tests, serving static
  JSON fixture files shaped like the real `/api/v1/` contract.

## Work Breakdown

1. **WP01 — Config loading & validation** — `mcp/config/vital-config.js`;
   `tests/unit/mcp/vital-config.test.js`. Covers FR-02, FR-03, NFR-04
   (secret-free output).
2. **WP02 — Host-restricted, bounded API client** — `mcp/security/host-allowlist.js`,
   `mcp/api/vital-api-client.js`; `tests/unit/mcp/vital-api-client.test.js`
   (incl. oversized-response and unconfigured-host adversarial cases).
   Covers FR-07, FR-08, NFR-01, NFR-03.
3. **WP03 — `vital_get_project_context` tool** — `mcp/tools/get-project-context.js`;
   unit test. Covers FR-04.
4. **WP04 — `vital_list_findings` + `vital_get_finding_context` tools** —
   `mcp/tools/list-findings.js`, `mcp/tools/get-finding-context.js`; unit
   tests including the hostile-finding-text adversarial case. Covers FR-05,
   FR-06, NFR-05.
5. **WP05 — Server entry point, CLI, docs** — `mcp/server.js`, `package.json`
   `bin` entry, `MCP.md`. Covers FR-01, FR-09, and the Success Criteria's
   "documents what is not yet implemented" requirement.

Dependency order: WP01 and WP02 have no dependencies and can proceed in
parallel; WP03/WP04 depend on both; WP05 depends on WP01–WP04.

## Complexity Tracking

*Fill ONLY if Charter Check has violations that must be justified.*

No charter violations. The one new dependency
(`@modelcontextprotocol/sdk`) is justified by NFR-07 — hand-rolling an MCP
stdio protocol implementation would duplicate the official SDK for no
benefit and risks protocol-compliance bugs the SDK already handles.
