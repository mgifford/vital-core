import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bugsCsvTable, toCsv, writeResourceCsv } from '../../src/lib/csv.js';

const sampleBug = (over = {}) => ({
  instance_id: 'VS-abc123',
  pattern_id: 'VS-pat456',
  engine_key: 'axe-core',
  rule_id: 'image-alt',
  rule_url: 'https://example.gov/axe/image-alt',
  wcag_category: 'WCAG 2.0 A',
  wcag_sc: '1.1.1',
  wcag_name: 'Non-text Content',
  wcag_level: 'A',
  wcag_version: '2.0',
  severity: 'Critical',
  frequency: { pages_affected: 2, instances: 3, total_pages_scanned: 10 },
  url: 'https://example.gov/a',
  xpath: 'img',
  html_snippet: '<img>',
  summary: 'Images must have alt text',
  description: 'd',
  steps_to_reproduce: ['Open the page.', 'Locate the element.'],
  suggested_fix: 'Add alt text',
  remediation_tip: null,
  testing_environment: 'axe-core, headless Chromium',
  impact: { summary: 'Affects vision users.', groups: [{ group: 'Blind', percent: '2%' }] },
  first_seen: '2026-W20',
  last_seen: '2026-W25',
  weeks_seen: 5,
  possible_duplicate_of: '',
  possible_duplicate_pattern: '',
  affected_pages_csv: 'csv/axe__image-alt.csv',
  ...over,
});

test('bugsCsvTable: stable header order (schema is the single source of truth)', () => {
  const { headers } = bugsCsvTable([]);
  assert.equal(headers[0], 'bug_id');
  assert.equal(headers[12], 'pages_affected');
  assert.equal(headers[15], 'example_url');
  assert.equal(headers[headers.length - 1], 'affected_pages_csv');
  assert.equal(headers.length, 32);
});

test('bugsCsvTable: row maps bug fields in header order', () => {
  const { headers, rows } = bugsCsvTable([sampleBug()]);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.length, headers.length, 'one cell per header');
  assert.equal(row[headers.indexOf('combined_id')], 'VS-abc123 (pattern VS-pat456)');
  assert.equal(row[headers.indexOf('pages_affected')], 2);
  assert.equal(row[headers.indexOf('steps_to_reproduce')], 'Open the page. | Locate the element.');
  assert.equal(row[headers.indexOf('impact_groups')], 'Blind (2%)');
  assert.equal(row[headers.indexOf('remediation_tip')], '', 'null → empty string');
});

test('bugsCsvTable + toCsv: CSV escaping of commas and quotes', () => {
  const bug = sampleBug({ summary: 'Alt text, please', description: 'He said "hi"' });
  const { headers, rows } = bugsCsvTable([bug]);
  const csv = toCsv(headers, rows);
  const lines = csv.trimEnd().split('\n');
  assert.equal(lines.length, 2, 'header + one row');
  // A field containing a comma is wrapped in quotes; embedded quotes are doubled.
  assert.match(lines[1], /"Alt text, please"/);
  assert.match(lines[1], /"He said ""hi"""/);
});

// Issue #217: resources.csv must carry the source page(s) a resource is
// linked/embedded from, not just a count — otherwise a site owner sees
// "5979 PDFs" with no way to find the HTML to fix.
test('writeResourceCsv: includes an example_pages column sourced from the resource sample', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-resources-'));
  const resources = {
    list: [
      { url: 'https://x.gov/report.pdf', type: 'pdf', pages: 2, examplePages: ['https://x.gov/about', 'https://x.gov/news'] },
      { url: 'https://x.gov/no-samples.pdf', type: 'pdf', pages: 1 }, // no examplePages field at all
    ],
  };
  const ledger = {
    resources: {
      'https://x.gov/report.pdf': { firstSeen: '2026-W20', lastSeen: '2026-W25' },
    },
  };

  const name = writeResourceCsv(tmp, 'x.gov', '2026-W25', resources, ledger);
  const csv = fs.readFileSync(path.join(tmp, name), 'utf8');
  const lines = csv.trimEnd().split('\n');

  assert.equal(lines[0], 'url,type,pages,first_seen,last_seen,example_pages');
  assert.equal(lines[1], 'https://x.gov/report.pdf,pdf,2,2026-W20,2026-W25,https://x.gov/about https://x.gov/news');
  // Missing examplePages degrades to an empty cell, not a crash.
  assert.equal(lines[2], 'https://x.gov/no-samples.pdf,pdf,1,,,');
});
