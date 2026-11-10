import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStorage, resolveStorageLimits } from '../../src/lib/storage-guard.js';

test('storage warnings preserve the existing thresholds and never delete', () => {
  const limits = resolveStorageLimits();
  const current = evaluateStorage({ codeKb: 6297, dataKb: 1435663, previousKb: 1300000, sevenDayKb: 1100000, limits });
  assert.equal(current.skip, false);
  assert.ok(current.warnings.some((warning) => warning.title === 'Repo over size warning'));
  assert.ok(!current.warnings.some((warning) => warning.title === 'Repo over critical size ceiling'));
  assert.ok(current.warnings.some((warning) => warning.title === 'Repo growing fast'));
  assert.ok(current.warnings.some((warning) => warning.title === 'Repo growing steadily'));

  const critical = evaluateStorage({ codeKb: 200000, dataKb: 1700000, limits });
  assert.ok(critical.warnings.some((warning) => warning.title === 'Repo over critical size ceiling'));
  assert.ok(critical.warnings.some((warning) => warning.title === 'Code repo over size ceiling'));
  assert.equal(evaluateStorage({ codeKb: 1000, dataKb: 0, limits }).skip, true);
});

test('storage limits are validated and cannot silently invert the thresholds', () => {
  assert.throws(() => resolveStorageLimits({ data_warning_mb: 1600, data_critical_mb: 1300 }), /smaller/);
  assert.throws(() => resolveStorageLimits({ unknown: 1 }), /Unknown storage key/);
  assert.throws(() => resolveStorageLimits({ data_warning_mb: 0 }), /positive number/);
  assert.equal(resolveStorageLimits({ data_warning_mb: 1200 }).data_warning_mb, 1200);
});
