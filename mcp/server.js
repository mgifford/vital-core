#!/usr/bin/env node
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadVitalConfig } from './config/vital-config.js';
import { VitalApiClient } from './api/vital-api-client.js';
import { getProjectContextTool } from './tools/get-project-context.js';
import { listFindingsTool } from './tools/list-findings.js';
import { getFindingContextTool } from './tools/get-finding-context.js';
import { findProbableSourcesTool } from './tools/find-probable-sources.js';

export const TOOLS = [getProjectContextTool, listFindingsTool, getFindingContextTool, findProbableSourcesTool];

// Loads and validates .vital.yml, then wires a bounded/host-restricted API
// client to it. Kept separate from server transport wiring so tests can
// exercise it without stdio (C-05).
export function buildContext(configPath) {
  const config = loadVitalConfig(configPath);
  const apiClient = new VitalApiClient({ apiBase: config.apiBase, host: config.host });
  return { config, apiClient };
}

export function listToolsResult(tools = TOOLS) {
  return {
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  };
}

// Never throws — an unknown tool or a handler error both become an
// isError:true tool result, matching MCP client expectations, rather than
// killing the transport.
export async function callTool(ctx, name, args, tools = TOOLS) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return { content: [{ type: 'text', text: `Error: unknown tool "${name}"` }], isError: true };
  }
  try {
    const result = await tool.handler(args ?? {}, ctx);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
}

export function createServer(ctx, tools = TOOLS) {
  const server = new Server({ name: 'vital-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => listToolsResult(tools));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callTool(ctx, request.params.name, request.params.arguments, tools));
  return server;
}

async function main() {
  const configPath = process.env.VITAL_MCP_CONFIG ?? path.resolve(process.cwd(), '.vital.yml');
  let ctx;
  try {
    ctx = buildContext(configPath);
  } catch (err) {
    console.error(`vital-mcp: failed to start — ${err.message}`);
    process.exitCode = 1;
    return;
  }
  const server = createServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
