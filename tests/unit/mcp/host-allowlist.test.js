import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAllowedUrl } from '../../../mcp/security/host-allowlist.js';

test('host-allowlist: allows a URL matching the configured origin', () => {
  const parsed = assertAllowedUrl('https://example.org/api/v1/index.json', 'https://example.org');
  assert.equal(parsed.pathname, '/api/v1/index.json');
});

test('host-allowlist: blocks a different host', () => {
  assert.throws(
    () => assertAllowedUrl('https://evil.example/index.json', 'https://example.org'),
    /Network access blocked/,
  );
});

test('host-allowlist: blocks a different scheme on the same hostname', () => {
  assert.throws(
    () => assertAllowedUrl('http://example.org/index.json', 'https://example.org'),
    /Network access blocked/,
  );
});

test('host-allowlist: blocks a different port on the same hostname', () => {
  assert.throws(
    () => assertAllowedUrl('https://example.org:8443/index.json', 'https://example.org'),
    /Network access blocked/,
  );
});

test('host-allowlist: rejects an unparseable URL with a clear error', () => {
  assert.throws(() => assertAllowedUrl('not a url', 'https://example.org'), /not a valid URL/);
});

test('host-allowlist: accepts an already-parsed URL object', () => {
  const parsed = assertAllowedUrl(new URL('https://example.org/x'), 'https://example.org');
  assert.equal(parsed.href, 'https://example.org/x');
});
