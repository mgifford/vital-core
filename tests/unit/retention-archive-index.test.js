import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  archiveExpiry,
  archiveState,
  emptyArchiveIndex,
  readArchiveIndex,
  recordVerifiedArchive,
  withArchiveState,
  writeArchiveApi,
} from '../../src/lib/retention-archive-index.js';
import { renderArchiveEvidencePage, renderArchivePage } from '../../src/report-html.js';

const target = { key: 'example.gov', domain: 'example.gov', display: { score_format: 'both' } };
const summary = {
  week: '2026-W44', pagesAudited: 2, pagesScanned: 2,
  axe: { medianViolations: 1, version: '4.14.0' },
  alfa: { medianFailures: 1, version: '0.117.0' },
};

test('archive index records verified entries, upserts and computes expiry state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-archive-index-'));
  try {
    const domainDir = path.join(root, target.key);
    recordVerifiedArchive(domainDir, {
      domain: target.key, week: '2026-W44', key: `${target.key}/2026-W44.zip`, backend: 'local',
      archiveId: 'a'.repeat(64), zipSha256: 'b'.repeat(64), bytes: 100, retentionMonths: 12,
    });
    recordVerifiedArchive(domainDir, {
      domain: target.key, week: '2026-W44', key: `${target.key}/2026-W44.zip`, backend: 'local',
      archiveId: 'c'.repeat(64), zipSha256: 'd'.repeat(64), bytes: 120, retentionMonths: 12,
    });
    const index = readArchiveIndex(domainDir, target.key);
    assert.equal(index.archives.length, 1);
    assert.equal(index.archives[0].archive_id, 'c'.repeat(64));
    assert.equal(archiveState(index.archives[0]), 'available');
    assert.equal(archiveState({ ...index.archives[0], status: 'incomplete' }), 'incomplete');
    assert.equal(archiveState({ ...index.archives[0], expires_at: '2020-01-01T00:00:00.000Z' }), 'expired');
    assert.equal(archiveState(null), 'missing');
    assert.equal(withArchiveState(index).counts.available, 1);
    assert.match(archiveExpiry('2026-01-31T00:00:00.000Z', 1), /^2026-02-28/);
    assert.equal(archiveExpiry('2026-01-01T00:00:00.000Z', 'indefinite'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the archive API publishes a fleet index and per-domain entries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-archive-api-'));
  try {
    const docs = path.join(root, 'docs');
    const index = withArchiveState({
      ...emptyArchiveIndex('example.gov'),
      archives: [{ week: '2026-W44', status: 'complete', key: 'example.gov/2026-W44.zip', zip_sha256: 'b'.repeat(64), expires_at: null }],
    });
    writeArchiveApi(docs, [index]);
    const fleet = JSON.parse(fs.readFileSync(path.join(docs, 'api', 'v1', 'archives', 'index.json')));
    const domain = JSON.parse(fs.readFileSync(path.join(docs, 'api', 'v1', 'example.gov', 'archives.json')));
    assert.equal(fleet.schema_version, 1);
    assert.equal(fleet.domains[0].url, '/api/v1/example.gov/archives.json');
    assert.equal(domain.archives[0].state, 'available');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('archive pages expose evidence states without a silent redirect', () => {
  const html = renderArchivePage(target, [summary], summary.week, withArchiveState({
    ...emptyArchiveIndex('example.gov'),
    archives: [{ week: '2026-W44', status: 'complete', key: 'example.gov/2026-W44.zip', zip_sha256: 'b'.repeat(64) }],
  }));
  assert.match(html, /Raw evidence/);
  assert.match(html, /Evidence details/);
  assert.match(html, /Available/);
  assert.doesNotMatch(html, /http-equiv="refresh"/i);

  for (const [state, pattern] of [
    ['available', /Verified archive available/],
    ['expired', /Archive expired/],
    ['incomplete', /Archive incomplete/],
    ['missing', /No verified archive recorded/],
  ]) {
    const evidence = renderArchiveEvidencePage(target, summary, { state, key: 'example.gov/2026-W44.zip', zip_sha256: 'b'.repeat(64), expires_at: '2020-01-01T00:00:00.000Z' }, summary.week);
    assert.match(evidence, pattern);
    assert.doesNotMatch(evidence, /http-equiv="refresh"/i);
    assert.match(evidence, /not a conformance claim/);
  }
  const expired = renderArchiveEvidencePage(target, summary, { state: 'expired', expires_at: '2020-01-01T00:00:00.000Z' }, summary.week);
  assert.match(expired, /does not redirect/);
});
