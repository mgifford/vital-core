import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  VitalApiClient,
  VitalApiTimeoutError,
  VitalApiResponseTooLargeError,
} from '../../../mcp/api/vital-api-client.js';

// A tiny fixture server stands in for a Vital Core instance — no mocking of
// fetch or the filesystem, per the repo's testing convention.
let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/index.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ schema_version: '1', domains: [] }));
    } else if (req.url === '/www.example.gov/snapshot.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ schema_version: '1', domain: 'www.example.gov' }));
    } else if (req.url === '/www.example.gov/2026-W20/findings.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ schema_version: '1', findings: [{ finding_id: 'VS-1' }] }));
    } else if (req.url === '/malformed.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{ not valid json');
    } else if (req.url === '/oversized.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ padding: 'x'.repeat(1000) }));
    } else if (req.url === '/slow.json') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      }, 300);
    } else if (req.url === '/missing.json') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"not found"}');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}/`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function makeClient(overrides = {}) {
  return new VitalApiClient({ apiBase: baseUrl, host: new URL(baseUrl).origin, ...overrides });
}

test('vital-api-client: fetches and parses index.json', async () => {
  const client = makeClient();
  const data = await client.getIndex();
  assert.equal(data.schema_version, '1');
});

test('vital-api-client: fetches snapshot and findings by relative path', async () => {
  const client = makeClient();
  const snapshot = await client.getSnapshot('www.example.gov');
  assert.equal(snapshot.domain, 'www.example.gov');
  const findings = await client.getFindings('www.example.gov', '2026-W20');
  assert.equal(findings.findings[0].finding_id, 'VS-1');
});

test('vital-api-client: caches repeated requests (fetchImpl called once)', async () => {
  let calls = 0;
  const realFetch = fetch;
  const client = makeClient({
    fetchImpl: (...args) => {
      calls += 1;
      return realFetch(...args);
    },
  });
  await client.getIndex();
  await client.getIndex();
  assert.equal(calls, 1);
});

test('vital-api-client: refuses to fetch a URL outside the configured host', async () => {
  const client = makeClient();
  await assert.rejects(() => client.fetchJson('https://evil.example/index.json'), /Network access blocked/);
});

test('vital-api-client: surfaces a clear error on non-2xx responses', async () => {
  const client = makeClient();
  await assert.rejects(() => client.fetchJson('missing.json'), /returned HTTP 404/);
});

test('vital-api-client: surfaces a clear error on malformed JSON', async () => {
  const client = makeClient();
  await assert.rejects(() => client.fetchJson('malformed.json'), /invalid JSON/);
});

test('vital-api-client: rejects a response over the configured size cap', async () => {
  const client = makeClient({ maxBytes: 100 });
  await assert.rejects(() => client.fetchJson('oversized.json'), VitalApiResponseTooLargeError);
});

test('vital-api-client: times out a slow response', async () => {
  const client = makeClient({ timeoutMs: 50 });
  await assert.rejects(() => client.fetchJson('slow.json'), VitalApiTimeoutError);
});
