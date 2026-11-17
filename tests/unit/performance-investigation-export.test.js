import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { investigationsToCsv } from '../../src/lib/performance-investigation-export.js';
import { validate } from '../../src/lib/api-schema-validate.js';

const schemaDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'api', 'schema');
const schema = JSON.parse(fs.readFileSync(path.join(schemaDir, 'performance-investigation.schema.json'), 'utf8'));

const queue = {
  schema_version: 'performance-investigation/1',
  generated_from: 'stored weekly summary; no live browser',
  rank_basis: 'category, reach, savings, stable ID',
  limitations: ['not causal'],
  candidates: [
    { id: 'shared', category: 'shared-expensive-resource', status: 'investigation-candidate', evidence_strength: 'direct-observation', resource: { key: 'https://e/a.js', type: 'script', pages: 3, transfer_bytes: 9 }, priority_reasons: ['reach: 3 sampled page(s)'], hypothesis: 'may be adding work', proposed_test: 'defer it', alternatives: ['template'], evidence: { denominator: 10, limitations: ['correlation'] } },
    { id: 'page', category: 'slow-representative-page', status: 'investigation-candidate', evidence_strength: 'direct-observation', page: { url: 'https://e/slow', performance: 20 }, priority_reasons: ['category: slow page'], hypothesis: 'slow page', proposed_test: 'repeat run' },
  ],
};

test('CSV covers every candidate category with one schema', () => {
  const csv = investigationsToCsv(queue);
  assert.match(csv, /^id,category,status,evidence_strength,subject,reach,denominator,performance_score/);
  assert.match(csv, /shared,shared-expensive-resource/);
  assert.match(csv, /page,slow-representative-page.*https:\/\/e\/slow/);
});

test('investigation queue validates against its published schema', () => {
  const result = validate(schema, queue);
  assert.equal(result.valid, true);
});
