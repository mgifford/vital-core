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
import { endOfIsoWeek } from './retention-week.js';

export const ARCHIVE_INDEX_SCHEMA_VERSION = 1;

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
      archives: Array.isArray(parsed.archives) ? parsed.archives : [],
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
      .sort((a, b) => String(a.week).localeCompare(String(b.week))),
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

export function archiveExpiry(weekOrPublishedAt, retentionMonths) {
  if (retentionMonths === 'indefinite') return null;
  if (!Number.isInteger(retentionMonths) || retentionMonths < 0) return null;
  const base = typeof weekOrPublishedAt === 'string' && /^\d{4}-W\d{2}$/.test(weekOrPublishedAt)
    ? endOfIsoWeek(weekOrPublishedAt)
    : new Date(weekOrPublishedAt);
  return addMonths(base, retentionMonths).toISOString();
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
  const existing = current.archives.find((candidate) => candidate.week === week);
  const entry = {
    week,
    key,
    backend,
    archive_id: archiveId,
    zip_sha256: zipSha256,
    bytes,
    status: 'complete',
    first_published_at: existing?.first_published_at ?? publishedAt,
    published_at: publishedAt,
    verified_at: new Date().toISOString(),
    retention_basis: 'end-of-scan-week',
    expires_at: archiveExpiry(week, retentionMonths),
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

/**
 * Read-only expiry plan. Expiry is metadata; it never proves an object was
 * removed and never authorizes deletion.
 */
export function archiveExpiryPlan(index, now = new Date()) {
  const archives = (index?.archives ?? []).map((entry) => {
    const state = archiveState(entry, now);
    return {
      week: entry.week,
      key: entry.key,
      state,
      expires_at: entry.expires_at ?? null,
      retention_basis: entry.retention_basis ?? 'publication-date',
      retention_expired: state === 'expired',
      physical_deletion_eligible: false,
      physical_deletion_performed: false,
      deletion_verified: false,
    };
  });
  return {
    domain: index?.domain ?? null,
    checked_at: now.toISOString(),
    destructive_actions_performed: 0,
    counts: archives.reduce((acc, entry) => {
      acc[entry.state] = (acc[entry.state] ?? 0) + 1;
      return acc;
    }, {}),
    archives,
  };
}
