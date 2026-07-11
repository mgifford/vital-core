import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContext, createServer, listToolsResult, callTool, TOOLS } from '../../../mcp/server.js';

const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'fixtures', 'mcp', '.vital.yml',
);

test('server: exposes exactly the three phase-1 tools', () => {
  assert.deepEqual(
    TOOLS.map((t) => t.name).sort(),
    ['vital_get_finding_context', 'vital_get_project_context', 'vital_list_findings'],
  );
});

test('server: listToolsResult surfaces static name/description/inputSchema only', () => {
  const result = listToolsResult();
  assert.equal(result.tools.length, 3);
  for (const tool of result.tools) {
    assert.equal(typeof tool.name, 'string');
    assert.equal(typeof tool.description, 'string');
    assert.equal(typeof tool.inputSchema, 'object');
  }
});

test('server: buildContext loads a real .vital.yml and constructs a scoped API client', () => {
  const ctx = buildContext(FIXTURE_PATH);
  assert.equal(ctx.config.domain, 'www.cms.gov');
  assert.equal(ctx.apiClient.host, 'https://mgifford.github.io');
});

test('server: buildContext surfaces a clear error for a missing config file', () => {
  assert.throws(() => buildContext('/nonexistent/.vital.yml'), /ENOENT|no such file/);
});

test('server: callTool routes to vital_get_project_context', async () => {
  const ctx = buildContext(FIXTURE_PATH);
  const result = await callTool(ctx, 'vital_get_project_context', {});
  assert.equal(result.isError, undefined);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.domain, 'www.cms.gov');
});

test('server: callTool returns isError:true for an unknown tool name instead of throwing', async () => {
  const ctx = buildContext(FIXTURE_PATH);
  const result = await callTool(ctx, 'vital_delete_everything', {});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /unknown tool/);
});

test('server: callTool returns isError:true (not a throw) when a handler rejects', async () => {
  const ctx = buildContext(FIXTURE_PATH);
  const result = await callTool(ctx, 'vital_get_finding_context', {});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /requires a "finding_id"/);
});

test('server: createServer builds an MCP Server advertising the tools capability', () => {
  const ctx = buildContext(FIXTURE_PATH);
  const server = createServer(ctx);
  assert.equal(typeof server.connect, 'function');
});
