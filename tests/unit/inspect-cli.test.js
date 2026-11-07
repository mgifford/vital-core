import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const CLI = path.join(ROOT, 'scripts', 'inspect.js');

test('the local inspector dry-run builds a CSS or XPath payload', () => {
  const css = JSON.parse(execFileSync(process.execPath, [CLI, '--url', 'https://example.gov/page', '--selector', '#main h2', '--dry-run'], { cwd: ROOT, encoding: 'utf8' }));
  assert.equal(css.status, 'ready');
  assert.equal(css.selector, '#main h2');
  assert.match(css.url, /#vital-inspect=/);

  const xpath = JSON.parse(execFileSync(process.execPath, [CLI, '--url', 'https://example.gov/page', '--xpath', '//main//h2', '--dry-run'], { cwd: ROOT, encoding: 'utf8' }));
  assert.equal(xpath.xpath, '//main//h2');
  assert.equal(xpath.selector, null);
  assert.match(xpath.url, /#vital-inspect=/);
});

test('the local inspector loads a finding by instance or pattern id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-inspect-cli-'));
  const bugs = path.join(dir, 'bugs.json');
  fs.writeFileSync(bugs, JSON.stringify({ reports: [{
    instance_id: 'VS-1',
    pattern_id: 'VS-p',
    url: 'https://example.gov/page',
    selector: '#named',
    element: { available: true, tag: 'button', role: null, name: 'Save', name_source: 'aria-label' },
  }] }));
  try {
    const out = JSON.parse(execFileSync(process.execPath, [CLI, '--bugs', bugs, '--id', 'VS-1', '--dry-run'], { cwd: ROOT, encoding: 'utf8' }));
    assert.equal(out.selector, '#named');
    assert.match(out.url, /#vital-inspect=/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the local inspector refuses an incomplete target', () => {
  const result = spawnSync(process.execPath, [CLI, '--url', 'https://example.gov/page'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /selector or --xpath/);
});
