import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCoverage } from '../../src/lib/coverage.js';

test('coverage distinguishes fetched, audited, attempted, blocked and skipped pages', () => {
  const summary = {
    pagesScanned: 100,
    pagesAudited: 80,
    pagesAttempted: 110,
    pagesSucceeded: 80,
    coverage: { axe: 80, alfa: 40 },
    access: { level: 'partial', firewall: { pages: 5 }, robots: { skipped: 10 } },
  };
  const coverage = summarizeCoverage(summary, { pagesAudited: 50 }, { totalKnownPages: 500 });
  assert.equal(coverage.pages_scanned, 100);
  assert.equal(coverage.pages_audited, 80);
  assert.equal(coverage.pages_blocked, 5);
  assert.equal(coverage.robots_skipped, 10);
  assert.equal(coverage.pages_skipped, 30);
  assert.equal(coverage.known_urls_estimate, 500);
  assert.equal(coverage.engines.find((e) => e.engine === 'alfa').share, 40);
  assert.equal(coverage.audited_delta, 30);
  assert.equal(coverage.coverage_changed, true);
  assert.ok(coverage.notes.some((note) => /coverage is incomplete/.test(note)));
  assert.ok(coverage.notes.some((note) => /reflect coverage/.test(note)));
});

test('coverage does not invent a site total or a clean result when blocked', () => {
  const coverage = summarizeCoverage({
    pagesScanned: 10,
    pagesAudited: 0,
    coverage: {},
    access: { level: 'blocked', firewall: { pages: 10 }, robots: { skipped: 0 } },
  });
  assert.equal(coverage.known_urls_estimate, null);
  assert.match(coverage.known_urls_note, /unknown/i);
  assert.ok(coverage.notes.some((note) => /not a clean result/.test(note)));
  assert.equal(coverage.coverage_changed, false);
  assert.deepEqual(coverage.engines, []);
});
