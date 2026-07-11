import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactUrl, deepRedactUrls } from './api-redact.js';

export const SCHEMA_VERSION = '1';

// Public JSON Schemas live under src/api/schema/ (checked in) and are copied
// into docs/api/v1/schema/ at build time so consumers can validate responses.
const SCHEMA_SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'api', 'schema');
const SCHEMA_FILES = ['index.schema.json', 'snapshot.schema.json', 'findings.schema.json'];

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

function apiTopActions(summary, denyParams = []) {
  const cc = summary?.componentClusters;
  if (!cc?.top_actions?.length) return null;
  const opts = { denyParams };
  return {
    design_system: cc.design_system ?? 'none',
    design_system_theme: cc.design_system_theme ?? null,
    generated_from_clusters: cc.total_clusters ?? cc.clusters?.length ?? 0,
    drift_page_count: cc.drift_page_count ?? cc.drift_pages?.length ?? 0,
    drift_pages: (cc.drift_pages ?? []).slice(0, 100).map((p) => ({
      url: redactUrl(p.url, opts),
      tokens: p.tokens ?? [],
      cluster_ids: p.cluster_ids ?? [],
      rule_keys: p.rule_keys ?? [],
    })),
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
  const topActionsCount = latestSummary.componentClusters?.top_actions?.length ?? 0;
  return {
    domain: target.domain,
    key: target.key,
    latest_week: latestSummary.week,
    pages_scanned: latestSummary.pagesScanned ?? 0,
    top_actions_count: topActionsCount,
    critical_count: counts.critical_count,
    serious_count: counts.serious_count,
    snapshot_url: `/api/v1/${target.key}/snapshot.json`,
    findings_url: `/api/v1/${target.key}/${latestSummary.week}/findings.json`,
  };
}

export function buildSnapshot(target, series, diffs, ledger, invSummary, latestBugs) {
  const latest = series[series.length - 1];
  const counts = severityCounts(latestBugs);
  const opts = { denyParams: target.api_redact_params ?? [] };
  // The weekly series carries internal summary objects with nested `url` fields
  // (component-cluster drift pages, etc.). Deep-redact so no URL escapes,
  // regardless of nesting depth.
  const weekly = deepRedactUrls({ series, diffs }, opts);
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
    top_actions: apiTopActions(latest, opts.denyParams),
    weekly,
  };
}

export function buildWeekFindings(target, summary, bugs, ledgerFindings) {
  return {
    schema_version: SCHEMA_VERSION,
    domain: target.domain,
    week: summary.week,
    generated_at: new Date().toISOString(),
    pages_scanned: summary.pagesScanned ?? 0,
    top_actions: apiTopActions(summary, target.api_redact_params ?? []),
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

  const schemaDir = path.join(apiBase, 'schema');
  fs.mkdirSync(schemaDir, { recursive: true });
  for (const name of SCHEMA_FILES) {
    fs.copyFileSync(path.join(SCHEMA_SRC_DIR, name), path.join(schemaDir, name));
  }

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
