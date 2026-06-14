import fs from 'node:fs';
import path from 'node:path';

/**
 * CSV exports of the pages affected by each finding, so a developer can
 * pull the full list of URLs to reproduce and fix an issue — the report
 * shows a few examples and links to the complete CSV.
 *
 * Files are written under docs/reports/<domain>/<week>/csv/. Filenames
 * are slugged from the rule id so they're stable and linkable.
 */

const csvField = (s) => {
  const v = String(s ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

export function toCsv(headers, rows) {
  const lines = [headers.map(csvField).join(',')];
  for (const row of rows) lines.push(row.map(csvField).join(','));
  return lines.join('\n') + '\n';
}

/** Filesystem- and URL-safe slug for a rule id (e.g. "sia-r12", "color-contrast"). */
export function ruleSlug(engine, ruleId) {
  return `${engine}__${ruleId}`.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
}

/**
 * Write the resource inventory CSV (every linked/embedded non-HTML
 * resource: PDFs, docs, iframes, media) with type, pages it appears on,
 * and when it was first seen (from the resource ledger). Returns the
 * relative path "resources.csv".
 */
export function writeResourceCsv(repDir, resources, ledger) {
  const rows = resources.list.map((r) => {
    const led = ledger.resources[r.url];
    return [r.url, r.type, r.pages, led?.firstSeen ?? '', led?.lastSeen ?? ''];
  });
  fs.writeFileSync(path.join(repDir, 'resources.csv'), toCsv(['url', 'type', 'pages', 'first_seen', 'last_seen'], rows));
  return 'resources.csv';
}

/**
 * Write all CSVs for one domain/week into <repDir>/csv/. Returns a map of
 * { axeAll, alfaAll, byRule: { "<engine>:<ruleId>": "<relative csv path>" } }
 * so the report can link to each. Relative paths are from the report's
 * index.html (i.e. "csv/<file>.csv").
 */
export function writeCsvs(repDir, summary) {
  const csvDir = path.join(repDir, 'csv');
  fs.mkdirSync(csvDir, { recursive: true });
  const links = { axeAll: null, alfaAll: null, byRule: {} };

  const writeFile = (name, content) => {
    fs.writeFileSync(path.join(csvDir, name), content);
    return `csv/${name}`;
  };

  // "All pages with an axe violation" / "...Alfa failure".
  if (summary.pagesWithAxeList?.length) {
    links.axeAll = writeFile('axe-pages-with-violations.csv', toCsv(['url'], summary.pagesWithAxeList.map((u) => [u])));
  }
  if (summary.pagesWithAlfaList?.length) {
    links.alfaAll = writeFile('alfa-pages-with-failures.csv', toCsv(['url'], summary.pagesWithAlfaList.map((u) => [u])));
  }

  // Per-rule affected-page CSVs (axe, alfa, deprecated-html).
  const ruleSets = [
    ['axe-core', summary.axe?.rules],
    ['alfa', summary.alfa?.rules],
    ['deprecated-html', summary.deprecatedHtml?.rules],
  ];
  for (const [engine, rules] of ruleSets) {
    for (const [ruleId, rule] of Object.entries(rules ?? {})) {
      if (!rule.affectedPages?.length) continue;
      const name = `${ruleSlug(engine, ruleId)}.csv`;
      const rows = rule.affectedPages.map((p) => [p.url, p.instances]);
      links.byRule[`${engine}:${ruleId}`] = writeFile(name, toCsv(['url', 'instances'], rows));
    }
  }
  return links;
}
