#!/usr/bin/env node
/**
 * query-db.mjs — CLI tool for running common analytics queries against dist/vital.db.
 *
 * Usage:
 *   node scripts/query-db.mjs [--db <path>] <command>
 *
 * Commands:
 *   last-7-days        Violations detected on pages scanned in the last 7 days
 *   new-errors         Errors on URLs along with the first run that recorded them
 *   tech-stack         Technology stack pivot: technologies ranked by page count
 *   summary            High-level run summary (total runs, pages, violations)
 *   recent-runs [N]    List the N most recent runs (default: 10)
 *
 * Options:
 *   --db <path>        Path to the SQLite database (default: dist/vital.db)
 *   --days <N>         Number of days to look back for last-7-days (default: 7)
 *   --limit <N>        Maximum rows to return (default: 50)
 *   --target <id>      Filter results to a specific target ID
 *   --json             Output results as JSON instead of a table
 *
 * Examples:
 *   node scripts/query-db.mjs last-7-days
 *   node scripts/query-db.mjs new-errors --limit 100
 *   node scripts/query-db.mjs tech-stack --target cms-gov
 *   node scripts/query-db.mjs summary --json
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getFlag(name, defaultValue) {
  const idx = args.indexOf(name);
  if (idx === -1) return defaultValue;
  return args[idx + 1] ?? defaultValue;
}

function hasFlag(name) {
  return args.includes(name);
}

const dbPath = path.resolve(process.cwd(), getFlag('--db', 'dist/vital.db'));
const days = Number.parseInt(getFlag('--days', '7'), 10);
const limit = Number.parseInt(getFlag('--limit', '50'), 10);
const targetFilter = getFlag('--target', null);
const jsonOutput = hasFlag('--json');

// Remaining positional arg is the command
const command = args.find(a => !a.startsWith('--') && a !== getFlag('--db', null) && a !== getFlag('--days', null) && a !== getFlag('--limit', null) && a !== getFlag('--target', null));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openDb() {
  if (!existsSync(dbPath)) {
    console.error(`❌  Database not found: ${dbPath}`);
    console.error('   Run a scan first, or set --db to the correct path.');
    process.exit(1);
  }
  return new DatabaseSync(dbPath, { readOnly: true });
}

function printTable(rows) {
  if (rows.length === 0) {
    console.log('(no results)');
    return;
  }
  if (jsonOutput) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  const cols = Object.keys(rows[0]);
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)));
  const header = cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  const sep = widths.map(w => '-'.repeat(w)).join('  ');
  console.log(header);
  console.log(sep);
  for (const row of rows) {
    console.log(cols.map((c, i) => String(row[c] ?? '').padEnd(widths[i])).join('  '));
  }
  console.log(`\n(${rows.length} row${rows.length === 1 ? '' : 's'})`);
}

function addTargetFilter(sql, paramName = 'target_id') {
  return targetFilter ? `${sql} AND ${paramName} = '${targetFilter.replace(/'/g, "''")}'` : sql;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdLastNDays(db) {
  console.log(`\n🔍  Violations on pages scanned in the last ${days} day(s):\n`);
  let sql = `
    SELECT
      p.target_id,
      p.url,
      p.scanned_at,
      v.rule_id,
      v.impact,
      v.message,
      v.selector
    FROM violations v
    JOIN pages p ON v.page_id = p.id
    WHERE p.scanned_at > datetime('now', '-${days} days')
  `;
  sql = addTargetFilter(sql, 'p.target_id');
  sql += ` ORDER BY p.scanned_at DESC, p.url, v.rule_id LIMIT ${limit}`;
  const rows = db.prepare(sql).all();
  printTable(rows);
}

function cmdNewErrors(db) {
  console.log('\n🆕  New errors — earliest run per (URL, rule):\n');
  let sql = `
    SELECT
      p.target_id,
      v.rule_id,
      v.impact,
      p.url,
      MIN(p.scanned_at) AS first_seen,
      COUNT(DISTINCT p.run_id) AS runs_with_error
    FROM violations v
    JOIN pages p ON v.page_id = p.id
  `;
  if (targetFilter) {
    sql += ` WHERE p.target_id = '${targetFilter.replace(/'/g, "''")}'`;
  }
  sql += `
    GROUP BY p.target_id, v.rule_id, p.url
    ORDER BY first_seen DESC
    LIMIT ${limit}
  `;
  const rows = db.prepare(sql).all();
  printTable(rows);
}

function cmdTechStack(db) {
  console.log('\n🛠   Technology stack — pages per technology:\n');
  let baseFilter = targetFilter ? `WHERE p.target_id = '${targetFilter.replace(/'/g, "''")}'` : '';
  const sql = `
    SELECT
      t.value              AS technology,
      COUNT(DISTINCT p.url) AS page_count,
      COUNT(DISTINCT p.target_id) AS target_count
    FROM pages p, json_each(p.technologies) t
    ${baseFilter}
    GROUP BY t.value
    ORDER BY page_count DESC
    LIMIT ${limit}
  `;
  try {
    const rows = db.prepare(sql).all();
    printTable(rows);
  } catch (err) {
    console.error('❌  json_each query failed (pages may have no technology data):', err.message);
  }
}

function cmdSummary(db) {
  console.log('\n📊  Database summary:\n');
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM runs)            AS total_runs,
      (SELECT COUNT(*) FROM pages)           AS total_pages,
      (SELECT COUNT(*) FROM violations)      AS total_violations,
      (SELECT COUNT(*) FROM url_history)     AS tracked_urls,
      (SELECT MIN(generated_at) FROM runs)   AS earliest_run,
      (SELECT MAX(generated_at) FROM runs)   AS latest_run
  `).get();
  printTable([stats]);

  console.log('\n📈  Quality gate breakdown:\n');
  const gates = db.prepare(`
    SELECT quality_gate_status, COUNT(*) AS run_count
    FROM runs
    GROUP BY quality_gate_status
    ORDER BY run_count DESC
  `).all();
  printTable(gates);

  console.log('\n🔥  Top 10 most-violated rules (all time):\n');
  let topRulesSql = `
    SELECT
      v.rule_id,
      v.impact,
      COUNT(*) AS instance_count,
      COUNT(DISTINCT p.url) AS affected_pages
    FROM violations v
    JOIN pages p ON v.page_id = p.id
  `;
  if (targetFilter) {
    topRulesSql += ` WHERE p.target_id = '${targetFilter.replace(/'/g, "''")}'`;
  }
  topRulesSql += `
    GROUP BY v.rule_id, v.impact
    ORDER BY instance_count DESC
    LIMIT 10
  `;
  const topRules = db.prepare(topRulesSql).all();
  printTable(topRules);
}

function cmdRecentRuns(db) {
  const n = Number.isFinite(limit) ? limit : 10;
  console.log(`\n📋  ${n} most recent runs:\n`);
  const rows = db.prepare(`
    SELECT
      run_id,
      generated_at,
      targets_scanned,
      pages_scanned,
      total_violations,
      quality_index_score,
      quality_gate_status,
      scan_duration_ms
    FROM runs
    ORDER BY generated_at DESC
    LIMIT ${n}
  `).all();
  printTable(rows);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (!command) {
  console.log(`
Usage: node scripts/query-db.mjs [--db <path>] <command>

Commands:
  last-7-days    Violations on pages scanned in the last N days (--days, default 7)
  new-errors     First scan recording each (URL, rule) combination
  tech-stack     Technology pivot ranked by page count
  summary        High-level totals and top violated rules
  recent-runs    List the most recent runs (--limit, default 50)

Options:
  --db <path>    Path to vital.db  (default: dist/vital.db)
  --days <N>     Look-back window  (default: 7)
  --limit <N>    Row limit         (default: 50)
  --target <id>  Filter to one target ID
  --json         Output as JSON
`);
  process.exit(0);
}

const db = openDb();
try {
  switch (command) {
    case 'last-7-days':
      cmdLastNDays(db);
      break;
    case 'new-errors':
      cmdNewErrors(db);
      break;
    case 'tech-stack':
      cmdTechStack(db);
      break;
    case 'summary':
      cmdSummary(db);
      break;
    case 'recent-runs':
      cmdRecentRuns(db);
      break;
    default:
      console.error(`❌  Unknown command: ${command}`);
      console.error('   Run without arguments to see available commands.');
      process.exit(1);
  }
} finally {
  db.close();
}
