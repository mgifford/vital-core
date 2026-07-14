import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './config.js';
import { writeLedgerIfChanged } from './fs-utils.js';

/**
 * Per-domain inventory of embedded/linked non-HTML resources (PDFs,
 * Office docs, iframes, embedded media, etc.), with when each was first
 * and last seen. This is what lets a site owner answer "what PDFs does
 * my site have?" and "what was added in the last week?" — the latter is
 * any resource whose firstSeen is the current week.
 *
 * Committed to data/<domain>/resources.json so it accumulates across the
 * domain's whole history and survives page-detail pruning. Mirrors the
 * findings ledger.
 */

function ledgerPath(domainKey) {
  return path.join(DIRS.data, domainKey, 'resources.json');
}

export function loadResourceLedger(domainKey, domain) {
  const p = ledgerPath(domainKey);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  return { domain, updatedAt: null, resources: {} };
}

export function saveResourceLedger(domainKey, ledger) {
  writeLedgerIfChanged(ledgerPath(domainKey), ledger);
}

/**
 * Merge one week's resource list into the ledger. `list` is
 * [{ url, type, pages }]. Returns the set of URLs that are new this week
 * (firstSeen === week) so the report can show "added this week".
 * Idempotent per week.
 */
export function updateResourceLedger(ledger, week, list) {
  const newThisWeek = [];
  for (const r of list) {
    const existing = ledger.resources[r.url];
    if (!existing) {
      ledger.resources[r.url] = {
        type: r.type,
        firstSeen: week,
        lastSeen: week,
        _weeks: [week],
        weeksSeen: 1,
        lastPages: r.pages,
      };
      newThisWeek.push({ url: r.url, type: r.type });
    } else {
      const weeks = new Set(existing._weeks ?? [existing.firstSeen]);
      weeks.add(week);
      existing._weeks = [...weeks].sort();
      existing.weeksSeen = existing._weeks.length;
      existing.firstSeen = existing._weeks[0];
      if (week >= existing.lastSeen) {
        existing.lastSeen = week;
        existing.lastPages = r.pages;
        existing.type = r.type;
      }
      if (existing.firstSeen === week) newThisWeek.push({ url: r.url, type: r.type });
    }
  }
  return newThisWeek;
}
