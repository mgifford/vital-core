# Issue matrix — local-repo-source-mapping-01KXCGS8

Per FR-037 of the spec-kitty-mission-review skill Gate-4. One row per issue referenced in spec.md.

| Issue | Title | Verdict | Evidence ref |
|-------|-------|---------|--------------|
| #214 | Add a MCP server and possibly a WebMCP interface | in-mission | This mission implements step 4 of #214's own 10-step sequence (local repository source mapping). Steps 5-9 remain and require separate follow-up missions before #214 can be closed. |
| #223 | Add local MCP server for read-only Vital Core API access (phase 1) | verified-already-fixed | PR #223 (mission `local-mcp-server-01KX94K7`) already implemented and merged the local stdio MCP server (step 3 of #214) that this mission's WP01 config resolution and WP03 tool extend. This mission does not modify the existing three tools; it adds a fourth. |

Valid `Verdict` values: `fixed`, `verified-already-fixed`, `deferred-with-followup`, `in-mission` (being fixed by a later WP in this mission; must reach a terminal verdict before mission `done`).
