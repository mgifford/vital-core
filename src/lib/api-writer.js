import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = '1';

function severityCounts(bugs) {
  let critical_count = 0;
  let serious_count = 0;
  let moderate_count = 0;
  let minor_count = 0;
  for (const b of bugs) {
    if (b.severity === 'Critical') critical_count++;
    else if (b.severity === 'Serious') serious_count++;
    else if (b.severity === 'Moderate') moderate_count++;
    else if (b.severity === 'Minor') minor_count++;
  }
  return { critical_count, serious_count, moderate_count, minor_count, total_findings: bugs.length };
}

function deriveTrend(bug, ledgerEntry) {
  const weeks = bug.weeks_seen ?? 1;
  const firstSeen = bug.first_seen ?? null;
  const currentWeek = bug.last_seen ?? null;
  if (weeks <= 1 || firstSeen === currentWeek) return 'new';
  const current = bug.frequency.pages_affected;
  const prev = ledgerEntry?.lastPagesAffected ?? null;
  if (prev === null) return 'persistent';
  if (current > prev) return 'worsening';
  if (current < prev) return 'improving';
  return 'persistent';
}

function apiTopActions(summary) {
  const cc = summary?.componentClusters;
  if (!cc?.top_actions?.length) return null;
  return {
    design_system: cc.design_system ?? 'none',
    design_system_theme: cc.design_system_theme ?? null,
    generated_from_clusters: cc.total_clusters ?? cc.clusters?.length ?? 0,
    queue: cc.top_actions.slice(0, 10).map((a) => ({
      action_id: a.id,
      rule_id: a.rule_id,
      engine: a.engine_key,
      severity: a.severity,
      pages_affected: a.pages_affected,
      findings: a.instances,
      action_score: a.action_score,
      representative_selector: a.representative_selector ?? a.selector_path ?? null,
      representative_snippet: a.representative_snippet ?? null,
      design_components: a.design_components ?? [],
      drift: !!a.drift,
      estimated_fix_impact: a.estimated_fix_impact ?? null,
    })),
  };
}

export function buildIndexEntry(target, latestSummary, bugs) {
  const counts = severityCounts(bugs);
  return {
    domain: target.domain,
    key: target.key,
    latest_week: latestSummary.week,
    pages_scanned: latestSummary.pagesScanned ?? 0,
    critical_count: counts.critical_count,
    serious_count: counts.serious_count,
    snapshot_url: `/api/v1/${target.key}/snapshot.json`,
    findings_url: `/api/v1/${target.key}/${latestSummary.week}/findings.json`,
  };
}

export function buildSnapshot(target, series, diffs, ledger, invSummary, latestBugs) {
  const latest = series[series.length - 1];
  const counts = severityCounts(latestBugs);
  return {
    schema_version: SCHEMA_VERSION,
    domain: target.domain,
    key: target.key,
    generated_at: new Date().toISOString(),
    latest_week: latest.week,
    summary: {
      ...counts,
      pages_scanned: latest.pagesScanned ?? 0,
    },
    inventory: invSummary ?? null,
    findings: ledger.findings ?? {},
    tech_findings: latest.techFindings?.associations ?? null,
    top_actions: apiTopActions(latest),
    weekly: { series, diffs },
  };
}

export function buildWeekFindings(target, summary, bugs, ledgerFindings) {
  return {
    schema_version: SCHEMA_VERSION,
    domain: target.domain,
    week: summary.week,
    generated_at: new Date().toISOString(),
    pages_scanned: summary.pagesScanned ?? 0,
    top_actions: apiTopActions(summary),
    findings: bugs.map(b => {
      const ledgerEntry = ledgerFindings?.[b.pattern_id] ?? null;
      return {
        finding_id:     b.pattern_id,
        rule_id:        b.rule_id,
        rule_label:     b.rule_label,
        engine:         b.engine_key,
        severity:       b.severity,
        wcag_sc:        b.wcag_sc ?? null,
        wcag_level:     b.wcag_level ?? null,
        pages_affected: b.frequency.pages_affected,
        trend_status:   deriveTrend(b, ledgerEntry),
        first_seen:     b.first_seen ?? null,
        last_seen:      b.last_seen ?? null,
        weeks_seen:     b.weeks_seen ?? 1,
      };
    }),
  };
}

export function writeApiFiles(docsDir, indexEntries, snapshots, weekFindings) {
  const apiBase = path.join(docsDir, 'api', 'v1');

  fs.mkdirSync(apiBase, { recursive: true });
  fs.writeFileSync(
    path.join(apiBase, 'index.json'),
    JSON.stringify({ schema_version: SCHEMA_VERSION, domains: indexEntries }, null, 1)
  );

  for (const { key, data } of snapshots) {
    const dir = path.join(apiBase, key);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(data, null, 1));
  }

  for (const { key, week, data } of weekFindings) {
    const dir = path.join(apiBase, key, week);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'findings.json'), JSON.stringify(data, null, 1));
  }
}
