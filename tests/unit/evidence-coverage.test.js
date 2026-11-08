import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEvidenceCoverage } from '../../src/lib/evidence-coverage.js';

const instance = (over = {}) => ({
  url: 'https://example.gov/page',
  target: 'button',
  page_id: 'p1',
  run_id: 'r1',
  scanned_at: '2026-11-03T00:00:00.000Z',
  component: null,
  element: { available: true, selector: 'button', tag: 'button', role: null, name: null, name_source: 'none', shadow: false, iframe: false, rect_page: { x: 0, y: 0, width: 10, height: 10 }, text_anchor: null },
  semantic_context: { nearest_region: { role: 'main', name: null }, region_ancestry: [], widget: null, path: [], in_dialog: false },
  screenshot: null,
  ...over,
});

const rule = (instances) => ({ count: instances.length, pages: instances.length, instances });

test('coverage distinguishes captured, not captured, not applicable and unsupported boundaries', () => {
  const summary = {
    axe: {
      version: '4.12.1',
      rules: {
        captured: rule([instance({ component: 'cmp-consent', screenshot: { available: true, file: 'screenshots/p1.jpg', width: 1280, height: 800 }, semantic_context: { nearest_region: { role: 'main', name: null }, region_ancestry: [], widget: { role: 'dialog', name: 'Privacy' }, path: [], in_dialog: true } })]),
        shadow: rule([instance({ element: { available: true, selector: '#shadow', tag: 'button', shadow: true, iframe: false } })]),
        none: rule([]),
        unavailable: rule([instance({ element: { available: false, reason: 'not-found' }, semantic_context: null })]),
        noLandmark: rule([instance({ semantic_context: { nearest_region: { role: null, name: null }, region_ancestry: [], widget: null, path: [], in_dialog: false } })]),
      },
    },
    alfa: { version: '0.117.0', rules: { alfa: rule([instance({ element: null, semantic_context: null })]) } },
    deprecatedHtml: { rules: { old: rule([]) } },
  };
  const coverage = summarizeEvidenceCoverage(summary);
  assert.equal(coverage.basis, 'findings');
  assert.equal(coverage.findings_total, 7);
  assert.equal(coverage.occurrences_stored, 5);
  assert.deepEqual(coverage.element_evidence, { captured: 2, not_captured: 1, not_applicable: 1, unsupported_dom_boundary: 1, no_stored_examples: 2 });
  assert.deepEqual(coverage.usable_locator, { captured: 2, unavailable: 5 });
  assert.deepEqual(coverage.semantic_region, { captured: 2, no_containing_landmark: 1, unavailable: 4 });
  assert.deepEqual(coverage.widget, { captured: 1, no_widget: 2, unavailable: 4 });
  assert.deepEqual(coverage.component, { attributed: 1, unattributed: 6 });
  assert.deepEqual(coverage.screenshot, { available: 1, unavailable: 6 });
  assert.deepEqual(coverage.reproduction, { eligible: 2, unavailable: 5 });
  assert.equal(coverage.findings_with_detailed_evidence, 2);
  assert.equal(coverage.findings_without_detailed_evidence, 5);
  assert.equal(coverage.by_engine.alfa.element_captured, 0);
  assert.equal(coverage.by_engine['axe-core'].findings, 5);
});

test('an empty week reports an exact zero denominator', () => {
  const coverage = summarizeEvidenceCoverage({});
  assert.equal(coverage.findings_total, 0);
  assert.equal(coverage.findings_with_detailed_evidence, 0);
  assert.equal(coverage.findings_without_detailed_evidence, 0);
  assert.equal(coverage.usable_locator.unavailable, 0);
});
