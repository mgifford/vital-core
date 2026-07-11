import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndexEntry, buildSnapshot, buildWeekFindings, SCHEMA_VERSION } from '../../src/lib/api-writer.js';
import { validate } from '../../src/lib/api-schema-validate.js';

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'api', 'schema');
const loadSchema = (name) => JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, name), 'utf8'));

const target = { domain: 'example.gov', key: 'example.gov' };
const componentClusters = {
  design_system: 'ds', design_system_theme: 't', total_clusters: 1,
  drift_pages: [{ url: 'https://example.gov/x', tokens: [], cluster_ids: [1], rule_keys: [] }],
  top_actions: [{
    id: 'A1', rule_id: 'color-contrast', engine_key: 'axe-core', severity: 'Serious',
    pages_affected: 3, instances: 5, action_score: 9, representative_selector: '.a',
    representative_snippet: '<a></a>', design_components: [], drift: false, estimated_fix_impact: null,
  }],
};
const summary = {
  week: '2026-W25', pagesScanned: 100, domain: 'example.gov',
  componentClusters, techFindings: { associations: [] },
};
const bugs = [{
  pattern_id: 'VS-abc', rule_id: 'color-contrast', rule_label: 'Contrast', engine_key: 'axe-core',
  severity: 'Serious', wcag_sc: '1.4.3', wcag_level: 'AA',
  url: 'https://example.gov/home',
  affected_pages: ['https://example.gov/a', 'https://example.gov/b'],
  frequency: { pages_affected: 2, instances: 4, total_pages_scanned: 100 },
  first_seen: '2026-W24', last_seen: '2026-W25', weeks_seen: 2,
}];
const series = [{ week: '2026-W25', pagesScanned: 100, componentClusters, techFindings: { associations: [] } }];
const ledger = { findings: { 'VS-abc': { engine: 'axe-core', ruleId: 'color-contrast', severity: 'Serious', firstSeen: '2026-W24', lastSeen: '2026-W25', weeksSeen: 2, lastPagesAffected: 2 } } };

describe('generated API resources validate against their schemas', () => {
  test('index entry (wrapped as index.json) validates', () => {
    const doc = { schema_version: SCHEMA_VERSION, domains: [buildIndexEntry(target, series[0], bugs)] };
    const { valid, errors } = validate(loadSchema('index.schema.json'), doc);
    assert.ok(valid, errors.join('\n'));
  });

  test('findings.json validates', () => {
    const doc = buildWeekFindings(target, summary, bugs, ledger.findings);
    const { valid, errors } = validate(loadSchema('findings.schema.json'), doc);
    assert.ok(valid, errors.join('\n'));
  });

  test('snapshot.json validates', () => {
    const doc = buildSnapshot(target, series, {}, ledger, null, bugs);
    const { valid, errors } = validate(loadSchema('snapshot.schema.json'), doc);
    assert.ok(valid, errors.join('\n'));
  });

  test('empty findings array still validates', () => {
    const doc = buildWeekFindings(target, { ...summary, componentClusters: null }, [], {});
    const { valid, errors } = validate(loadSchema('findings.schema.json'), doc);
    assert.ok(valid, errors.join('\n'));
  });
});

describe('validator rejects malformed resources (guards against false-positive passes)', () => {
  test('wrong schema_version fails the const check', () => {
    const doc = { schema_version: '2', domains: [] };
    assert.equal(validate(loadSchema('index.schema.json'), doc).valid, false);
  });

  test('invalid severity enum fails', () => {
    const doc = buildWeekFindings(target, summary, bugs, ledger.findings);
    doc.findings[0].severity = 'High'; // taxonomy forbids High/Medium/Low
    assert.equal(validate(loadSchema('findings.schema.json'), doc).valid, false);
  });

  test('malformed week pattern fails', () => {
    const doc = buildWeekFindings(target, summary, bugs, ledger.findings);
    doc.week = '2026-25';
    assert.equal(validate(loadSchema('findings.schema.json'), doc).valid, false);
  });

  test('missing required finding field fails', () => {
    const doc = buildWeekFindings(target, summary, bugs, ledger.findings);
    delete doc.findings[0].trend_status;
    assert.equal(validate(loadSchema('findings.schema.json'), doc).valid, false);
  });
});

describe('all three schema files are parseable draft-07 documents', () => {
  for (const name of ['index.schema.json', 'snapshot.schema.json', 'findings.schema.json']) {
    test(name, () => {
      const s = loadSchema(name);
      assert.equal(s.$schema, 'http://json-schema.org/draft-07/schema#');
      assert.ok(s.title && s.type === 'object');
    });
  }
});
