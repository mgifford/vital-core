import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './config.js';
import { writeLedgerIfChanged } from './fs-utils.js';

/**
 * Per-domain ledger of third-party vendors (registrable domains) ever seen
 * serving resources to the site, with when each was first and last observed
 * and how many weeks it has appeared. Committed to
 * data/<domain>/third-parties.json so it accumulates across the domain's whole
 * history and survives page-detail pruning — answering "when did this vendor
 * first appear on the site?" and "is it new this week?".
 *
 * Each entry:
 *   origin       — registrable domain (e.g. googletagmanager.com)
 *   firstSeen    — ISO week first observed
 *   lastSeen     — ISO week most recently observed
 *   weeksSeen    — distinct weeks observed
 *   isScriptVendor — whether it has ever served a script
 */

function ledgerPath(domainKey) {
  return path.join(DIRS.data, domainKey, 'third-parties.json');
}

export function loadThirdPartyLedger(domainKey, domain) {
  const p = ledgerPath(domainKey);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  return { domain, updatedAt: null, vendors: {} };
}

export function saveThirdPartyLedger(domainKey, ledger) {
  writeLedgerIfChanged(ledgerPath(domainKey), ledger);
}

/**
 * Merge one week's vendor list into the ledger. `vendors` is the rollup's
 * vendor array ([{ origin, isScriptVendor, ... }]). Returns the same list
 * annotated with firstSeen/lastSeen/weeksSeen so reports can flag new vendors.
 * Idempotent per week.
 */
export function updateThirdPartyLedger(ledger, week, vendors) {
  for (const v of vendors) {
    const existing = ledger.vendors[v.origin];
    if (!existing) {
      ledger.vendors[v.origin] = {
        firstSeen: week,
        lastSeen: week,
        _weeks: [week],
        weeksSeen: 1,
        isScriptVendor: !!v.isScriptVendor,
      };
    } else {
      const weeks = new Set(existing._weeks ?? [existing.firstSeen]);
      weeks.add(week);
      existing._weeks = [...weeks].sort();
      existing.weeksSeen = existing._weeks.length;
      existing.firstSeen = existing._weeks[0];
      if (week >= existing.lastSeen) existing.lastSeen = week;
      existing.isScriptVendor = existing.isScriptVendor || !!v.isScriptVendor;
    }
  }
  return vendors.map((v) => ({ ...v, ...ledger.vendors[v.origin] }));
}
