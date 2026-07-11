import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProjectContextTool } from '../../../mcp/tools/get-project-context.js';

test('vital_get_project_context: has a static, argument-free schema', () => {
  assert.equal(getProjectContextTool.name, 'vital_get_project_context');
  assert.deepEqual(getProjectContextTool.inputSchema.properties, {});
  assert.equal(getProjectContextTool.inputSchema.additionalProperties, false);
});

test('vital_get_project_context: returns exactly the resolved config fields', async () => {
  const ctx = {
    config: {
      apiBase: 'https://example.org/api/v1/',
      domain: 'www.example.gov',
      warnings: [],
    },
  };
  const result = await getProjectContextTool.handler({}, ctx);
  assert.deepEqual(result, {
    apiBase: 'https://example.org/api/v1/',
    domain: 'www.example.gov',
    warnings: [],
  });
});

test('vital_get_project_context: never leaks fields beyond apiBase/domain/warnings', async () => {
  const ctx = {
    config: {
      apiBase: 'https://example.org/api/v1/',
      domain: 'www.example.gov',
      warnings: [],
      // Simulates an accidental extra field on the resolved config object —
      // the tool must not pass it through.
      secretToken: 'super-secret-token',
    },
  };
  const result = await getProjectContextTool.handler({}, ctx);
  assert.equal(Object.keys(result).sort().join(','), 'apiBase,domain,warnings');
  assert.equal(JSON.stringify(result).includes('super-secret-token'), false);
});
