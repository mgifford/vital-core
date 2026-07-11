// Static tool definition — name/description/schema never depend on remote
// content (spec.md NFR-04). server.js registers this with the MCP SDK and
// supplies `ctx` (resolved config + API client) at call time.
export const getProjectContextTool = {
  name: 'vital_get_project_context',
  description:
    'Return the configured Vital Core instance, domain, and any config warnings. Never returns secrets.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async handler(_args, ctx) {
    const { apiBase, domain, warnings } = ctx.config;
    return { apiBase, domain, warnings };
  },
};
