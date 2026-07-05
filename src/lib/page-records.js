import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Content fingerprint for a page record, excluding fields that vary even
 * when nothing meaningful changed (scannedAt, runId, week). Array-valued
 * engine outputs are sorted before hashing so crawl non-determinism in
 * ordering (e.g. resource/image discovery order) doesn't register as change.
 */
export function pageFingerprint(record) {
  const { pageId, url, week, runId, scannedAt, unchanged, since, fingerprint, ...content } = record;
  return crypto.createHash('sha256').update(canonicalize(content)).digest('hex').slice(0, 16);
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).sort().join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * If `record` is an "unchanged" stub (see scan.js), read the full record it
 * points to and splice in this stub's own week/runId/scannedAt/status so the
 * result is attributed to the right week. Returns `record` unchanged
 * otherwise. If the pointed-to week's detail has itself been pruned, returns
 * the stub as-is — callers already treat missing engine fields as "not run".
 *
 * `domainDir` is the domain's data directory (e.g. data/<domain-key>), same
 * convention as buildUrlIndex's `domainDir` param — callers already have it
 * on hand, so this module doesn't need to know about DIRS/VITAL_DATA_ROOT.
 */
export function resolvePageRecord(domainDir, record) {
  if (!record.unchanged) return record;
  const fullPath = path.join(domainDir, record.since, 'pages', `${record.pageId}.json`);
  if (!fs.existsSync(fullPath)) return record;
  const full = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  return { ...full, week: record.week, runId: record.runId, scannedAt: record.scannedAt, status: record.status };
}
