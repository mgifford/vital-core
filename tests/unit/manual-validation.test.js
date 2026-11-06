import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  manualValidationFor,
  manualReviewRecord,
  MANUAL_REVIEW_STATUSES,
} from '../../src/lib/manual-validation.js';

const text = (entry) => entry.prompts.join(' ');

test('manual guidance is specific to the WCAG criterion', () => {
  assert.match(text(manualValidationFor({ wcag_sc: '1.1.1' })), /text alternative/i);
  assert.match(text(manualValidationFor({ wcag_sc: '1.4.3' })), /contrast/i);
  assert.match(text(manualValidationFor({ wcag_sc: '2.1.1' })), /keyboard/i);
  assert.match(text(manualValidationFor({ wcag_sc: '4.1.2' })), /accessible name, role and state/i);
});

test('manual guidance falls back to the rule, then to a generic prompt', () => {
  assert.match(text(manualValidationFor({ rule_id: 'image-alt' })), /text alternative/i);
  assert.match(text(manualValidationFor({ rule_id: 'target-size' })), /24×24/);
  const generic = manualValidationFor({ wcag_sc: '9.9.9', rule_id: 'something-new' });
  assert.equal(generic.prompts.length, 3);
  assert.match(text(generic), /Reproduce the finding in context/);
});

test('guidance is bounded and never claims a review happened', () => {
  const guidance = manualValidationFor({ wcag_sc: '1.4.3' });
  assert.ok(guidance.prompts.length <= 3);
  assert.equal(guidance.status, 'not_reviewed');
  assert.ok(guidance.environment.length >= 4);
  assert.match(guidance.environment_note, /not every item applies/i);
  assert.match(guidance.limitations.join(' '), /third of accessibility barriers/);
  assert.match(guidance.limitations.join(' '), /does not establish conformance/);
  assert.deepEqual(MANUAL_REVIEW_STATUSES, ['not_reviewed', 'in_progress', 'confirmed', 'not_reproduced', 'false_positive', 'needs_investigation']);
});

test('manualReviewRecord is a blank, structured record with provenance', () => {
  const record = manualReviewRecord({
    instance_id: 'VS-1', pattern_id: 'VS-p', rule_id: 'image-alt', engine_key: 'axe-core',
    severity: 'Critical', wcag_sc: '1.1.1', url: 'https://example.gov/a', selector: 'img.hero',
    semantic_context: { nearest_region: { role: 'main', name: null } },
    component_scope: { component_label: 'Hero' },
  }, { generatedAt: '2026-11-06T00:00:00.000Z' });
  assert.equal(record.schema, 1);
  assert.equal(record.generated_at, '2026-11-06T00:00:00.000Z');
  assert.equal(record.not_a_conformance_claim, true);
  assert.equal(record.finding.instance_id, 'VS-1');
  assert.equal(record.finding.region, 'main (unnamed)');
  assert.equal(record.finding.component, 'Hero');
  assert.equal(record.review.status, 'not_reviewed');
  assert.equal(record.review.reviewer, null);
  assert.equal(record.review.reviewed_at, null);
  assert.deepEqual(record.review.steps, []);
  assert.equal(record.review.outcome, null);
  assert.ok(record.guidance.prompts.length > 0);
  assert.match(record.instructions, /not saved/i);
  const serialized = JSON.stringify(record);
  assert.doesNotMatch(serialized, /wcag compliant|fully tested|accessibility verified/i);
});

test('the guidance functions can run in the browser (self-contained)', () => {
  const source = [manualValidationFor, manualReviewRecord].map((fn) => fn.toString()).join('\n');
  const build = new Function(`${source}\nreturn manualReviewRecord;`)();
  const record = build({ instance_id: 'VS-2', wcag_sc: '2.1.1' }, { generatedAt: '2026-11-06T00:00:00.000Z' });
  assert.equal(record.review.status, 'not_reviewed');
  assert.match(record.guidance.prompts.join(' '), /keyboard/i);
});
