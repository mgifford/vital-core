import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  archiveWeek,
  archiveObjectKey,
  assertArchivableTarget,
  buildArchive,
  createArchiveBackend,
  sha256,
  verifyArchive,
  readZip,
} from '../../src/lib/retention-archive.js';
import { createZip } from '../../src/lib/zip.js';
import { resolveRetention } from '../../src/lib/retention-policy.js';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-archive-'));
  const domain = 'example.gov';
  const domainDir = path.join(root, domain);
  const week = '2026-W44';
  const weekDir = path.join(domainDir, week);
  fs.mkdirSync(path.join(weekDir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(weekDir, 'runs'), { recursive: true });
  fs.mkdirSync(path.join(weekDir, 'screenshots'), { recursive: true });
  fs.mkdirSync(path.join(domainDir, '2026-W43', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(weekDir, 'summary.json'), JSON.stringify({
    week, generatedAt: '2026-11-01T00:00:00Z', pagesScanned: 2, pagesAudited: 2,
    axe: { version: '4.14.0' }, alfa: { version: '0.117.0' },
  }));
  fs.writeFileSync(path.join(weekDir, 'pages', 'p1.json'), JSON.stringify({
    pageId: 'p1', url: 'https://example.gov/a', status: 200, week,
    violations: [{ occurrence_id: 'VO-1', finding_ref: 'VFR-1' }],
  }));
  fs.writeFileSync(path.join(weekDir, 'pages', 'p2.json'), JSON.stringify({
    pageId: 'p2', url: 'https://example.gov/b', status: 200, week,
    unchanged: true, since: '2026-W43',
  }));
  fs.writeFileSync(path.join(domainDir, '2026-W43', 'pages', 'p2.json'), JSON.stringify({
    pageId: 'p2', url: 'https://example.gov/b', status: 200, week: '2026-W43',
    violations: [{ occurrence_id: 'VO-2' }],
  }));
  fs.writeFileSync(path.join(weekDir, 'runs', 'run.json'), JSON.stringify({ runId: 'r1', pages: 2 }));
  fs.writeFileSync(path.join(weekDir, 'screenshots', 'p1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  fs.writeFileSync(path.join(weekDir, 'example_01NOV2026_bugs.csv'), 'id,rule\nVO-1,button-name\n');
  return { root, domainDir, domain, week };
}

const policy = resolveRetention({}, {
  profile: 'balanced',
  archive: { enabled: true, retention_months: 12, verify_before_prune: true, backend: 'local', path: 'unused' },
});

test('archives are deterministic and self-contained across dedup stubs', () => {
  const f = fixture();
  try {
    const first = buildArchive({ domainDir: f.domainDir, domainKey: f.domain, week: f.week, policy });
    const second = buildArchive({ domainDir: f.domainDir, domainKey: f.domain, week: f.week, policy });
    assert.deepEqual(first.zip, second.zip, 'same source bytes produce the same ZIP');
    assert.equal(first.manifest.schema_version, 1);
    assert.equal(first.status, 'complete');
    assert.ok(first.manifest.record_ids.includes('VO-1'));
    assert.ok(first.manifest.record_ids.includes('VO-2'));
    const stub = first.manifest.files.find((file) => file.path === 'pages/p2.json');
    assert.equal(stub.resolved_from, '2026-W43');
    assert.notEqual(stub.source_sha256, stub.sha256);
    assert.ok(first.manifest.files.some((file) => file.path === 'screenshots/p1.jpg'));
    assert.ok(first.manifest.files.some((file) => file.path === 'example_01NOV2026_bugs.csv'));
    const verified = verifyArchive(first.zip, { expectedSha256: first.zipSha256 });
    assert.equal(verified.ok, true, verified.errors.join('; '));
    assert.equal(verified.manifest.archive_id, first.archiveId);
    // The source tree was not modified.
    assert.ok(fs.existsSync(path.join(f.domainDir, f.week, 'pages', 'p1.json')));
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('the ZIP writer refuses an archive over the conventional entry limit', () => {
  const entries = Array.from({ length: 65536 }, (_, i) => ({ path: `pages/${i}.json`, data: '{}' }));
  assert.throws(() => createZip(entries), /65,535-entry limit/);
});

test('a verified archive restores complete page evidence into a fresh directory', () => {
  const f = fixture();
  try {
    const built = buildArchive({ domainDir: f.domainDir, domainKey: f.domain, week: f.week, policy });
    const entries = readZip(built.zip);
    const out = fs.mkdtempSync(path.join(f.root, 'restored-'));
    for (const [name, bytes] of entries) {
      const target = path.join(out, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    }
    const restoredPage = JSON.parse(fs.readFileSync(path.join(out, 'pages', 'p1.json'), 'utf8'));
    const sourcePage = JSON.parse(fs.readFileSync(path.join(f.domainDir, f.week, 'pages', 'p1.json'), 'utf8'));
    assert.deepEqual(restoredPage, sourcePage, 'full page evidence matches the source');
    const restoredStub = JSON.parse(fs.readFileSync(path.join(out, 'pages', 'p2.json'), 'utf8'));
    assert.equal(restoredStub.unchanged, false);
    assert.equal(restoredStub.archive_source.since, '2026-W43');
    assert.ok(fs.existsSync(path.join(out, 'manifest.json')));
    assert.ok(fs.existsSync(path.join(out, 'summary.json')));
    assert.ok(fs.existsSync(path.join(out, 'screenshots', 'p1.jpg')));
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('unresolved dedup stubs make an archive incomplete and are never published', async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.domainDir, f.week, 'pages', 'p3.json'), JSON.stringify({
      pageId: 'p3', url: 'https://example.gov/c', status: 200, week: f.week, unchanged: true, since: '2026-W42',
    }));
    const built = buildArchive({ domainDir: f.domainDir, domainKey: f.domain, week: f.week, policy });
    assert.equal(built.status, 'incomplete');
    assert.equal(built.unresolvedStubs.length, 1);
    assert.equal(verifyArchive(built.zip).ok, false, 'incomplete manifest fails verification');
    const archiveDir = path.join(f.root, 'archives');
    await assert.rejects(
      archiveWeek({ target: { key: f.domain, domain: 'example.gov' }, domainDir: f.domainDir, week: f.week, policy: { ...policy, archive: { ...policy.archive, path: archiveDir } } }),
      /incomplete/,
    );
    assert.equal(fs.existsSync(archiveDir), false, 'no file was uploaded');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('local backend performs an atomic, verified round trip without pruning', async () => {
  const f = fixture();
  try {
    const archiveDir = path.join(f.root, 'archives');
    const target = { key: f.domain, domain: 'example.gov' };
    const p = { ...policy, archive: { ...policy.archive, path: archiveDir } };
    const result = await archiveWeek({ target, domainDir: f.domainDir, week: f.week, policy: p });
    assert.equal(result.key, `${f.domain}/${f.week}.zip`);
    assert.ok(fs.existsSync(path.join(archiveDir, f.domain, `${f.week}.zip`)));
    assert.equal(verifyArchive(fs.readFileSync(path.join(archiveDir, f.domain, `${f.week}.zip`)), { expectedSha256: result.zipSha256 }).ok, true);
    assert.ok(fs.existsSync(path.join(f.domainDir, f.week, 'pages', 'p1.json')), 'source detail still exists');
    assert.equal(archiveObjectKey({ domainKey: f.domain, week: f.week, prefix: 'vital' }), `vital/${f.domain}/${f.week}.zip`);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('the S3-compatible backend signs and round-trips through an HTTP endpoint', async () => {
  const objects = new Map();
  let lastHeaders = null;
  const server = http.createServer((req, res) => {
    lastHeaders = req.headers;
    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        objects.set(req.url, Buffer.concat(chunks));
        res.statusCode = 200;
        res.end();
      });
      return;
    }
    if (req.method === 'HEAD') { res.statusCode = objects.has(req.url) ? 200 : 404; res.end(); return; }
    if (req.method === 'GET' && objects.has(req.url)) { res.statusCode = 200; res.end(objects.get(req.url)); return; }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const backend = createArchiveBackend({
      archive: { enabled: true, backend: 's3', endpoint: `http://127.0.0.1:${server.address().port}`, bucket: 'evidence', prefix: 'weekly' },
    }, {
      VITAL_ARCHIVE_S3_ACCESS_KEY_ID: 'test-key',
      VITAL_ARCHIVE_S3_SECRET_ACCESS_KEY: 'test-secret',
      VITAL_ARCHIVE_S3_SESSION_TOKEN: 'session-token',
    });
    const payload = Buffer.from('archive bytes');
    const key = 'weekly/example.gov/2026-W44.zip';
    const uploaded = await backend.put(key, payload);
    assert.equal(uploaded.sha256, sha256(payload));
    assert.equal(await backend.exists(key), true);
    assert.deepEqual(await backend.get(key), payload);
    assert.match([...objects.keys()][0], /\/evidence\/weekly\/example\.gov\/2026-W44\.zip/);
    assert.equal(lastHeaders['x-amz-security-token'], 'session-token');
    assert.match(lastHeaders.authorization, /x-amz-security-token/);
  } finally {
    server.close();
  }
});

test('the archive CLI writes a verified archive and leaves source detail in place', () => {
  const f = fixture();
  try {
    const configFile = path.join(f.root, 'targets.yml');
    const archiveDir = path.join(f.root, 'archives');
    fs.writeFileSync(configFile, `targets:
  - domain: example.gov
    retention:
      profile: balanced
      archive:
        enabled: true
        retention_months: 12
        verify_before_prune: true
        backend: local
        path: ${archiveDir}
`);
    const output = execFileSync(process.execPath, [
      'scripts/retention-archive.js',
      '--config', configFile,
      '--data-root', f.root,
      '--domain', f.domain,
      '--week', f.week,
      '--write',
      '--json',
    ], { encoding: 'utf8' });
    const result = JSON.parse(output);
    assert.equal(result.dryRun, false);
    assert.equal(result.errors.length, 0);
    assert.equal(result.archives[0].status, 'complete');
    assert.ok(fs.existsSync(path.join(archiveDir, f.domain, `${f.week}.zip`)));
    assert.ok(fs.existsSync(path.join(f.domainDir, f.week, 'pages', 'p1.json')));
    const index = JSON.parse(fs.readFileSync(path.join(f.domainDir, 'archives.json')));
    assert.equal(index.archives[0].week, f.week);
    assert.equal(index.archives[0].status, 'complete');
    assert.match(index.archives[0].key, new RegExp(`${f.week}\\.zip$`));
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('archive publication retries transient backend failures', async () => {
  const f = fixture();
  try {
    const archiveDir = path.join(f.root, 'archives');
    const local = createArchiveBackend({ archive: { enabled: true, backend: 'local', path: archiveDir } });
    let puts = 0;
    const flaky = {
      async put(key, data) { puts++; if (puts === 1) throw new Error('transient put'); return local.put(key, data); },
      async get(key) { return local.get(key); },
    };
    const result = await archiveWeek({
      target: { key: f.domain, domain: 'example.gov' },
      domainDir: f.domainDir,
      week: f.week,
      policy: { ...policy, archive: { ...policy.archive, path: archiveDir } },
      backend: flaky,
      attempts: 2,
    });
    assert.equal(result.status, 'complete');
    assert.equal(puts, 2);
    assert.ok(fs.existsSync(path.join(archiveDir, f.domain, `${f.week}.zip`)));
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('archives reject corruption, unsafe targets and missing remote credentials', () => {
  const f = fixture();
  try {
    const built = buildArchive({ domainDir: f.domainDir, domainKey: f.domain, week: f.week, policy });
    const corrupt = Buffer.from(built.zip);
    corrupt[corrupt.length - 30] ^= 0xff;
    assert.equal(verifyArchive(corrupt, { expectedSha256: built.zipSha256 }).ok, false);
    assert.throws(() => assertArchivableTarget({ key: 'va.gov', hf_only: true }), /hf_only/);
    assert.throws(() => createArchiveBackend({ archive: { enabled: true, backend: 's3', endpoint: 'https://s3.example', bucket: 'b' } }, {}), /credentials/);
    assert.throws(() => archiveObjectKey({ domainKey: f.domain, week: 'not-a-week' }), /invalid ISO week/);
    assert.equal(sha256(Buffer.from('x')).length, 64);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
