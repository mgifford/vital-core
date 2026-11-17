import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldStopForBlocks, retryAfterMs, blockBackoffMs } from '../../src/lib/block-policy.js';

test('single blocks do not stop a run', () => {
  assert.equal(shouldStopForBlocks({ attempted: 5, blocked: 1, consecutive: 1 }).stop, false);
});
test('consecutive blocks stop a run', () => {
  const d = shouldStopForBlocks({ attempted: 5, blocked: 5, consecutive: 5 });
  assert.equal(d.stop, true);
  assert.match(d.reason, /consecutive/);
});
test('a high blocked share stops a run after enough attempts', () => {
  const d = shouldStopForBlocks({ attempted: 20, blocked: 4, consecutive: 1 });
  assert.equal(d.stop, true);
  assert.match(d.reason, /20%/);
});
test('Retry-After seconds and dates are bounded', () => {
  assert.equal(retryAfterMs('0'), 0);
  assert.ok(retryAfterMs('30') >= 30000);
  assert.ok(retryAfterMs(new Date(Date.now() + 5000).toUTCString()) > 0);
});
test('429 gets exponential backoff and 403 does not', () => {
  assert.ok(blockBackoffMs({ status: 429, consecutive: 2 }) >= 4000);
  assert.equal(blockBackoffMs({ status: 403, consecutive: 2 }), 0);
});
