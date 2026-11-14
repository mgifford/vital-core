/**
 * Compact last-observation index for every discovered URL.
 *
 * The crawl state is the authority for discovered URLs; this index preserves a
 * durable, bounded view of the last attempt/success after page detail is pruned.
 * It is additive metadata, never a conformance claim. `clean` means only that
 * the automated engines that ran found no finding; it is null when no automated
 * audit ran.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './config.js';

const SCHEMA_VERSION = 1;
const MAX_URLS = 100000;

export function observationsPath(domainKey, dataRoot = DIRS.data) {
  return path.join(dataRoot, domainKey, 'observations.json');
}

export function emptyObservations(domain) {
  return { schema_version: SCHEMA_VERSION, domain: domain ?? null, updated_at: null, urls: {} };
}

export function loadObservations(domainKey, domain = null, { dataRoot = DIRS.data } = {}) {
  const file = observationsPath(domainKey, dataRoot);
  if (!fs.existsSync(file)) return emptyObservations(domain);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed.schema_version !== SCHEMA_VERSION || !parsed.urls || typeof parsed.urls !== 'object') {
      return emptyObservations(domain);
    }
    return { ...emptyObservations(domain), ...parsed, domain: parsed.domain ?? domain };
  } catch {
    return emptyObservations(domain);
  }
}

function writeObservations(domainKey, index, dataRoot = DIRS.data) {
  const file = observationsPath(domainKey, dataRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entries = Object.entries(index.urls)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, MAX_URLS);
  const payload = {
    schema_version: SCHEMA_VERSION,
    domain: index.domain,
    updated_at: new Date().toISOString(),
    urls: Object.fromEntries(entries),
  };
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(payload, null, 1)}\n`);
  fs.renameSync(temp, file);
  return payload;
}

function statusOutcome(status) {
  if (status === null || status === undefined) return 'never_scanned';
  if (Number.isInteger(status) && status >= 200 && status < 300) return 'success';
  if ([401, 403, 429, 202].includes(status)) return 'blocked';
  if (Number.isInteger(status) && status >= 300 && status < 400) return 'redirect';
  return 'failed';
}

function hasAutomatedFinding(record) {
  return Object.keys(record?.axe?.violations ?? {}).length > 0 ||
    Object.keys(record?.alfa?.failed ?? {}).length > 0;
}

function isAudited(record) {
  return Boolean(record?.axe || record?.alfa);
}

export function syncObservationsFromState(domainKey, domain, state, week, { dataRoot = DIRS.data } = {}) {
  const current = loadObservations(domainKey, domain, { dataRoot });
  const urls = { ...current.urls };
  for (const [pageId, page] of Object.entries(state.pages ?? {})) {
    if (!page?.url) continue;
    const existing = urls[pageId] ?? {};
    const status = page.lastStatus ?? null;
    const outcome = statusOutcome(status);
    const lastAttempt = page.lastScannedAt ?? existing.last_attempt_at ?? null;
    const success = outcome === 'success' ? lastAttempt : existing.last_success_at ?? null;
    urls[pageId] = {
      ...existing,
      page_id: pageId,
      url: page.url,
      first_discovered_at: existing.first_discovered_at ?? page.discoveredAt ?? null,
      last_attempt_at: lastAttempt,
      last_success_at: success,
      last_status: status,
      last_week: page.lastScannedWeek ?? existing.last_week ?? null,
      outcome,
      fail_count: page.failCount ?? existing.fail_count ?? 0,
      ...(Object.hasOwn(existing, 'clean') ? { clean: existing.clean } : { clean: null }),
      ...(existing.first_finding_at ? { first_finding_at: existing.first_finding_at } : {}),
      last_failed_week: page.lastFailedWeek ?? existing.last_failed_week ?? null,
    };
  }
  return writeObservations(domainKey, { ...current, domain, urls, _week: week }, dataRoot);
}

/**
 * Enrich the index from retained page records. This is the only place `clean`
 * is set: an audited page with no axe/Alfa failure is clean *for those engines*,
 * not a claim of WCAG conformance.
 */
export function syncObservationsFromRecords(domainKey, domain, records, { dataRoot = DIRS.data } = {}) {
  const current = loadObservations(domainKey, domain, { dataRoot });
  const urls = { ...current.urls };
  for (const record of records) {
    if (!record?.url || !record.pageId) continue;
    const status = Number.isInteger(record.status) ? record.status : null;
    const outcome = statusOutcome(status);
    const existing = urls[record.pageId] ?? {};
    const audited = isAudited(record);
    const finding = hasAutomatedFinding(record);
    urls[record.pageId] = {
      ...existing,
      page_id: record.pageId,
      url: record.url,
      first_discovered_at: existing.first_discovered_at ?? record.scannedAt ?? null,
      last_attempt_at: record.scannedAt ?? existing.last_attempt_at ?? null,
      last_success_at: outcome === 'success' ? (record.scannedAt ?? existing.last_success_at ?? null) : existing.last_success_at ?? null,
      last_status: status ?? existing.last_status ?? null,
      last_week: record.week ?? existing.last_week ?? null,
      outcome,
      fail_count: existing.fail_count ?? 0,
      clean: audited ? !finding : (Object.hasOwn(existing, 'clean') ? existing.clean : null),
      ...(finding ? { first_finding_at: existing.first_finding_at ?? record.scannedAt ?? null } : {}),
      ...(existing.first_finding_at && !finding ? { first_finding_at: existing.first_finding_at } : {}),
    };
  }
  return writeObservations(domainKey, { ...current, domain, urls }, dataRoot);
}

export function withObservationFreshness(index, { now = new Date(), staleDays = 30 } = {}) {
  const cutoff = now.getTime() - staleDays * 86400000;
  const urls = Object.values(index?.urls ?? {}).map((entry) => {
    const lastSuccess = entry.last_success_at ? Date.parse(entry.last_success_at) : null;
    return {
      ...entry,
      stale: lastSuccess != null ? lastSuccess < cutoff : null,
      never_scanned: entry.outcome === 'never_scanned',
      clean_without_automated_findings: entry.clean === true,
    };
  });
  const counts = urls.reduce((acc, entry) => {
    const outcome = entry.outcome ?? 'unknown';
    acc[outcome] = (acc[outcome] ?? 0) + 1;
    if (entry.stale) acc.stale = (acc.stale ?? 0) + 1;
    if (entry.clean_without_automated_findings) acc.clean_without_automated_findings = (acc.clean_without_automated_findings ?? 0) + 1;
    return acc;
  }, {});
  return { schema_version: SCHEMA_VERSION, domain: index?.domain ?? null, updated_at: index?.updated_at ?? null, counts, urls };
}

export function observationSummary(index, options) {
  const { counts } = withObservationFreshness(index, options);
  return { total_urls: Object.keys(index?.urls ?? {}).length, ...counts };
}
