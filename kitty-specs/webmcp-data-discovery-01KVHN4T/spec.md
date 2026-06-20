# Spec: WebMCP data discovery + MCP server

**Status**: Draft

## Goal

Make vital-core's weekly scan data discoverable and queryable by AI agents
in two layers:

1. **`webmcp.json`** — a static machine-readable discovery file published
   alongside the reports at the GitHub Pages root, so AI agents and assistants
   can find what data is available without being told in advance. The
   Lighthouse agentic-browsing score already checks whether *scanned sites*
   have this; vital-core's own published site should too.

2. **MCP server** — a Node.js server implementing the Model Context Protocol
   so Claude and other MCP-compatible assistants can query the scan data
   directly with structured tools: "what are the top a11y issues on cms.gov
   this week?", "compare service-worker adoption across domains", "show me
   the ACR for healthcare.gov 2026-W25".

The JSON exports already produced by `aggregate.js`
(`_lighthouse.json`, `summary.json`, `acr.yaml`) are shaped for machine
consumption. This mission adds the discovery layer on top.

## Acceptance criteria

### WP01 — `webmcp.json` at the published site root

- [ ] `src/aggregate.js` writes `docs/webmcp.json` at the end of every
      aggregate run, listing all active domains and, for each, the latest
      week's data file URLs (summary JSON, Lighthouse JSON, ACR zip).
- [ ] The file has a stable top-level shape:
      `{ version, name, description, generated_at, base_url, domains[] }`.
      Each domain entry: `{ domain, latest_week, resources[] }` where each
      resource has `{ type, label, url }`.
- [ ] `webmcp.json` is committed and pushed as part of the normal
      `report.yml` GitHub Actions run (no separate workflow needed — it is
      part of `docs/` output).
- [ ] The file is referenced in `docs/index.html` with a
      `<link rel="alternate" type="application/json" href="/vital-core/webmcp.json">`
      tag so crawlers and the Lighthouse agentic check can find it.
- [ ] Unit test: `buildWebMcpDoc(domains, weeks, baseUrl)` returns the
      expected shape with correct resource URLs.

### WP02 — MCP server

- [ ] `src/mcp.js` — a standalone Node.js MCP server (stdio transport)
      using the `@modelcontextprotocol/sdk` package.
- [ ] Tools exposed:
  - `list_domains` — returns the list of tracked domains with their latest
    week and page count.
  - `list_weeks(domain)` — returns available week slugs for a domain,
    newest first.
  - `get_summary(domain, week)` — returns the full `summary.json` for that
    domain/week (top-level fields: pagesScanned, axe findings, alfa
    findings, lighthouse medians, standards check pass rates).
  - `get_findings(domain, week)` — returns the top accessibility findings
    (axe + alfa rules, sorted by pages affected × severity), shaped for
    human-readable AI output.
  - `get_acr(domain, week)` — returns the OpenACR data: per-SC adherence
    levels, engines that tested each criterion, example failure URLs.
  - `get_pwa_signals(domain, week)` — returns the PWA / offline readiness
    checks from the standards engine (service-worker, manifest, HTTPS, etc).
  - `compare_weeks(domain, week_a, week_b)` — diffs two weeks: new
    findings, resolved findings, score changes.
- [ ] Server reads from the local `data/` directory (not from GitHub Pages)
      so it works in development and CI without a network round-trip.
- [ ] `package.json` gets a `"mcp": "node src/mcp.js"` script and the
      `@modelcontextprotocol/sdk` dependency.
- [ ] `README.md` (or a new `docs/mcp.md`) documents how to connect the
      server to Claude Desktop / Claude Code: the JSON snippet for
      `claude_desktop_config.json` and the `claude mcp add` invocation.
- [ ] All existing unit tests still pass; at least one unit test covers the
      `get_findings` shape (verifies sort order and field presence without
      filesystem I/O — use a synthetic summary fixture).

## Out of scope

- Hosting the MCP server publicly (that requires auth; this is local-only).
- A `webmcp.json` schema beyond the fields listed above — keep it minimal
  and evolvable.
- Streaming responses (the datasets are small enough for single-call returns).
- Write tools (the MCP server is read-only — scan data is append-only).
- Changing the data/ storage format — MCP reads what aggregate already writes.
