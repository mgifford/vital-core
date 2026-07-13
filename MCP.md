# Vital MCP Server

A local, read-only [Model Context Protocol](https://modelcontextprotocol.io/)
server that connects an MCP-compatible coding client to a Vital Core
instance's published [`/api/v1/`](API.md) JSON API.

This covers phases 1 and 2 of the local MCP server proposed in
[issue #214](https://github.com/mgifford/vital-core/issues/214): remote
findings retrieval, plus opt-in local repository source mapping. It does
**not** reproduce findings against a dev site, run commands, or write
anything — see [Not yet implemented](#not-yet-implemented).

## Architecture

```
Vital Core instance (/api/v1/)
        |
        | HTTPS, single allowed host, timeout + size-bounded
        v
mcp/server.js  (stdio transport)
        |
        +-- mcp/config/    .vital.yml load + validation
        +-- mcp/api/       host-restricted, cached API client
        +-- mcp/security/  single-origin allowlist + filesystem boundary
        +-- mcp/local/     bounded local-repository search (opt-in)
        +-- mcp/tools/     the 4 read-only tools below
        |
        v
MCP-compatible coding client (Claude Code, GitHub Copilot, ...)
```

Transport and Vital-domain logic are kept separate (`server.js` only wires
things together), so later missions can extend local-repository tooling
without touching how the server boots.

## Installation

From a checkout of this repository:

```bash
npm install
```

Run directly:

```bash
node mcp/server.js
```

Or via the `vital-mcp` bin entry this package defines:

```bash
npx vital-mcp
```

The server speaks MCP over stdio and opens no network port of its own. It
only makes outbound HTTPS requests to the single host configured in
`.vital.yml`.

## Configuration: `.vital.yml`

Create a `.vital.yml` in your project root (or point `VITAL_MCP_CONFIG` at
one elsewhere):

```yaml
version: 1
instance:
  api: https://mgifford.github.io/vital-core/api/v1/
  domain: www.cms.gov
```

- `version` — must be `1`.
- `instance.api` — the base URL of a Vital Core `/api/v1/` instance. Must be
  `https://`. This is also the **only** host the server will ever contact.
- `instance.domain` — the domain key to query, matching a `key` in that
  instance's `config/targets.yml`.

Values support `${ENV_VAR}` substitution (e.g.
`domain: ${VITAL_MCP_DOMAIN}`). An unresolved reference is left as literal
text and reported as a warning from `vital_get_project_context`, not thrown
— nothing under an env var is ever echoed back through a tool.

This config file is intentionally a subset of the fuller `.vital.yml` shape
proposed in issue #214 (`commands.*`, `mapping.*`). Those keys do nothing
yet; later missions will extend this same file rather than introduce a
second config format.

### Local repository search (optional)

Off by default. An existing `.vital.yml` from before this feature needs
zero changes to keep working exactly as before.

```yaml
version: 1
instance:
  api: https://mgifford.github.io/vital-core/api/v1/
  domain: www.cms.gov
permissions:
  read_repository: true
local:
  repository_path: ./src
  ignore_patterns: [fixtures, storybook-static]
```

- `permissions.read_repository` — boolean, default `false`. Must be `true`
  before `vital_find_probable_sources` will touch the filesystem at all.
- `local.repository_path` — required when the permission above is `true`.
  The single directory the server is allowed to search. Resolved relative
  to **`.vital.yml`'s own directory**, not the process's current working
  directory.
- `local.ignore_patterns` — optional array of extra directory names to
  skip, added on top of the built-in defaults (`node_modules`, `.git`,
  `.svn`, `vendor`, `dist`, `build`) — it only adds to that list, never
  replaces it.

## Registering with an MCP client

Example for a client that reads a JSON MCP config (adjust to your client's
format):

```json
{
  "mcpServers": {
    "vital": {
      "command": "node",
      "args": ["mcp/server.js"],
      "env": {
        "VITAL_MCP_CONFIG": "/path/to/your/.vital.yml"
      }
    }
  }
}
```

## Tools

All four tools are read-only. Only `vital_find_probable_sources` touches
the local filesystem, and only when explicitly enabled — see below.

### `vital_get_project_context`

No arguments. Returns the resolved instance URL, domain, and any config
warnings. Never returns secrets or raw environment variables.

### `vital_list_findings`

Lists findings for the configured domain from the latest (or a specified)
week's `findings.json`, filtered and sorted by pages affected.

| Argument | Type | Description |
|---|---|---|
| `severity` | `string[]` | Restrict to `Critical`/`Serious`/`Moderate`/`Minor`. |
| `min_pages_affected` | `integer` | Only findings affecting at least this many pages. |
| `rule_id` | `string` | Restrict to one engine rule id. |
| `week` | `string` | ISO week (`YYYY-Www`). Defaults to the domain's latest week. |
| `limit` | `integer` | Max results (default 50, capped at 200). |

The response reports `total_matched`, `returned`, and `truncated` so a
client can tell when the list was capped.

### `vital_get_finding_context`

Returns one finding's record verbatim from the findings feed.

| Argument | Type | Description |
|---|---|---|
| `finding_id` | `string` (required) | A `VS-<hash>` id, as returned by `vital_list_findings`. |
| `week` | `string` | Defaults to the domain's latest week. |

A missing id returns `{ found: false, message }` rather than throwing.

### `vital_find_probable_sources`

Searches your local repository checkout for files that probably produced a
finding's rendered output, based on signals (CSS classes/IDs, `data-*`
attributes, distinctive text, asset URLs) extracted from that finding's
evidence. **This is framework-agnostic string/attribute matching only** —
it does not parse Twig debug output, walk a CMS theme registry, read
source maps, inspect Git blame, or use DOM ancestry or route/URL-path
heuristics. Drupal- or CMS-specific mapping is out of scope for this tool
and is deferred to a separate future mission (issue #214 step 5).

Disabled unless `permissions.read_repository: true` and
`local.repository_path` are set in `.vital.yml` (see
[Local repository search](#local-repository-search-optional) above); with
the permission off, the tool returns a `permission_disabled` refusal and
never touches the filesystem.

| Argument | Type | Description |
|---|---|---|
| `finding_id` | `string` (required) | A `VS-<hash>` id, as returned by `vital_list_findings`. |
| `week` | `string` | Defaults to the domain's latest week. |

The response includes a `candidates` array, each with a relative `path`
(never an absolute filesystem path), a `confidence` tier, and the specific
`matched_signals`. **Results are evidence, not certain attribution** —
treat them the way you'd treat a colleague's guess, not a compiler error:

- `high` — 3 or more distinct signal types matched in the same file.
- `medium` — exactly 2 distinct signal types matched.
- `low` — only 1 signal type matched. This is the conservative,
  expected outcome for a common/generic signal (e.g. a widely reused CSS
  class): the tool deliberately never claims high confidence just because
  many files match the same single signal.

Multiple candidates, or an all-`low` result set, are normal — verify
manually before assuming a candidate is correct. Results are capped
(20 by default) and bounded by file count/size (5,000 files / 1 MB per
file by default) so a large monorepo can't cause an unbounded scan;
`node_modules/`, `.git/`, and common binary/asset extensions are skipped
by default regardless of `local.ignore_patterns`.

## Security boundaries

- **Single host.** The origin is derived from `instance.api` at startup and
  frozen; every fetch is checked against it before it happens
  (`mcp/security/host-allowlist.js`). No tool argument can widen it.
- **No filesystem access by default.** `vital_find_probable_sources` is the
  only tool that reads local files, and only when
  `permissions.read_repository: true` is explicitly set. Every file it
  opens is bounded to `local.repository_path` — checked with
  `mcp/security/path-allowlist.js`'s symlink-safe realpath comparison
  before each read, so a symlink inside the configured root that resolves
  outside it is blocked, not silently followed.
- **No process execution** of any kind — there is no command-running tool in
  this phase.
- **Bounded requests.** Every fetch has a timeout and a response-size cap,
  enforced while streaming (not after buffering an oversized body).
- **Static tool surface.** Tool names, descriptions, and schemas are fixed
  in code and never built from remote content.
- **Inert remote data.** Finding text (rule labels, descriptions) is
  returned as opaque data in tool responses; it is never interpreted,
  evaluated, or used to change server behavior — including text engineered
  to look like an instruction.
- **Inert search signals.** Values extracted from finding evidence are only
  ever used as literal (regex-escaped) substring matches against local file
  content — never as a path component, shell argument, or unescaped regex.
  A finding engineered to look like a path-traversal sequence is treated as
  ordinary search text, not as a filesystem path.

## Not yet implemented

Deferred to later missions, in the order issue #214 recommends:

- SQLite cache (`vital-mcp cache rebuild/clear/status`).
- Drupal development-evidence adapter (Twig debug parsing, theme registry).
- Local reproduction against a dev site (`vital_reproduce_finding`).
- Dependency provenance / ownership classification.
- Upstream issue discovery.
- Any command execution, diff inspection, or patch/report preparation
  (`commands.*`, `permissions.run_commands`, `vital_run_validation`,
  `vital_show_change_context`, `vital_prepare_remediation_report`).
- WebMCP.

If you need any of the above today, the tools don't exist — this server
will not attempt to guess at local source locations or run anything on your
behalf.

## Example session

```
$ VITAL_MCP_CONFIG=.vital.yml node mcp/server.js
```

From a connected coding client:

1. Call `vital_get_project_context` to confirm the configured instance/domain.
2. Call `vital_list_findings` with `{ "severity": ["Critical", "Serious"] }`
   to get the highest-impact open findings, sorted by pages affected.
3. Pick a `finding_id` from the result and call `vital_get_finding_context`
   to see its full evidence record (rule, WCAG mapping, trend, first/last
   seen).
4. If `permissions.read_repository` is enabled, call
   `vital_find_probable_sources` with that same `finding_id` to get ranked
   local-file candidates — then verify manually, since results are
   evidence, not certain attribution.
