import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correlateFindings, attachFindingCorrelations } from '../../src/lib/finding-correlation.js';
import { buildBugReports } from '../../src/lib/bug-report.js';

const page = 'https://example.gov/consent';

function finding(engine, ruleId, xpath, htmlSnippet = null) {
  return {
    instance_id: `${engine}:${ruleId}`,
    pattern_id: `${engine}:${ruleId}`,
    engine_key: engine,
    rule_id: ruleId,
    frequency: { instances: 1, pages_affected: 1 },
    affected_pages: [page],
    examples: [{ url: page, xpath, html_snippet: htmlSnippet }],
  };
}

test('correlates exact same-element evidence only as a duplicate when an ACT rule is shared', () => {
  const reports = [
    finding('axe-core', 'aria-required-parent', 'button[aria-label="Opt-Outs"]',
      '<button role="listitem" class="qc-cmp2-list-item-header" aria-label="Opt-Outs" aria-live="polite">'),
    finding('alfa', 'sia-r42',
      '<button aria-live="polite" aria-label="Opt-Outs" class="qc-cmp2-list-item-header" role="listitem">'),
  ];

  const [correlation] = correlateFindings(reports);
  assert.equal(correlation.status, 'confirmed_duplicate');
  assert.deepEqual(correlation.shared_act_rules, [{ id: 'ff89c9', status: 'Proposed' }]);
  assert.equal(correlation.evidence.observation_pairs[0].relation, 'same_element');
});

test('a sampled matching element does not mark a capped aggregate finding as wholly duplicate', () => {
  const reports = [
    finding('axe-core', 'aria-required-parent', 'button[aria-label="Opt-Outs"]',
      '<button role="listitem" class="qc-cmp2-list-item-header" aria-label="Opt-Outs">'),
    finding('alfa', 'sia-r42',
      '<button aria-label="Opt-Outs" role="listitem" class="qc-cmp2-list-item-header">'),
  ];
  for (const report of reports) report.frequency = { instances: 100, pages_affected: 100 };

  const [correlation] = attachFindingCorrelations(reports);
  assert.equal(correlation.status, 'related');
  assert.equal(correlation.evidence.observation_pairs[0].status, 'confirmed_duplicate');
  assert.equal(reports[1].possible_duplicate_of, undefined, 'legacy whole-finding duplicate flag stays unset for capped evidence');
});

test('identical markup without locator agreement remains uncertain, not confirmed duplicate', () => {
  const markup = '<button role="listitem" class="qc-cmp2-list-item-header" aria-label="Opt-Outs">';
  const reports = [
    finding('axe-core', 'aria-required-parent', markup),
    finding('alfa', 'sia-r42', markup),
  ];

  const [correlation] = correlateFindings(reports);
  assert.equal(correlation.status, 'uncertain');
  assert.equal(correlation.evidence.observation_pairs[0].relation, 'same_markup');
});

test('keeps same-element tests related when the ACT mappings do not match', () => {
  const reports = [
    finding('axe-core', 'list', '.css-12exy1k', '<ul class="qc-cmp2-consent-list css-12exy1k">'),
    finding('alfa', 'sia-r68', '<ul class="css-12exy1k qc-cmp2-consent-list">'),
  ];

  const [correlation] = correlateFindings(reports);
  assert.equal(correlation.status, 'related');
  assert.deepEqual(correlation.shared_act_rules, []);
  assert.deepEqual(correlation.right.act_rules, [{ id: 'bc4a75', status: 'Proposed' }]);
});

test('keeps text-only contrast overlap uncertain and does not invent an ACT mapping', () => {
  const reports = [
    finding('axe-core', 'color-contrast', '.contrast-text', '<p class="contrast-text">Opted In</p>'),
    finding('alfa', 'sia-r69', 'text: "Opted In"'),
  ];

  const [correlation] = correlateFindings(reports);
  assert.equal(correlation.status, 'uncertain');
  assert.deepEqual(correlation.right.act_rules, []);
  assert.deepEqual(correlation.left.act_rules, [
    { id: 'afw4f7', status: 'Approved' },
    { id: '09o5cg', status: 'Approved' },
  ]);
  assert.equal(correlation.evidence.observation_pairs[0].relation, 'same_text');
});

test('keeps different ACT tests on the same switch element related, not duplicate', () => {
  const reports = [
    finding('axe-core', 'button-name', 'button[role="switch"]',
      '<button tabindex="0" role="switch" aria-checked="false" class="qc-cmp2-toggle css-w01txj">'),
    finding('alfa', 'sia-r8',
      '<button class="qc-cmp2-toggle css-w01txj" aria-checked="false" role="switch" tabindex="0">'),
  ];

  const [correlation] = correlateFindings(reports);
  assert.equal(correlation.status, 'related');
  assert.deepEqual(correlation.shared_act_rules, []);
  assert.deepEqual(correlation.left.act_rules, [
    { id: '97a4e1', status: 'Approved' },
    { id: 'm6b1q3', status: 'Approved' },
  ]);
  assert.deepEqual(correlation.right.act_rules, [{ id: 'e086e5', status: 'Approved' }]);
  const [axeCorrelation] = attachFindingCorrelations(reports);
  assert.deepEqual(reports[0].cross_engine_correlations[0].own_act_rules, correlation.left.act_rules);
  assert.deepEqual(reports[0].cross_engine_correlations[0].peer_act_rules, correlation.right.act_rules);
});

test('identifies separate observations within a shared component without merging them', () => {
  const reports = [
    finding('axe-core', 'aria-required-parent', 'button[aria-label="Opt-Outs"]',
      '<button class="qc-cmp2-list-item-header" role="listitem">'),
    finding('alfa', 'sia-r42', '<p class="qc-cmp2-list-item-title" role="listitem">'),
  ];

  const [correlation] = correlateFindings(reports);
  assert.equal(correlation.status, 'related');
  assert.equal(correlation.evidence.observation_pairs[0].relation, 'same_component');
  assert.equal(correlation.evidence.observation_pairs[0].shared_component, 'qc-cmp2-list-item');
});

test('keeps separate elements independent even when both rules map to the same ACT Rule', () => {
  const reports = [
    finding('axe-core', 'aria-required-parent', 'button[aria-label="Opt-Outs"]',
      '<button class="consent-button" role="listitem" aria-label="Opt-Outs">'),
    finding('alfa', 'sia-r42', '<p class="unrelated-content" role="listitem">'),
  ];

  const [correlation] = correlateFindings(reports);
  assert.equal(correlation.status, 'independent');
  assert.deepEqual(correlation.shared_act_rules, [{ id: 'ff89c9', status: 'Proposed' }]);
  assert.equal(correlation.evidence.observation_pairs[0].relation, 'separate_elements');
});

test('does not mark same-WCAG findings as duplicates when their observed elements differ', () => {
  const reports = [
    { ...finding('axe-core', 'color-contrast', '.text'), wcag_sc: '1.4.3' },
    { ...finding('alfa', 'sia-r69', '<button class="consent-toggle">'), wcag_sc: '1.4.3' },
  ];

  attachFindingCorrelations(reports);
  assert.equal(reports[1].possible_duplicate_of, undefined);
  assert.equal(reports[1].possible_duplicate_pattern, undefined);
});

test('buildBugReports attaches uncertainty instead of a duplicate flag for same-WCAG rules', () => {
  const summary = {
    domain: 'example.gov',
    pagesScanned: 10,
    axe: { rules: {
      'color-contrast': {
        count: 1,
        pages: 1,
        impact: 'serious',
        tags: ['wcag143'],
        instances: [{ url: page, target: '.contrast-text', html: '<p class="contrast-text">Opted In</p>' }],
        affectedPages: [{ url: page, instances: 1 }],
      },
    } },
    alfa: { rules: {
      'sia-r69': {
        count: 1,
        pages: 1,
        instances: [{ url: page, target: 'text: "Opted In"' }],
        affectedPages: [{ url: page, instances: 1 }],
      },
    } },
  };

  const reports = buildBugReports({ domain: 'example.gov', key: 'example.gov' }, summary);
  const alfa = reports.find((report) => report.rule_id === 'sia-r69');
  assert.equal(alfa.possible_duplicate_of, undefined);
  assert.equal(alfa.cross_engine_correlations[0].status, 'uncertain');
});

test('attaches correlation metadata while retaining the original engine observations', () => {
  const reports = [
    finding('axe-core', 'aria-required-parent', 'button[aria-label="Opt-Outs"]',
      '<button role="listitem" class="qc-cmp2-list-item-header" aria-label="Opt-Outs">'),
    finding('alfa', 'sia-r42', '<button aria-label="Opt-Outs" role="listitem" class="qc-cmp2-list-item-header">'),
  ];
  const originalExamples = reports.map((report) => structuredClone(report.examples));

  attachFindingCorrelations(reports);
  assert.deepEqual(reports.map((report) => report.examples), originalExamples);
  assert.equal(reports[0].cross_engine_correlations[0].status, 'confirmed_duplicate');
  assert.equal(reports[1].possible_duplicate_of, reports[0].instance_id);
});