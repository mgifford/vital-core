import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { archiveWeek } from '../../src/lib/retention-archive.js';
import { recordVerifiedArchive } from '../../src/lib/retention-archive-index.js';
import { resolveRetention } from '../../src/lib/retention-policy.js';

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-prune-'));
  const domain = 'example.gov';
  const domainDir = path.join(root, domain);
  const weekDir = path.join(domainDir, '2026-W44');
  fs.mkdirSync(path.join(weekDir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(weekDir, 'runs'), { recursive: true });
  fs.writeFileSync(path.join(weekDir, 'summary.json'), JSON.stringify({ week: '2026-W44', generatedAt: '2026-11-01T00:00:00Z' }));
  fs.writeFileSync(path.join(weekDir, 'pages', 'p1.json'), JSON.stringify({ pageId: 'p1', url: 'https://example.gov/a', status: 200 }));
  fs.writeFileSync(path.join(weekDir, 'runs', 'run.json'), '{}');
  const archiveDir = path.join(root, 'archive');
  const configFile = path.join(root, 'targets.yml');
  fs.writeFileSync(configFile, `targets:\n  - domain: example.gov\n    retention:\n      live: { mode: fixed, weeks: 2 }\n      archive:\n        enabled: true\n        retention_months: 12\n        verify_before_prune: true\n        backend: local\n        path: ${archiveDir}\n`);
  const policy = resolveRetention({}, {
    live: { mode: 'fixed', weeks: 2 },
    archive: { enabled: true, retention_months: 12, verify_before_prune: true, backend: 'local', path: archiveDir },
  });
  const target = { key: domain, domain };
  const archived = await archiveWeek({ target, domainDir, week: '2026-W44', policy });
  recordVerifiedArchive(domainDir, {
    domain, week: '2026-W44', key: archived.key, backend: 'local',
    archiveId: archived.archiveId, zipSha256: archived.zipSha256, bytes: archived.zip.length, retentionMonths: 12,
  });
  return { root, domain, domainDir, archiveDir, configFile };
}

function run(args) {
  return execFileSync(process.execPath, ['scripts/retention-prune.js', ...args], { encoding: 'utf8' });
}

test('prune dry-run lists work and leaves source detail in place', async () => {
  const f = await fixture();
  try {
    const output = run(['--config', f.configFile, '--data-root', f.root, '--domain', f.domain, '--now', '2026-12-01']);
    assert.match(output, /DRY RUN/);
    assert.ok(fs.existsSync(path.join(f.domainDir, '2026-W44', 'pages', 'p1.json')));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('prune --execute removes only verified page/run detail and keeps the summary', async () => {
  const f = await fixture();
  try {
    run(['--config', f.configFile, '--data-root', f.root, '--domain', f.domain, '--now', '2026-12-01', '--execute', '--confirm-domain', f.domain]);
    assert.equal(fs.existsSync(path.join(f.domainDir, '2026-W44', 'pages')), false);
    assert.equal(fs.existsSync(path.join(f.domainDir, '2026-W44', 'runs')), false);
    assert.ok(fs.existsSync(path.join(f.domainDir, '2026-W44', 'summary.json')));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('prune refuses a missing archive and does not touch source detail', async () => {
  const f = await fixture();
  try {
    fs.rmSync(path.join(f.root, 'archive'), { recursive: true, force: true });
    assert.throws(() => run(['--config', f.configFile, '--data-root', f.root, '--domain', f.domain, '--now', '2026-12-01', '--execute', '--confirm-domain', f.domain]));
    assert.ok(fs.existsSync(path.join(f.domainDir, '2026-W44', 'pages', 'p1.json')));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
