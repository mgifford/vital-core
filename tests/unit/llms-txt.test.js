import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildLlmsTxt } from '../../src/lib/llms-txt.js';

const CONFIG = { reportBaseUrl: 'https://mgifford.github.io/vital-core' };

const INDEX_ENTRIES = [
  { key: 'www.cms.gov', snapshot_url: '/api/v1/www.cms.gov/snapshot.json' },
  { key: 'nih.gov', snapshot_url: '/api/v1/nih.gov/snapshot.json' },
];

describe('buildLlmsTxt', () => {
  test('starts with an H1 title and a blockquote summary (llmstxt.org convention)', () => {
    const text = buildLlmsTxt(CONFIG, []);
    const lines = text.split('\n');
    assert.equal(lines[0], '# VITAL Scans');
    assert.ok(lines[2].startsWith('> '), 'third line should be a blockquote summary');
  });

  test('links the API index and every domain snapshot as absolute URLs', () => {
    const text = buildLlmsTxt(CONFIG, INDEX_ENTRIES);
    assert.match(text, /\[JSON API index\]\(https:\/\/mgifford\.github\.io\/vital-core\/api\/v1\/index\.json\)/);
    assert.match(text, /\[www\.cms\.gov snapshot\]\(https:\/\/mgifford\.github\.io\/vital-core\/api\/v1\/www\.cms\.gov\/snapshot\.json\)/);
    assert.match(text, /\[nih\.gov snapshot\]\(https:\/\/mgifford\.github\.io\/vital-core\/api\/v1\/nih\.gov\/snapshot\.json\)/);
  });

  test('links MCP.md and API.md at the GitHub repo (not the Pages host, which does not serve them)', () => {
    const text = buildLlmsTxt(CONFIG, []);
    assert.match(text, /\[MCP\.md\]\(https:\/\/github\.com\/mgifford\/vital-core\/blob\/main\/MCP\.md\)/);
    assert.match(text, /\[API\.md\]\(https:\/\/github\.com\/mgifford\/vital-core\/blob\/main\/API\.md\)/);
  });

  test('never emits a relative link — every URL is absolute', () => {
    const text = buildLlmsTxt(CONFIG, INDEX_ENTRIES);
    const linkTargets = [...text.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
    assert.ok(linkTargets.length > 0);
    for (const url of linkTargets) {
      assert.match(url, /^https:\/\//, `expected an absolute URL, got: ${url}`);
    }
  });

  test('falls back to root-relative API links when reportBaseUrl is unset', () => {
    const text = buildLlmsTxt({ reportBaseUrl: '' }, []);
    assert.match(text, /\[JSON API index\]\(\/api\/v1\/index\.json\)/);
  });

  test('handles an empty domain list without throwing', () => {
    assert.doesNotThrow(() => buildLlmsTxt(CONFIG, []));
  });
});
