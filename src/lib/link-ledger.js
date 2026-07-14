import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './config.js';
import { writeLedgerIfChanged } from './fs-utils.js';

/**
 * Per-domain ledger of broken links, with when each was first and last
 * seen broken and how many weeks it has been broken.
 *
 * Committed to data/<domain>/broken-links.json so it accumulates across
 * the domain's whole history and survives page-detail pruning.
 *
 * Each entry:
 *   url          — the broken URL
 *   status       — HTTP status (or null for DNS/timeout)
 *   reason       — 'broken link' | 'dns' | 'timeout' | etc.
 *   firstSeen    — ISO week of first broken detection
 *   lastSeen     — ISO week of most recent broken detection
 *   weeksBroken  — how many distinct weeks the link was found broken
 *   foundOn      — last-known set of pages that link to it (capped)
 */

function ledgerPath(domainKey) {
  return path.join(DIRS.data, domainKey, 'broken-links.json');
}

export function loadLinkLedger(domainKey, domain) {
  const p = ledgerPath(domainKey);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  return { domain, updatedAt: null, links: {} };
}

export function saveLinkLedger(domainKey, ledger) {
  writeLedgerIfChanged(ledgerPath(domainKey), ledger);
}

/**
 * Merge one week's broken link list into the ledger.
 * `list` is [{ url, status, reason, foundOn: string[] }].
 * Returns the full ledger entry for each broken URL, annotated with
 * weeksBroken so callers can surface "broken for N weeks" in reports.
 * Idempotent per week.
 */
export function updateLinkLedger(ledger, week, list) {
  // Track which URLs are still broken this week; entries not in `list`
  // keep their existing lastSeen (they may have been fixed).
  for (const b of list) {
    const existing = ledger.links[b.url];
    if (!existing) {
      ledger.links[b.url] = {
        status: b.status ?? null,
        reason: b.reason ?? null,
        firstSeen: week,
        lastSeen: week,
        _weeks: [week],
        weeksBroken: 1,
        foundOn: (b.foundOn ?? []).slice(0, 10),
      };
    } else {
      const weeks = new Set(existing._weeks ?? [existing.firstSeen]);
      weeks.add(week);
      existing._weeks = [...weeks].sort();
      existing.weeksBroken = existing._weeks.length;
      existing.firstSeen = existing._weeks[0];
      if (week >= existing.lastSeen) {
        existing.lastSeen = week;
        existing.status = b.status ?? existing.status;
        existing.reason = b.reason ?? existing.reason;
        existing.foundOn = (b.foundOn ?? []).slice(0, 10);
      }
    }
  }
  // Return annotated entries for this week's broken links.
  return list.map((b) => ({ ...b, ...ledger.links[b.url] }));
}
