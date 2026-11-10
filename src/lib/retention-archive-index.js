/**
 * Durable metadata for weekly evidence archives.
 *
 * The index lives beside the domain data (data/<domain>/archives.json) and is
 * additive: it records where verified evidence went. It never removes source
 * weeks and never authorizes pruning. Static reports and the API read it;
 * an operator can inspect/repair it without touching the ZIPs.
 */

import fs from 'node:fs';
import path from 'node:path';

export const ARCHIVE_INDEX_SCHEMA_VERSION = 1;
const MAX_ENTRIES = 1000;

export function archiveIndexPath(domainDir) {
  return path.join(domainDir, 'archives.json');
}

export function emptyArchiveIndex(domainKey) {
  return {
    schema_version: ARCHIVE_INDEX_SCHEMA_VERSION,
    domain: domainKey,
    updated_at: null,
    archives: [],
  };
}

export function readArchiveIndex(domainDir, domainKey = null) {
  const file = archiveIndexPath(domainDir);
  if (!fs.existsSync(file)) return emptyArchiveIndex(domainKey);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed.schema_version !== ARCHIVE_INDEX_SCHEMA_VERSION) return emptyArchiveIndex(domainKey);
    return {
      schema_version: ARCHIVE_INDEX_SCHEMA_VERSION,
      domain: parsed.domain ?? domainKey,
      updated_at: parsed.updated_at ?? null,
      archives: Array.isArray(parsed.archives) ? parsed.archives.slice(0, MAX_ENTRIES) : [],
    };
  } catch {
    return emptyArchiveIndex(domainKey);
  }
}

export function writeArchiveIndex(domainDir, index) {
  fs.mkdirSync(domainDir, { recursive: true });
  const payload = {
    schema_version: ARCHIVE_INDEX_SCHEMA_VERSION,
    domain: index.domain,
    updated_at: new Date().toISOString(),
    archives: [...(index.archives ?? [])]
      .sort((a, b) => String(a.week).localeCompare(String(b.week)))
      .slice(-MAX_ENTRIES),
  };
  const file = archiveIndexPath(domainDir);
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(temp, file);
  return payload;
}

export function addMonths(date, months) {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function archiveExpiry(publishedAt, retentionMonths) {
  if (retentionMonths === 'indefinite') return null;
  if (!Number.isInteger(retentionMonths) || retentionMonths < 0) return null;
  return addMonths(new Date(publishedAt), retentionMonths).toISOString();
}

/**
 * Availability is computed at read time so an unchanged index naturally moves
 * from available to expired without a rewrite.
 */
export function archiveState(entry, now = new Date()) {
  if (!entry || !entry.key) return 'missing';
  if (entry.status === 'incomplete') return 'incomplete';
  if (entry.status !== 'complete') return 'missing';
  if (entry.expires_at && new Date(entry.expires_at).getTime() <= now.getTime()) return 'expired';
  return 'available';
}

export function withArchiveState(index, now = new Date()) {
  const entries = (index?.archives ?? []).map((entry) => ({ ...entry, state: archiveState(entry, now) }));
  const counts = entries.reduce((acc, entry) => {
    acc[entry.state] = (acc[entry.state] ?? 0) + 1;
    return acc;
  }, {});
  return {
    schema_version: ARCHIVE_INDEX_SCHEMA_VERSION,
    domain: index?.domain ?? null,
    updated_at: index?.updated_at ?? null,
    archives: entries,
    counts,
  };
}

export function upsertArchiveEntry(index, entry) {
  const base = index ?? emptyArchiveIndex(entry.domain);
  const next = [...(base.archives ?? [])];
  const at = next.findIndex((candidate) => candidate.week === entry.week);
  if (at >= 0) next[at] = { ...next[at], ...entry };
  else next.push(entry);
  return { ...base, archives: next };
}

export function recordVerifiedArchive(domainDir, { domain, week, key, backend, archiveId, zipSha256, bytes, publishedAt = new Date().toISOString(), retentionMonths, publicUrl = null }) {
  const current = readArchiveIndex(domainDir, domain);
  const entry = {
    week,
    key,
    backend,
    archive_id: archiveId,
    zip_sha256: zipSha256,
    bytes,
    status: 'complete',
    published_at: publishedAt,
    expires_at: archiveExpiry(publishedAt, retentionMonths),
    ...(publicUrl ? { public_url: publicUrl } : {}),
  };
  return writeArchiveIndex(domainDir, upsertArchiveEntry(current, { domain, ...entry }));
}

/** Write the machine-readable archive index used by static API consumers. */
export function writeArchiveApi(docsDir, domainIndexes, generatedAt = new Date().toISOString()) {
  const apiBase = path.join(docsDir, 'api', 'v1');
  fs.mkdirSync(path.join(apiBase, 'archives'), { recursive: true });
  const domains = [];
  for (const index of domainIndexes) {
    const state = withArchiveState(index);
    const dir = path.join(apiBase, index.domain);
    fs.mkdirSync(dir, { recursive: true });
    const data = {
      schema_version: ARCHIVE_INDEX_SCHEMA_VERSION,
      domain: index.domain,
      generated_at: generatedAt,
      updated_at: index.updated_at,
      counts: state.counts,
      archives: state.archives,
    };
    fs.writeFileSync(path.join(dir, 'archives.json'), `${JSON.stringify(data, null, 1)}\n`);
    domains.push({
      domain: index.domain,
      counts: state.counts,
      url: `/api/v1/${index.domain}/archives.json`,
    });
  }
  fs.writeFileSync(path.join(apiBase, 'archives', 'index.json'), `${JSON.stringify({
    schema_version: ARCHIVE_INDEX_SCHEMA_VERSION,
    generated_at: generatedAt,
    domains,
  }, null, 1)}\n`);
}
