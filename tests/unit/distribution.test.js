import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { percentile, summarizeDistribution } from '../../src/lib/distribution.js';

describe('distribution helpers', () => {
  test('percentile handles empty and singleton inputs', () => {
    assert.equal(percentile([], 50), null);
    assert.equal(percentile([42], 10), 42);
  });

  test('percentile interpolates and rounds to one decimal place', () => {
    const values = [10, 20, 30, 40, 50];
    assert.equal(percentile(values, 10), 14);
    assert.equal(percentile(values, 25), 20);
    assert.equal(percentile(values, 50), 30);
    assert.equal(percentile(values, 90), 46);
  });

  test('summarizeDistribution returns expected spread metrics', () => {
    const s = summarizeDistribution([10, 20, 30, 40, 50]);
    assert.deepEqual(s, {
      min: 10,
      max: 50,
      p10: 14,
      p25: 20,
      p50: 30,
      p75: 40,
      p90: 46,
      range: 40,
      spreadP10toP90: 32,
      iqr: 20,
    });
  });
});
