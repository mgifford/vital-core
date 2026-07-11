# Issue matrix — local-mcp-server-01KX94K7

Per FR-037 of the spec-kitty-mission-review skill Gate-4. One row per issue referenced in spec.md.

| Issue | Title | Verdict | Evidence ref |
|-------|-------|---------|--------------|
| #214 | Add a MCP server and possibly a WebMCP interface | deferred-with-followup | This mission implements only step 3 of the issue's own 10-step sequence (a read-only stdio MCP server backed by the public `/api/v1/` findings API — WP01-WP05, PR #223). Steps 2 and 4-10 (SQLite cache, local repository source mapping, Drupal evidence adapter, local reproduction, dependency provenance, upstream issue discovery, patch/report preparation, WebMCP) are explicitly out of scope per `spec.md`'s "Out of Scope" section and require separate follow-up missions before #214 can be closed. |
| #136 | Add a versioned JSON API for scan results | verified-already-fixed | The static `/api/v1/` JSON API this mission depends on (`docs/api/v1/index.json`, `snapshot.json`, `<week>/findings.json`, published schemas under `src/api/schema/`) was already implemented by prior missions `api-01KVGN9H` and `api-schemas-docs-redaction-01KX7DN5` (commit `03a111892` "feat(api): JSON Schemas, redaction, and docs for the static API (#136)", merged to `main` before this mission started). This mission only consumes that API via `mcp/api/vital-api-client.js`; it does not modify it. |

Valid `Verdict` values: `fixed`, `verified-already-fixed`, `deferred-with-followup`, `in-mission` (being fixed by a later WP in this mission; must reach a terminal verdict before mission `done`).
