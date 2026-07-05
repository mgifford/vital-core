import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pageFingerprint, resolvePageRecord } from '../../src/lib/page-records.js';

const BASE = {
  pageId: 'p1',
  url: 'https://example.gov/a',
  week: '2026-W25',
  runId: 'run-1',
  scannedAt: '2026-06-18T00:00:00.000Z',
  status: 200,
  depth: 1,
  axe: { violationCount: 2, violations: { 'image-alt': { count: 2 } } },
};

test('pageFingerprint ignores week/runId/scannedAt', () => {
  const a = pageFingerprint(BASE);
  const b = pageFingerprint({ ...BASE, week: '2026-W26', runId: 'run-2', scannedAt: '2026-06-25T00:00:00.000Z' });
  assert.equal(a, b);
});

test('pageFingerprint changes when engine content changes', () => {
  const a = pageFingerprint(BASE);
  const b = pageFingerprint({ ...BASE, axe: { violationCount: 3, violations: { 'image-alt': { count: 3 } } } });
  assert.notEqual(a, b);
});

test('pageFingerprint is stable under array reordering (crawl non-determinism)', () => {
  const rec1 = { ...BASE, resources: [{ url: 'https://example.gov/a.pdf' }, { url: 'https://example.gov/b.pdf' }] };
  const rec2 = { ...BASE, resources: [{ url: 'https://example.gov/b.pdf' }, { url: 'https://example.gov/a.pdf' }] };
  assert.equal(pageFingerprint(rec1), pageFingerprint(rec2));
});

test('resolvePageRecord returns non-stub records unchanged', () => {
  const resolved = resolvePageRecord('/nonexistent', BASE);
  assert.deepEqual(resolved, BASE);
});

test('resolvePageRecord follows a stub to the full record and re-attributes week/runId/scannedAt/status', () => {
  const domainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-page-records-'));
  try {
    const prevWeek = '2026-W24';
    fs.mkdirSync(path.join(domainDir, prevWeek, 'pages'), { recursive: true });
    const full = { ...BASE, week: prevWeek, runId: 'run-0', scannedAt: '2026-06-11T00:00:00.000Z' };
    fs.writeFileSync(path.join(domainDir, prevWeek, 'pages', 'p1.json'), JSON.stringify(full));

    const stub = {
      pageId: 'p1',
      url: BASE.url,
      week: '2026-W25',
      runId: 'run-1',
      scannedAt: '2026-06-18T00:00:00.000Z',
      status: 200,
      unchanged: true,
      since: prevWeek,
    };

    const resolved = resolvePageRecord(domainDir, stub);
    assert.equal(resolved.week, '2026-W25');
    assert.equal(resolved.runId, 'run-1');
    assert.equal(resolved.scannedAt, '2026-06-18T00:00:00.000Z');
    assert.deepEqual(resolved.axe, BASE.axe);
  } finally {
    fs.rmSync(domainDir, { recursive: true, force: true });
  }
});

test('resolvePageRecord returns the stub as-is when the pointed-to week has been pruned', () => {
  const domainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-page-records-'));
  try {
    const stub = {
      pageId: 'p1',
      url: BASE.url,
      week: '2026-W25',
      runId: 'run-1',
      scannedAt: '2026-06-18T00:00:00.000Z',
      status: 200,
      unchanged: true,
      since: '2026-W20', // pruned; never written here
    };
    const resolved = resolvePageRecord(domainDir, stub);
    assert.deepEqual(resolved, stub);
  } finally {
    fs.rmSync(domainDir, { recursive: true, force: true });
  }
});
