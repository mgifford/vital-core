# Vital MCP Server

A local, read-only [Model Context Protocol](https://modelcontextprotocol.io/)
server that connects an MCP-compatible coding client to a Vital Core
instance's published [`/api/v1/`](API.md) JSON API.

This is phase 1 of the local MCP server proposed in
[issue #214](https://github.com/mgifford/vital-core/issues/214): remote
findings retrieval only. It does **not** read your local repository,
reproduce findings against a dev site, run commands, or write anything —
see [Not yet implemented](#not-yet-implemented).

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
        +-- mcp/security/  single-origin allowlist
        +-- mcp/tools/     the 3 read-only tools below
        |
        v
MCP-compatible coding client (Claude Code, GitHub Copilot, ...)
```

Transport and Vital-domain logic are kept separate (`server.js` only wires
things together), so later missions can add local-repository tools without
touching how the server boots.

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
proposed in issue #214 (`local.*`, `commands.*`, `permissions.*`,
`mapping.*`). Those keys do nothing yet; later missions will extend this
same file rather than introduce a second config format.

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

All three tools are read-only. None of them touch the local filesystem
(beyond the server's own process) or execute anything.

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

## Security boundaries

- **Single host.** The origin is derived from `instance.api` at startup and
  frozen; every fetch is checked against it before it happens
  (`mcp/security/host-allowlist.js`). No tool argument can widen it.
- **No filesystem access** beyond the server's own package directory.
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

## Not yet implemented

Deferred to later missions, in the order issue #214 recommends:

- SQLite cache (`vital-mcp cache rebuild/clear/status`).
- Local repository source mapping (`vital_find_probable_sources`, `local.*`
  / `mapping.*` config, `permissions.read_repository`).
- Drupal development-evidence adapter (Twig debug parsing).
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
4. From here, a developer investigates the source manually — local source
   mapping is not yet automated (see above).
