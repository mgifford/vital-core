import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const profilePath = process.argv[2] || 'profiles/us-health.yml';
const outputDir = path.resolve(process.cwd(), 'dist/inventory');

function toHost(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function toCsv(rows) {
  if (!rows.length) {
    return '';
  }

  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];

  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }

  return lines.join('\n') + '\n';
}

function buildHostRows(targets) {
  const rows = [];

  for (const target of targets) {
    const seen = new Set();

    const sourceEntries = [
      { sourceType: 'base_url', value: target.base_url },
      { sourceType: 'sitemap_url', value: target.sitemap_url },
      ...(target.priority_urls || []).map((value) => ({ sourceType: 'priority_url', value }))
    ];

    for (const entry of sourceEntries) {
      const host = toHost(entry.value);
      if (!host) {
        continue;
      }

      const key = `${entry.sourceType}|${host}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      rows.push({
        targetId: target.id,
        targetName: target.name,
        sourceType: entry.sourceType,
        host,
        url: entry.value
      });
    }
  }

  return rows;
}

function buildTargetRows(targets) {
  return targets.map((target) => ({
    targetId: target.id,
    targetName: target.name,
    baseUrl: target.base_url || '',
    baseHost: toHost(target.base_url) || '',
    sitemapUrl: target.sitemap_url || '',
    sitemapHost: toHost(target.sitemap_url) || '',
    includePaths: (target.include_paths || []).join(';'),
    priorityUrls: (target.priority_urls || []).join(';'),
    maxPages: target.settings?.max_pages ?? '',
    maxTimeoutMs: target.settings?.maxTimeoutMs ?? '',
    postLoadDelay: target.settings?.postLoadDelay ?? ''
  }));
}

function buildScanStartRows(profilePathValue) {
  return [
    {
      mode: 'local_default',
      command: 'npm run scan',
      profilePath: 'profiles/us-health.yml',
      notes: 'Uses package script mapped to tsx runner with default profile.'
    },
    {
      mode: 'local_explicit_profile',
      command: `npx tsx src/index.ts ${profilePathValue}`,
      profilePath: profilePathValue,
      notes: 'Direct orchestrator invocation with explicit profile path.'
    },
    {
      mode: 'local_force_rescan',
      command: `FORCE_RESCAN=true npx tsx src/index.ts ${profilePathValue}`,
      profilePath: profilePathValue,
      notes: 'Bypasses unchanged-page skip checks and rescans all discovered pages.'
    },
    {
      mode: 'github_actions_schedule',
      command: 'workflow: .github/workflows/vital-scan.yml (cron: 0 4 * * 6 and 0 2 1 * *)',
      profilePath: 'profiles/us-health.yml',
      notes: 'Scheduled scan with history restore and Pages deployment.'
    },
    {
      mode: 'github_actions_manual',
      command: 'workflow_dispatch: vital-scan.yml (input: force_rescan)',
      profilePath: 'profiles/us-health.yml',
      notes: 'Manual scan trigger from Actions UI with optional force rescan.'
    }
  ];
}

async function main() {
  const profileText = await fs.readFile(path.resolve(process.cwd(), profilePath), 'utf8');
  const parsed = YAML.parse(profileText);
  const targets = Array.isArray(parsed?.targets) ? parsed.targets : [];

  const targetRows = buildTargetRows(targets);
  const hostRows = buildHostRows(targets);
  const scanRows = buildScanStartRows(profilePath);

  const targetPayload = {
    generatedAt: new Date().toISOString(),
    profilePath,
    totalTargets: targetRows.length,
    targets: targetRows
  };

  const hostPayload = {
    generatedAt: new Date().toISOString(),
    profilePath,
    totalHosts: hostRows.length,
    hosts: hostRows
  };

  const scanPayload = {
    generatedAt: new Date().toISOString(),
    profilePath,
    scanStartMethods: scanRows
  };

  await fs.mkdir(outputDir, { recursive: true });

  await Promise.all([
    fs.writeFile(path.join(outputDir, 'targets.json'), JSON.stringify(targetPayload, null, 2), 'utf8'),
    fs.writeFile(path.join(outputDir, 'targets.csv'), toCsv(targetRows), 'utf8'),
    fs.writeFile(path.join(outputDir, 'hosts.json'), JSON.stringify(hostPayload, null, 2), 'utf8'),
    fs.writeFile(path.join(outputDir, 'hosts.csv'), toCsv(hostRows), 'utf8'),
    fs.writeFile(path.join(outputDir, 'scan-start-methods.json'), JSON.stringify(scanPayload, null, 2), 'utf8'),
    fs.writeFile(path.join(outputDir, 'scan-start-methods.csv'), toCsv(scanRows), 'utf8')
  ]);

  console.log(`Exported inventory files to ${outputDir}`);
}

main().catch((error) => {
  console.error('Failed to export inventory:', error.message);
  process.exit(1);
});
