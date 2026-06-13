import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './config.js';

/**
 * Per-domain findings ledger: a committed record of every unique finding
 * (by pattern_id) ever seen for a domain, with when it was first and last
 * observed. This is what lets a report say "this issue has been present
 * since week W12" or "last seen W20, now resolved".
 *
 * It's committed (data/<domain>/findings.json) so the history survives
 * page-level pruning and accumulates across the whole life of the scan,
 * not just the retention window.
 *
 * Shape:
 * {
 *   domain, updatedAt,
 *   findings: {
 *     "<pattern_id>": {
 *       engine, ruleId, summary, wcag, severity,
 *       firstSeen: "2026-W12", lastSeen: "2026-W24",
 *       weeksSeen: 7,
 *       lastPagesAffected: 12
 *     }
 *   }
 * }
 */

function ledgerPath(domainKey) {
  return path.join(DIRS.data, domainKey, 'findings.json');
}

export function loadFindings(domainKey, domain) {
  const p = ledgerPath(domainKey);
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  return { domain, updatedAt: null, findings: {} };
}

export function saveFindings(domainKey, ledger) {
  const p = ledgerPath(domainKey);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  ledger.updatedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(ledger, null, 1));
}

/**
 * Merge one week's bug reports into the ledger, updating first/last-seen.
 * `week` is the ISO week the reports are for. Returns a map of
 * pattern_id -> { firstSeen, lastSeen, weeksSeen } so callers (reports)
 * can annotate each finding with its history.
 *
 * Idempotent for a given week: re-running aggregate for the same week
 * does not double-count weeksSeen, because weeksSeen tracks distinct
 * weeks via a recorded set.
 */
export function updateFindings(ledger, week, reports) {
  for (const r of reports) {
    const id = r.pattern_id;
    const existing = ledger.findings[id];
    if (!existing) {
      ledger.findings[id] = {
        engine: r.tool,
        ruleId: r.rule_id,
        summary: r.summary,
        wcag: r.wcag_sc ?? null,
        severity: r.severity,
        firstSeen: week,
        lastSeen: week,
        _weeks: [week],
        weeksSeen: 1,
        lastPagesAffected: r.frequency.pages_affected,
      };
    } else {
      // Track distinct weeks (idempotent re-runs of the same week).
      const weeks = new Set(existing._weeks ?? [existing.firstSeen]);
      weeks.add(week);
      existing._weeks = [...weeks].sort();
      existing.weeksSeen = existing._weeks.length;
      existing.firstSeen = existing._weeks[0];
      // lastSeen is the latest week we've ever recorded this finding in.
      if (compareWeek(week, existing.lastSeen) >= 0) {
        existing.lastSeen = week;
        existing.lastPagesAffected = r.frequency.pages_affected;
        existing.severity = r.severity;
        existing.summary = r.summary;
      }
    }
  }

  // Return a lookup for annotating this week's reports.
  const lookup = {};
  for (const r of reports) {
    const f = ledger.findings[r.pattern_id];
    lookup[r.pattern_id] = { firstSeen: f.firstSeen, lastSeen: f.lastSeen, weeksSeen: f.weeksSeen };
  }
  return lookup;
}

/** Compare two ISO week strings ("2026-W24"). */
function compareWeek(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
