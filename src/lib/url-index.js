import fs from 'node:fs';
import path from 'node:path';
import { resolvePageRecord } from './page-records.js';

export const URL_INDEX_SCHEMA_VERSION = '1';

function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function extractWcagRefs(tags) {
  return (tags ?? [])
    .filter((t) => /^wcag\d{3,}$/.test(t))
    .map((t) => {
      const d = t.slice(4);
      if (d.length === 3) return `${d[0]}.${d[1]}.${d[2]}`;
      if (d.length === 4) return `${d[0]}.${d[1]}.${d[2]}${d[3]}`;
      return d;
    })
    .filter((v, i, a) => a.indexOf(v) === i);
}

/**
 * Build a per-URL violation index from the latest week's page records.
 * Covers axe-core, Alfa, and deprecated-html engines.
 * Returns null when the pages directory doesn't exist for the given week.
 */
export function buildUrlIndex(domainDir, domain, week) {
  const pagesDir = path.join(domainDir, week, 'pages');
  if (!fs.existsSync(pagesDir)) return null;

  const pages = [];

  for (const file of fs.readdirSync(pagesDir).filter((f) => f.endsWith('.json'))) {
    const rec = resolvePageRecord(domainDir, JSON.parse(fs.readFileSync(path.join(pagesDir, file), 'utf8')));
    const violations = [];

    for (const [ruleId, v] of Object.entries(rec.axe?.violations ?? {})) {
      violations.push({
        engine: 'axe-core',
        rule_id: ruleId,
        severity: capitalize(v.impact),
        count: v.count,
        help: v.help ?? '',
        help_url: v.helpUrl ?? null,
        wcag: extractWcagRefs(v.tags),
        examples: (v.examples ?? []).slice(0, 3).map((e) => ({
          target: e.target ?? '',
          html: e.html ?? '',
        })),
      });
    }

    for (const [ruleId, v] of Object.entries(rec.alfa?.failed ?? {})) {
      violations.push({
        engine: 'alfa',
        rule_id: ruleId,
        severity: null,
        count: v.count,
        help: null,
        help_url: v.ruleUrl ?? null,
        wcag: [],
        examples: (v.examples ?? []).slice(0, 3).map((e) => ({
          target: e.target ?? '',
          html: '',
        })),
      });
    }

    for (const [ruleId, v] of Object.entries(rec.deprecatedHtml?.findings ?? {})) {
      violations.push({
        engine: 'deprecated-html',
        rule_id: ruleId,
        severity: 'Moderate',
        count: v.count,
        help: v.help ?? '',
        help_url: null,
        wcag: [],
        examples: (v.examples ?? []).slice(0, 3).map((e) => ({
          target: e.target ?? '',
          html: e.html ?? '',
        })),
      });
    }

    pages.push({
      url: rec.url,
      status: rec.status ?? 200,
      scanned_at: rec.scannedAt ?? null,
      violations,
    });
  }

  return {
    schema_version: URL_INDEX_SCHEMA_VERSION,
    domain,
    week,
    generated_at: new Date().toISOString(),
    pages,
  };
}

export function writeUrlIndex(apiBase, domainKey, index) {
  const dir = path.join(apiBase, domainKey);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'url-index.json'), JSON.stringify(index));
}
