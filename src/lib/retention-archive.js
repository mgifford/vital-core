/**
 * Deterministic, verifiable weekly evidence archives.
 *
 * This module is additive: it creates an archive for one domain/week and
 * verifies a round trip. It never removes source files. The data repository
 * remains the source of truth until a separate, explicitly authorized prune
 * step verifies an archive.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { createZip, crc32 } from './zip.js';

const SCHEMA_VERSION = 1;
const MAX_STUB_DEPTH = 5;
const MAX_RECORD_IDS = 20000;
const README = `VITAL Core weekly evidence archive

This archive is a point-in-time copy of one domain's ISO-week data. It is
read-only evidence, not a live report. Finding summaries, IDs and report links
remain available from the published reports and the data repository ledgers.

See manifest.json for checksums, source metadata and any unresolved
deduplication dependencies. An archive with status "incomplete" must not be
used as the sole basis for deleting source data.
`;

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function escapeKey(value) {
  return String(value).replaceAll('%', '%25').replaceAll('/', '%2F');
}

export function archiveObjectKey({ domainKey, week, prefix = '' }) {
  const safeDomain = String(domainKey).replace(/[^A-Za-z0-9._-]/g, '_');
  const safeWeek = String(week);
  if (!/^\d{4}-W\d{2}$/.test(safeWeek)) throw new Error(`invalid ISO week: ${week}`);
  const normalizedPrefix = prefix ? `${String(prefix).replace(/^\/+|\/+$/g, '')}/` : '';
  return `${normalizedPrefix}${escapeKey(safeDomain)}/${safeWeek}.zip`;
}

export function assertArchivableTarget(target) {
  if (!target || !target.key) throw new Error('target is required');
  if (target.hf_only) throw new Error(`target ${target.key} is hf_only; its data must never be archived`);
  if (target.data_repo && target.hf_only) throw new Error('hf_only target must not have a data repo');
}

function collectRecordIds(value, ids, limit = MAX_RECORD_IDS) {
  if (ids.size >= limit || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectRecordIds(item, ids, limit);
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['occurrence_id', 'observation_id', 'finding_ref', 'pattern_id', 'instance_id'].includes(key) && typeof child === 'string') {
      ids.add(child);
    } else {
      collectRecordIds(child, ids, limit);
    }
    if (ids.size >= limit) return;
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveStub(domainDir, record, depth = 0, visited = new Set()) {
  if (!record.unchanged) return { record, resolvedFrom: null, unresolved: false };
  if (depth >= MAX_STUB_DEPTH || !record.since) return { record, resolvedFrom: record.since ?? null, unresolved: true };
  const key = `${record.since}/${record.pageId ?? ''}`;
  if (visited.has(key)) return { record, resolvedFrom: record.since, unresolved: true };
  visited.add(key);
  const sourcePath = path.join(domainDir, record.since, 'pages', `${record.pageId ?? ''}.json`);
  if (!fs.existsSync(sourcePath)) return { record, resolvedFrom: record.since, unresolved: true };
  let parent;
  try { parent = readJson(sourcePath); } catch { return { record, resolvedFrom: record.since, unresolved: true }; }
  const parentResolved = resolveStub(domainDir, parent, depth + 1, visited);
  if (parentResolved.unresolved) return { record, resolvedFrom: record.since, unresolved: true };
  return {
    record: {
      ...parentResolved.record,
      week: record.week,
      runId: record.runId,
      scannedAt: record.scannedAt,
      status: record.status,
      unchanged: false,
      archive_source: { stub: true, since: record.since, page: `${record.pageId ?? ''}.json` },
    },
    resolvedFrom: record.since,
    unresolved: false,
  };
}

function rootEvidenceFiles(weekDir) {
  return fs.readdirSync(weekDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(csv|json)$/i.test(entry.name) && entry.name !== 'summary.json' && entry.name !== 'manifest.json')
    .map((entry) => entry.name)
    .sort();
}

function directoryEvidenceFiles(weekDir, subdir) {
  const dir = path.join(weekDir, subdir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.posix.join(subdir, entry.name))
    .sort();
}

export function buildArchive({ domainDir, domainKey, week, policy }) {
  if (!/^\d{4}-W\d{2}$/.test(week)) throw new Error(`invalid ISO week: ${week}`);
  const weekDir = path.join(domainDir, week);
  if (!fs.existsSync(weekDir)) throw new Error(`week directory not found: ${weekDir}`);
  const summaryPath = path.join(weekDir, 'summary.json');
  if (!fs.existsSync(summaryPath)) throw new Error(`summary.json is required before archiving: ${week}`);
  const summary = readJson(summaryPath);

  const archiveEntries = [];
  const manifestFiles = [];
  const unresolvedStubs = [];
  const recordIds = new Set();
  const manifestPages = [];
  const addFile = (relativePath, data, { sourcePath = null, sourceSha256 = null, resolvedFrom = null } = {}) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const digest = sha256(buffer);
    archiveEntries.push({ path: relativePath, data: buffer });
    manifestFiles.push({
      path: relativePath,
      bytes: buffer.length,
      sha256: digest,
      ...(sourceSha256 ? { source_sha256: sourceSha256 } : {}),
      ...(resolvedFrom ? { resolved_from: resolvedFrom } : {}),
    });
    if (sourcePath && relativePath.endsWith('.json')) {
      try { collectRecordIds(JSON.parse(buffer.toString('utf8')), recordIds); } catch { /* binary or malformed */ }
    }
  };

  const pagesDir = path.join(weekDir, 'pages');
  if (fs.existsSync(pagesDir)) {
    for (const file of fs.readdirSync(pagesDir).filter((name) => name.endsWith('.json')).sort()) {
      const sourcePath = path.join(pagesDir, file);
      const source = fs.readFileSync(sourcePath);
      let record;
      try { record = JSON.parse(source.toString('utf8')); } catch {
        unresolvedStubs.push({ path: `pages/${file}`, reason: 'unreadable JSON' });
        continue;
      }
      const resolved = resolveStub(domainDir, record);
      if (resolved.unresolved) {
        unresolvedStubs.push({ path: `pages/${file}`, reason: `missing dedup source ${record.since ?? '(none)'}` });
      }
      addFile(`pages/${file}`, jsonBuffer(resolved.record), {
        sourcePath,
        sourceSha256: sha256(source),
        resolvedFrom: resolved.resolvedFrom,
      });
      manifestPages.push({
        path: `pages/${file}`,
        page_id: resolved.record.pageId ?? null,
        url: resolved.record.url ?? null,
        status: resolved.record.status ?? null,
        ...(resolved.resolvedFrom ? { resolved_from: resolved.resolvedFrom } : {}),
      });
    }
  }

  for (const subdir of ['runs', 'screenshots']) {
    for (const relativePath of directoryEvidenceFiles(weekDir, subdir)) {
      const sourcePath = path.join(weekDir, relativePath);
      const source = fs.readFileSync(sourcePath);
      let data = source;
      if (relativePath.endsWith('.json')) {
        try { data = jsonBuffer(JSON.parse(source.toString('utf8'))); } catch { unresolvedStubs.push({ path: relativePath, reason: 'unreadable JSON' }); }
      }
      addFile(relativePath, data, { sourcePath, sourceSha256: sha256(source) });
    }
  }

  addFile('summary.json', jsonBuffer(summary), { sourcePath: summaryPath, sourceSha256: sha256(fs.readFileSync(summaryPath)) });
  for (const file of rootEvidenceFiles(weekDir)) {
    const sourcePath = path.join(weekDir, file);
    const source = fs.readFileSync(sourcePath);
    addFile(file, source, { sourcePath, sourceSha256: sha256(source) });
  }
  addFile('README.txt', README);

  const coreManifest = {
    schema_version: SCHEMA_VERSION,
    domain: domainKey,
    week,
    generated_at: summary.generatedAt ?? null,
    scanner: {
      axe: summary.axe?.version ?? null,
      alfa: summary.alfa?.version ?? null,
    },
    policy: { profile: policy?.profile ?? null, archive_retention_months: policy?.archive?.retention_months ?? null },
    status: unresolvedStubs.length ? 'incomplete' : 'complete',
    unresolved_stubs: unresolvedStubs,
    files: manifestFiles.sort((a, b) => a.path.localeCompare(b.path)),
    pages: manifestPages.sort((a, b) => String(a.page_id).localeCompare(String(b.page_id))),
    record_ids: [...recordIds].sort(),
    source_note: 'Deduplicated page stubs are expanded from their source week where available; stubs that cannot be resolved are listed in unresolved_stubs and make this archive incomplete.',
  };
  const archiveId = sha256(Buffer.from(JSON.stringify(coreManifest)));
  const manifest = { ...coreManifest, archive_id: archiveId };
  const zip = createZip([
    ...archiveEntries,
    { path: 'manifest.json', data: jsonBuffer(manifest) },
  ]);
  return {
    zip,
    manifest,
    archiveId,
    zipSha256: sha256(zip),
    status: manifest.status,
    unresolvedStubs,
  };
}

/** Minimal ZIP reader for store/deflate entries; verifies CRC and sizes. */
export function readZip(buffer) {
  const entries = new Map();
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP file: end record missing');
  const count = buffer.readUInt16LE(eocd + 10);
  let ptr = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(ptr) !== 0x02014b50) throw new Error('malformed ZIP central directory');
    const method = buffer.readUInt16LE(ptr + 10);
    const crc = buffer.readUInt32LE(ptr + 16);
    const compressedSize = buffer.readUInt32LE(ptr + 20);
    const size = buffer.readUInt32LE(ptr + 24);
    const nameLength = buffer.readUInt16LE(ptr + 28);
    const extraLength = buffer.readUInt16LE(ptr + 30);
    const commentLength = buffer.readUInt16LE(ptr + 32);
    const localOffset = buffer.readUInt32LE(ptr + 42);
    const name = buffer.toString('utf8', ptr + 46, ptr + 46 + nameLength);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`malformed local header: ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    let data = buffer.subarray(start, start + compressedSize);
    if (method === 8) data = zlib.inflateRawSync(data);
    else if (method !== 0) throw new Error(`unsupported ZIP method ${method}`);
    if (data.length !== size) throw new Error(`size mismatch: ${name}`);
    if (crc32(data) !== crc) throw new Error(`checksum mismatch: ${name}`);
    entries.set(name, data);
    ptr += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function verifyArchive(buffer, { expectedSha256 = null } = {}) {
  const errors = [];
  if (expectedSha256 && sha256(buffer) !== expectedSha256) errors.push('archive SHA-256 mismatch');
  let entries;
  try { entries = readZip(buffer); } catch (error) { return { ok: false, errors: [error.message] }; }
  const manifestBytes = entries.get('manifest.json');
  if (!manifestBytes) return { ok: false, errors: ['manifest.json is missing'] };
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { return { ok: false, errors: ['manifest.json is not valid JSON'] }; }
  if (manifest.schema_version !== SCHEMA_VERSION) errors.push('manifest schema_version is not supported');
  if (manifest.archive_id) {
    const { archive_id: claimed, ...core } = manifest;
    if (claimed !== sha256(Buffer.from(JSON.stringify(core)))) errors.push('manifest archive_id mismatch');
  } else {
    errors.push('manifest archive_id is missing');
  }
  for (const file of manifest.files ?? []) {
    const data = entries.get(file.path);
    if (!data) { errors.push(`missing archive entry: ${file.path}`); continue; }
    if (data.length !== file.bytes) errors.push(`size mismatch: ${file.path}`);
    if (sha256(data) !== file.sha256) errors.push(`checksum mismatch: ${file.path}`);
  }
  if (manifest.status === 'incomplete') errors.push('archive manifest is incomplete');
  return { ok: errors.length === 0, errors, manifest };
}

class LocalArchiveBackend {
  constructor({ root }) {
    if (!root) throw new Error('local archive backend requires a root path');
    this.root = path.resolve(root);
    this.kind = 'local';
  }
  destination(key) {
    const normalized = path.posix.normalize(key);
    if (normalized.startsWith('../') || path.isAbsolute(normalized)) throw new Error('unsafe archive key');
    return path.join(this.root, normalized);
  }
  async put(key, buffer) {
    const target = this.destination(key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temp, buffer);
    fs.renameSync(temp, target);
    return { key, bytes: buffer.length, sha256: sha256(buffer) };
  }
  async get(key) { return fs.readFileSync(this.destination(key)); }
  async exists(key) { return fs.existsSync(this.destination(key)); }
}

class S3ArchiveBackend {
  constructor({ endpoint, bucket, prefix = '', region = 'us-east-1', accessKeyId, secretAccessKey, sessionToken = null }) {
    if (!endpoint || !bucket) throw new Error('s3 archive backend requires endpoint and bucket');
    if (!accessKeyId || !secretAccessKey) throw new Error('s3 archive backend requires credentials in the environment');
    this.endpoint = endpoint.replace(/\/+$/, '');
    this.bucket = bucket;
    this.prefix = prefix;
    this.region = region;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;
    this.kind = 's3';
  }
  url(key) { return `${this.endpoint}/${encodeURIComponent(this.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`; }
  signedHeaders(method, key, payload) {
    const u = new URL(this.url(key));
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = amzDate.slice(0, 8);
    const payloadHash = sha256(payload ?? Buffer.alloc(0));
    const tokenHeader = this.sessionToken ? `x-amz-security-token:${this.sessionToken}\n` : '';
    const canonicalHeaders = `host:${u.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n${tokenHeader}`;
    const signedHeaders = this.sessionToken
      ? 'host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
      : 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = `${method}\n${u.pathname}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
    const scope = `${date}/${this.region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(Buffer.from(canonicalRequest))}`;
    const hmac = (keyPart, value) => crypto.createHmac('sha256', keyPart).update(value).digest();
    const kDate = hmac(`AWS4${this.secretAccessKey}`, date);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    return {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      ...(this.sessionToken ? { 'x-amz-security-token': this.sessionToken } : {}),
    };
  }
  async put(key, buffer) {
    const response = await fetch(this.url(key), { method: 'PUT', headers: this.signedHeaders('PUT', key, buffer), body: buffer });
    if (!response.ok) throw new Error(`archive upload failed: HTTP ${response.status}`);
    return { key, bytes: buffer.length, sha256: sha256(buffer) };
  }
  async get(key) {
    const response = await fetch(this.url(key), { method: 'GET', headers: this.signedHeaders('GET', key, Buffer.alloc(0)) });
    if (!response.ok) throw new Error(`archive download failed: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  async exists(key) {
    const response = await fetch(this.url(key), { method: 'HEAD', headers: this.signedHeaders('HEAD', key, Buffer.alloc(0)) });
    return response.ok;
  }
}

export function createArchiveBackend(policy, env = process.env) {
  const archive = policy?.archive ?? {};
  if (!archive.enabled) throw new Error('archiving is disabled by policy');
  if (archive.backend === 's3') {
    return new S3ArchiveBackend({
      endpoint: archive.endpoint ?? env.VITAL_ARCHIVE_S3_ENDPOINT,
      bucket: archive.bucket ?? env.VITAL_ARCHIVE_S3_BUCKET,
      prefix: archive.prefix ?? env.VITAL_ARCHIVE_S3_PREFIX ?? '',
      region: env.VITAL_ARCHIVE_S3_REGION ?? 'us-east-1',
      accessKeyId: env.VITAL_ARCHIVE_S3_ACCESS_KEY_ID,
      secretAccessKey: env.VITAL_ARCHIVE_S3_SECRET_ACCESS_KEY,
      sessionToken: env.VITAL_ARCHIVE_S3_SESSION_TOKEN ?? null,
    });
  }
  return new LocalArchiveBackend({ root: archive.path ?? env.VITAL_ARCHIVE_DIR ?? 'archives' });
}

async function retry(operation, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await operation(); } catch (error) { lastError = error; }
  }
  throw lastError;
}

export async function archiveWeek({ target, domainDir, week, policy, backend = null, attempts = 3 }) {
  assertArchivableTarget(target);
  if (!policy?.archive?.enabled) throw new Error(`archiving is disabled for ${target.key}`);
  const archive = buildArchive({ domainDir, domainKey: target.key, week, policy });
  if (archive.status !== 'complete') {
    throw new Error(`archive is incomplete (${archive.unresolvedStubs.length} unresolved dependency/ies); refusing to publish`);
  }
  const client = backend ?? createArchiveBackend(policy);
  const key = archiveObjectKey({ domainKey: target.key, week, prefix: policy.archive.prefix ?? '' });
  const uploaded = await retry(() => client.put(key, archive.zip), attempts);
  const downloaded = await retry(() => client.get(key), attempts);
  const verified = verifyArchive(downloaded, { expectedSha256: uploaded.sha256 });
  if (!verified.ok) throw new Error(`archive verification failed for ${key}: ${verified.errors.join('; ')}`);
  return { ...archive, key, uploaded, verified };
}
