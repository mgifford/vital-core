import fs from 'node:fs';
import path from 'node:path';

const REPO_BLOB_BASE = 'https://github.com/mgifford/vital-core/blob/main';

function joinUrl(base, p) {
  const b = (base || '').replace(/\/+$/, '');
  return b ? `${b}${p}` : p;
}

export function buildApiCatalog(config, indexEntries) {
  const base = (config.reportBaseUrl || '').replace(/\/+$/, '');
  const abs = (p) => joinUrl(base, p);
  const generatedAt = new Date().toISOString();

  return {
    catalog_version: '1.0',
    generated_at: generatedAt,
    title: 'VITAL Scans API Catalog',
    description: 'Machine-readable catalog of VITAL Scans APIs and related machine-discovery entry points.',
    apis: [
      {
        id: 'vital-json-api-v1',
        title: 'VITAL Scans Static JSON API (v1)',
        type: 'json',
        base_url: abs('/api/v1'),
        auth: 'none',
        docs_url: `${REPO_BLOB_BASE}/API.md`,
        schema_base_url: abs('/api/v1/schema'),
        endpoints: [
          {
            id: 'index',
            method: 'GET',
            url: abs('/api/v1/index.json'),
            description: 'Fleet index of domains with links to snapshots and latest findings.',
          },
          {
            id: 'domain_snapshot',
            method: 'GET',
            url_template: abs('/api/v1/{domain_key}/snapshot.json'),
            description: 'Domain history and weekly trend snapshot.',
            examples: indexEntries.slice(0, 25).map((d) => abs(d.snapshot_url)),
          },
          {
            id: 'week_findings',
            method: 'GET',
            url_template: abs('/api/v1/{domain_key}/{week}/findings.json'),
            description: 'Per-week findings payload for one domain and ISO week.',
            examples: indexEntries.slice(0, 25).map((d) => abs(d.findings_url)),
          },
        ],
        schemas: [
          abs('/api/v1/schema/index.schema.json'),
          abs('/api/v1/schema/snapshot.schema.json'),
          abs('/api/v1/schema/findings.schema.json'),
        ],
      },
      {
        id: 'vital-agent-discovery',
        title: 'Agent Discovery Surfaces',
        type: 'discovery',
        endpoints: [
          {
            id: 'llms_txt',
            method: 'GET',
            url: abs('/llms.txt'),
            description: 'LLM-oriented guide to machine-readable surfaces for this site.',
          },
          {
            id: 'mcp_docs',
            method: 'GET',
            url: `${REPO_BLOB_BASE}/MCP.md`,
            description: 'Local MCP server documentation for coding assistants.',
          },
        ],
      },
    ],
    notes: [
      'This catalog is additive to schema.org markup in HTML and does not replace page-level structured data.',
      'API responses are static files, read-only, and can be consumed without authentication.',
    ],
  };
}

export function writeApiCatalog(docsDir, config, indexEntries) {
  const wellKnownDir = path.join(docsDir, '.well-known');
  fs.mkdirSync(wellKnownDir, { recursive: true });
  const catalog = buildApiCatalog(config, indexEntries);
  const json = JSON.stringify(catalog, null, 1);
  fs.writeFileSync(path.join(wellKnownDir, 'api-catalog'), json);
  fs.writeFileSync(path.join(wellKnownDir, 'api-catalog.json'), json);
}
