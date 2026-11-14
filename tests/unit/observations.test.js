import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  emptyObservations,
  loadObservations,
  observationSummary,
  syncObservationsFromRecords,
  syncObservationsFromState,
  withObservationFreshness,
} from '../../src/lib/observations.js';

test('the last-observation index distinguishes never scanned, success, failure and stale evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-observations-'));
  try {
    const state = {
      pages: {
        p1: { url: 'https://example.gov/new', discoveredAt: '2026-10-01T00:00:00Z', lastScannedAt: null, lastStatus: null },
        p2: { url: 'https://example.gov/ok', discoveredAt: '2026-10-01T00:00:00Z', lastScannedAt: '2026-11-01T00:00:00Z', lastScannedWeek: '2026-W44', lastStatus: 200, failCount: 0 },
        p3: { url: 'https://example.gov/blocked', discoveredAt: '2026-10-01T00:00:00Z', lastScannedAt: '2026-11-01T00:00:00Z', lastScannedWeek: '2026-W44', lastStatus: 403, failCount: 2, lastFailedWeek: '2026-W44' },
      },
    };
    const first = syncObservationsFromState('example.gov', 'example.gov', state, '2026-W44', { dataRoot: root });
    assert.equal(first.urls.p1.outcome, 'never_scanned');
    assert.equal(first.urls.p2.outcome, 'success');
    assert.equal(first.urls.p2.last_success_at, '2026-11-01T00:00:00Z');
    assert.equal(first.urls.p3.outcome, 'blocked');

    // A later failed attempt must not erase the earlier success timestamp.
    state.pages.p2.lastStatus = 500;
    state.pages.p2.lastScannedAt = '2026-11-08T00:00:00Z';
    const second = syncObservationsFromState('example.gov', 'example.gov', state, '2026-W45', { dataRoot: root });
    assert.equal(second.urls.p2.outcome, 'failed');
    assert.equal(second.urls.p2.last_success_at, '2026-11-01T00:00:00Z');

    const fresh = withObservationFreshness(second, { now: new Date('2026-12-15T00:00:00Z'), staleDays: 30 });
    assert.equal(fresh.counts.never_scanned, 1);
    assert.equal(fresh.counts.blocked, 1);
    assert.equal(fresh.counts.stale, 1, 'the older success is stale');
    assert.equal(loadObservations('example.gov', 'example.gov', { dataRoot: root }).urls.p2.url, 'https://example.gov/ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean means only that the automated engines found nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-observations-'));
  try {
    syncObservationsFromState('example.gov', 'example.gov', { pages: { p1: { url: 'https://example.gov/a', lastScannedAt: '2026-11-01T00:00:00Z', lastStatus: 200 } } }, '2026-W44', { dataRoot: root });
    const clean = syncObservationsFromRecords('example.gov', 'example.gov', [{
      pageId: 'p1', url: 'https://example.gov/a', week: '2026-W44', scannedAt: '2026-11-01T00:00:00Z', status: 200,
      axe: { violations: {} }, alfa: { failed: {} },
    }], { dataRoot: root });
    assert.equal(clean.urls.p1.clean, true);
    const dirty = syncObservationsFromRecords('example.gov', 'example.gov', [{
      pageId: 'p1', url: 'https://example.gov/a', week: '2026-W44', scannedAt: '2026-11-01T00:00:00Z', status: 200,
      axe: { violations: { 'button-name': {} } },
    }], { dataRoot: root });
    assert.equal(dirty.urls.p1.clean, false);
    const notAudited = syncObservationsFromRecords('example.gov', 'example.gov', [{
      pageId: 'p2', url: 'https://example.gov/b', week: '2026-W44', scannedAt: '2026-11-01T00:00:00Z', status: 200,
    }], { dataRoot: root });
    assert.equal(notAudited.urls.p2.clean, null);
    assert.equal(observationSummary(notAudited).total_urls, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an empty or corrupted observation index degrades safely', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-observations-'));
  try {
    fs.mkdirSync(path.join(root, 'example.gov'), { recursive: true });
    fs.writeFileSync(path.join(root, 'example.gov', 'observations.json'), '{not json');
    assert.deepEqual(loadObservations('example.gov', 'example.gov', { dataRoot: root }), emptyObservations('example.gov'));
    assert.equal(observationSummary(emptyObservations('example.gov')).total_urls, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unchanged index is not rewritten, so a report run with no new pages commits nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-observations-'));
  const file = path.join(root, 'example.gov', 'observations.json');
  const backdate = () => {
    const index = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, `${JSON.stringify({ ...index, updated_at: '2026-01-01T00:00:00.000Z' }, null, 1)}\n`);
    return fs.readFileSync(file, 'utf8');
  };
  try {
    const records = [{ url: 'https://example.gov/a', pageId: 'pa', status: 200, scannedAt: '2026-11-01T00:00:00Z', week: '2026-W44', axe: { violations: {} } }];
    syncObservationsFromRecords('example.gov', 'example.gov', records, { dataRoot: root });
    let before = backdate();
    const again = syncObservationsFromRecords('example.gov', 'example.gov', records, { dataRoot: root });
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'same records (aggregate): the file is byte-for-byte unchanged');
    assert.equal(again.updated_at, '2026-01-01T00:00:00.000Z', 'and keeps the time it last really changed');

    const state = { pages: { pa: { url: 'https://example.gov/a', discoveredAt: '2026-10-01T00:00:00Z', lastScannedAt: '2026-11-01T00:00:00Z', lastScannedWeek: '2026-W44', lastStatus: 200, failCount: 0 } } };
    syncObservationsFromState('example.gov', 'example.gov', state, '2026-W44', { dataRoot: root });
    before = backdate();
    syncObservationsFromState('example.gov', 'example.gov', state, '2026-W44', { dataRoot: root });
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'same crawl state (scan): the file is byte-for-byte unchanged');

    const changed = syncObservationsFromRecords('example.gov', 'example.gov', [{ ...records[0], status: 500, scannedAt: '2026-11-08T00:00:00Z', week: '2026-W45' }], { dataRoot: root });
    assert.equal(changed.urls.pa.outcome, 'failed');
    assert.notEqual(changed.updated_at, '2026-01-01T00:00:00.000Z', 'a real change is written with a new stamp');
    assert.equal(loadObservations('example.gov', 'example.gov', { dataRoot: root }).urls.pa.outcome, 'failed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
