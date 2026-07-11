# Issue matrix — webmcp-bridge-01KX9BA6

Per FR-037 of the spec-kitty-mission-review skill Gate-4. One row per issue referenced in spec.md.

| Issue | Title | Verdict | Evidence ref |
|-------|-------|---------|--------------|
| #214 | Add a MCP server and possibly a WebMCP interface | deferred-with-followup | This mission implements only step 10 of the issue's own 10-step sequence (a read-only, opt-in, browser-facing WebMCP bridge to the same evidence-only tools), pulled forward ahead of steps 2 and 4-9 at the user's request because it's architecturally independent of the still-undone local-repository work. Steps 2, 4-9 remain and require separate follow-up missions before #214 can be closed. |
| #223 | Add local MCP server for read-only Vital Core API access (phase 1) | verified-already-fixed | PR #223 (mission `local-mcp-server-01KX94K7`) already implemented and merged the local stdio MCP server (step 3 of #214) that this WebMCP mission's tool contract mirrors. This mission does not modify `mcp/`; it duplicates the tool semantics deliberately for a browser transport (spec.md C-04). |
| #136 | Add a versioned JSON API for scan results | verified-already-fixed | The static `/api/v1/` JSON API this mission's bridge script fetches from (same-origin, client-side) was already implemented by prior missions `api-01KVGN9H` and `api-schemas-docs-redaction-01KX7DN5`, merged to `main` before this mission started. This mission only reads that API; it does not modify it. |

Valid `Verdict` values: `fixed`, `verified-already-fixed`, `deferred-with-followup`, `in-mission` (being fixed by a later WP in this mission; must reach a terminal verdict before mission `done`).
