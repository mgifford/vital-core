import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

test('legacy src/prune.js refuses to delete and points at the verified command', () => {
  const result = (() => {
    try {
      execFileSync(process.execPath, ['src/prune.js'], { cwd: REPO, encoding: 'utf8' });
      return null;
    } catch (error) {
      return error;
    }
  })();
  assert.ok(result, 'legacy prune must exit nonzero');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/prune\.js is disabled/);
  assert.match(result.stderr, /retention:prune-check/);
  assert.match(result.stderr, /retention:prune/);
});

test('the report workflow has no automatic prune step', () => {
  const workflow = fs.readFileSync(path.join(REPO, '.github/workflows/report.yml'), 'utf8');
  assert.doesNotMatch(workflow, /node src\/prune\.js/);
  assert.doesNotMatch(workflow, /name:\s*Prune old page-level detail/);
  assert.match(workflow, /No automatic prune/);
  assert.match(workflow, /retention:prune-check|retention:prune/);
});
