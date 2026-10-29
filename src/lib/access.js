import { protectionHints, describeNetworkError } from './probe.js';

/**
 * Whether a site lets the scanner in. At scan time detectBlock() tells a
 * firewall's challenge or refusal from the page itself, so it is recorded
 * as blocked and never audited (a challenge page scored as the site is
 * worse than no score). At aggregate time assessAccess() turns a week's page
 * records and run logs into the status the reports put up front.
 */

const REFUSALS = new Set([401, 403, 429]);

/** A share of attempted pages at or above this makes a site "partly blocked". */
export const PARTIAL_SHARE = 0.1;

/**
 * null for an ordinary response. HTTP 202 or a firewall action header is a
 * challenge; 401, 403 and 429 are refusals. `by` names what headers and
 * cookie names identify in front of the site.
 */
export function detectBlock({ status, headers = {}, cookies = [] } = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const challenge = status === 202 || !!h['x-amzn-waf-action'] || !!h['cf-mitigated'];
  if (!challenge && !REFUSALS.has(status)) return null;
  const by = protectionHints({ headers: h, cookies }).filter((n) => !n.startsWith('Drupal page cache'));
  return { kind: challenge ? 'challenge' : 'refusal', status, by };
}

/** Page records written before detectBlock() existed count by status. */
export function isBlockedRecord(rec) {
  return !!rec?.blocked || rec?.status === 202 || REFUSALS.has(rec?.status);
}

const recordedBlock = (rec) => rec.blocked ?? { kind: rec.status === 202 ? 'challenge' : 'refusal', status: rec.status, by: [] };

/** Blocked records keep their identity and status only, so no audit result from a challenge page is counted. */
export function withoutBlockedAudits(records) {
  return records.map((rec) => {
    if (!isBlockedRecord(rec)) return rec;
    const { pageId, url, week, runId, scannedAt, status, depth } = rec;
    return { pageId, url, week, runId, scannedAt, status, depth, blocked: recordedBlock(rec) };
  });
}

function firstLine(s) {
  return String(s ?? '').split('\n')[0].trim();
}

/**
 * A target's access for one week, from its page records and run logs:
 * `level` is `blocked` (nothing audited), `partial` (a firewall or
 * robots.txt stopped at least PARTIAL_SHARE of attempted pages), `ok`, or
 * `not-scanned` (no records and no runs).
 */
export function assessAccess({ records = [], runs = [] } = {}) {
  const blockedRecs = records.filter(isBlockedRecord);
  const audited = records.filter((r) => !isBlockedRecord(r) && (r.axe || r.alfa)).length;
  const firewall = { pages: blockedRecs.length, challenges: 0, refusals: 0, statuses: {}, by: [] };
  const by = new Set();
  for (const r of blockedRecs) {
    const b = recordedBlock(r);
    if (b.kind === 'refusal') firewall.refusals++;
    else firewall.challenges++;
    firewall.statuses[r.status] = (firewall.statuses[r.status] ?? 0) + 1;
    for (const n of b.by ?? []) by.add(n);
  }
  firewall.by = [...by];

  const errorStatuses = {};
  for (const r of records) {
    if (!isBlockedRecord(r) && typeof r.status === 'number' && r.status >= 400) {
      errorStatuses[r.status] = (errorStatuses[r.status] ?? 0) + 1;
    }
  }

  const ordered = [...runs].sort((a, b) => String(a.startedAt ?? '').localeCompare(String(b.startedAt ?? '')));
  const latest = ordered[ordered.length - 1];
  const robots = {
    rootBlocked: latest?.robots?.rootAllowed === false,
    skipped: runs.reduce((n, r) => n + (r.tally?.robots_skipped ?? 0), 0),
  };

  const failedRuns = ordered.filter((r) => {
    const t = r.tally ?? {};
    return (t.ok ?? 0) === 0 && (t.blocked ?? 0) === 0 && (t.timeout ?? 0) + (t.error ?? 0) > 0;
  });
  let connection = null;
  if (records.length === 0 && failedRuns.length) {
    const last = failedRuns[failedRuns.length - 1];
    const code = last.canonical?.homeError;
    const error = code
      ? (/^[A-Z0-9_]+$/.test(code) ? describeNetworkError(code) : code)
      : firstLine(last.errors?.[0]?.error) || null;
    connection = { runs: failedRuns.length, error };
  }

  const stopped = blockedRecs.length + robots.skipped;
  const attempted = records.length + robots.skipped;
  let level = 'ok';
  if (records.length === 0) level = connection || robots.skipped || robots.rootBlocked ? 'blocked' : 'not-scanned';
  else if (audited === 0) level = 'blocked';
  else if (stopped > 0 && stopped / attempted >= PARTIAL_SHARE) level = 'partial';

  return { level, audited, attempted, firewall, robots, connection, errorStatuses };
}
