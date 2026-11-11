import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluatePruneReadiness } from '../../src/lib/retention-rollout.js';
import { planDomain } from '../../src/lib/retention-plan.js';
import { resolveRetention } from '../../src/lib/retention-policy.js';
import { archiveWeek } from '../../src/lib/retention-archive.js';
import { recordVerifiedArchive, readArchiveIndex } from '../../src/lib/retention-archive-index.js';
import { createArchiveBackend } from '../../src/lib/retention-archive.js';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-rollout-'));
  const domain = 'example.gov';
  const domainDir = path.join(root, domain);
  const weekDir = path.join(domainDir, '2026-W44');
  fs.mkdirSync(path.join(weekDir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(weekDir, 'summary.json'), JSON.stringify({ week: '2026-W44', generatedAt: '2026-11-01T00:00:00Z' }));
  fs.writeFileSync(path.join(weekDir, 'pages', 'p1.json'), JSON.stringify({ pageId: 'p1', url: 'https://example.gov/a', status: 200, week: '2026-W44' }));
  return { root, domain, domainDir };
}

const policy = resolveRetention({ archive: { enabled: true, retention_months: 12, verify_before_prune: true, backend: 'local', path: 'archive' } }, {
  live: { mode: 'fixed', weeks: 2 },
});

test('prune readiness requires a complete, verified archive for every candidate', async () => {
  const f = fixture();
  try {
    const backend = createArchiveBackend({ archive: { enabled: true, backend: 'local', path: path.join(f.root, 'archive') } });
    const archived = await archiveWeek({ target: { key: f.domain, domain: f.domain }, domainDir: f.domainDir, week: '2026-W44', policy, backend });
    recordVerifiedArchive(f.domainDir, {
      domain: f.domain, week: '2026-W44', key: archived.key, backend: 'local',
      archiveId: archived.archiveId, zipSha256: archived.zipSha256, bytes: archived.zip.length, retentionMonths: 12,
    });
    const now = new Date('2026-12-01T00:00:00Z');
    const plan = planDomain({ dataRoot: f.root, domainKey: f.domain, policy, now });
    assert.equal(plan.entries[0].action, 'archive_candidate');
    const ready = await evaluatePruneReadiness({ plan, archiveIndex: readArchiveIndex(f.domainDir, f.domain), backend, now });
    assert.equal(ready.ready, true);
    assert.equal(ready.entries[0].status, 'ready');
    assert.equal(ready.destructiveActionsPerformed, 0);

    const tampered = await archiveWeek({ target: { key: f.domain, domain: f.domain }, domainDir: f.domainDir, week: '2026-W44', policy, backend });
    fs.writeFileSync(path.join(f.root, 'archive', f.domain, '2026-W44.zip'), Buffer.from(tampered.zip).fill(0, 20, 40));
    const blocked = await evaluatePruneReadiness({ plan, archiveIndex: readArchiveIndex(f.domainDir, f.domain), backend, now });
    assert.equal(blocked.ready, false);
    assert.ok(blocked.entries[0].status.startsWith('blocked'));
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('legacy and archive-disabled plans are never ready to prune', async () => {
  const f = fixture();
  try {
    const now = new Date('2026-12-01T00:00:00Z');
    const legacy = resolveRetention({}, {}, 2);
    const legacyPlan = planDomain({ dataRoot: f.root, domainKey: f.domain, policy: legacy, now });
    const result = await evaluatePruneReadiness({ plan: legacyPlan, archiveIndex: null, now, verifyObject: false });
    assert.equal(result.ready, false);
    assert.equal(result.entries[0].status, 'legacy_prune_requires_authorization');
    const disabledPolicy = resolveRetention({ archive: { enabled: false } }, { live: { mode: 'fixed', weeks: 2 } });
    const disabledPlan = planDomain({ dataRoot: f.root, domainKey: f.domain, policy: disabledPolicy, now });
    const disabled = await evaluatePruneReadiness({ plan: disabledPlan, archiveIndex: null, now, verifyObject: false });
    assert.equal(disabled.ready, false);
    assert.equal(disabled.entries[0].status, 'requires_explicit_discard_approval');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
