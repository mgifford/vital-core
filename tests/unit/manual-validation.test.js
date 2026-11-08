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
  assert.match(text(manualValidationFor({ rule_id: 'document-title' })), /page title/i);
  assert.match(text(manualValidationFor({ wcag_sc: '3.1.1' })), /language/i);
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
  assert.match(guidance.limitations.join(' '), /screenshot.*scan time/i);
  assert.deepEqual(MANUAL_REVIEW_STATUSES, ['not_reviewed', 'in_progress', 'confirmed', 'not_reproduced', 'false_positive', 'needs_investigation']);
});

test('manualReviewRecord is a blank, structured record with provenance', () => {
  const record = manualReviewRecord({
    instance_id: 'VS-1', pattern_id: 'VS-p', rule_id: 'image-alt', engine_key: 'axe-core',
    severity: 'Critical', wcag_sc: '1.1.1', url: 'https://example.gov/a', selector: 'img.hero',
    semantic_context: { nearest_region: { role: 'main', name: null } },
    component_scope: { component_label: 'Hero' },
    occurrence_id: 'VO-abc12345',
    element: { available: true, tag: 'img', role: 'img', name: 'Hero chart', name_source: 'alt' },
    screenshot: { available: true, file: 'screenshots/abc.jpg', captured_at: '2026-11-06T00:00:00.000Z', full_page: true },
    evidence: { stored_examples: 2 },
  }, { generatedAt: '2026-11-06T00:00:00.000Z' });
  assert.equal(record.schema, 1);
  assert.equal(record.generated_at, '2026-11-06T00:00:00.000Z');
  assert.equal(record.not_a_conformance_claim, true);
  assert.equal(record.finding.instance_id, 'VS-1');
  assert.equal(record.finding.region, 'main (unnamed)');
  assert.equal(record.finding.component, 'Hero');
  assert.equal(record.finding.occurrence_id, 'VO-abc12345');
  assert.equal(record.finding.element.tag, 'img');
  assert.equal(record.finding.screenshot.file, 'screenshots/abc.jpg');
  assert.equal(record.finding.screenshot.historical, true);
  assert.equal(record.finding.stored_examples, 2);
  assert.match(record.guidance.screenshot_note, /historical evidence/i);
  assert.equal(record.review.status, 'not_reviewed');
  assert.equal(record.review.reviewer, null);
  assert.equal(record.review.reviewed_at, null);
  assert.deepEqual(record.review.steps, []);
  assert.equal(record.review.outcome, null);
  assert.ok(record.guidance.prompts.length > 0);
  assert.match(record.instructions, /not saved/i);
  assert.match(record.instructions, /personal or sensitive data/i);
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

test('reviewer and environment are written into the downloaded record, not stored', () => {
  const record = manualReviewRecord(
    { instance_id: 'VS-3', rule_id: 'color-contrast', wcag_sc: '1.4.3' },
    {
      generatedAt: '2026-11-08T12:00:00.000Z',
      review: {
        status: 'confirmed',
        reviewer: '  Alex Example  ',
        browser: 'Firefox 145',
        assistive_technology: 'NVDA 2025.3',
        viewport: '1280×800',
      },
    }
  );
  assert.equal(record.review.status, 'confirmed');
  assert.equal(record.review.reviewer, 'Alex Example');
  assert.equal(record.review.reviewed_at, '2026-11-08T12:00:00.000Z');
  assert.equal(record.review.browser, 'Firefox 145');
  assert.equal(record.review.assistive_technology, 'NVDA 2025.3');
  assert.equal(record.review.viewport, '1280×800');
  assert.equal(record.automated_evidence_only, true);
  assert.equal(record.manual_validation_required, true);
  assert.equal(record.not_a_conformance_claim, true);
});

test('an invalid review status falls back to not_reviewed and drops environment claims', () => {
  const record = manualReviewRecord(
    { instance_id: 'VS-4', wcag_sc: '2.1.1' },
    { review: { status: 'passed', reviewer: 'A', browser: 'Chrome' } }
  );
  assert.equal(record.review.status, 'not_reviewed');
  assert.equal(record.review.reviewer, null);
  assert.equal(record.review.browser, null);
});
