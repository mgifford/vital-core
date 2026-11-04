import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFindingReporting, sanitizeBugEvidence, sanitizeEvidence } from '../../src/lib/finding-reporting.js';
import { attachFindingCorrelations } from '../../src/lib/finding-correlation.js';

function pair() {
  return ['axe-core', 'alfa'].map((engine, index) => ({
    pattern_id: `VS-${index}`, instance_id: `VS-instance-${index}`, engine_key: engine,
    rule_id: index ? 'sia-r42' : 'aria-required-parent', severity: 'Serious',
    frequency: { instances: 1, pages_affected: 1 }, affected_pages: ['https://example.gov/feedback'],
    examples: [{ url: 'https://example.gov/feedback', xpath: index ? '<button id="choice" role="listitem">' : '#choice', html_snippet: '<button id="choice" role="listitem">' }],
  }));
}

test('reporting keeps raw findings but counts a complete duplicate pair once', () => {
  const bugs = pair();
  attachFindingCorrelations(bugs);
  const original = structuredClone(bugs);
  const result = buildFindingReporting(bugs);
  assert.equal(result.summary.engine_finding_count, 2);
  assert.equal(result.summary.remediation_group_count, 1);
  assert.equal(result.summary.remediation_task_count, null);
  assert.equal(result.byFindingId.get('VS-0').remediation_group_id, result.byFindingId.get('VS-1').remediation_group_id);
  assert.deepEqual(result.byFindingId.get('VS-0').act_rules, [{ id: 'ff89c9', status: 'Proposed' }]);
  assert.deepEqual(bugs, original);
});

test('sample matches and legacy duplicate flags never reduce remediation group counts', () => {
  const bugs = pair();
  for (const bug of bugs) bug.frequency.instances = 20;
  attachFindingCorrelations(bugs);
  bugs[1].possible_duplicate_of = bugs[0].instance_id;
  assert.equal(buildFindingReporting(bugs).summary.remediation_group_count, 2);
});

test('related findings in one likely component keep separate groups, severities and history', () => {
  const bugs = pair();
  bugs[0] = {
    ...bugs[0], pattern_id: 'VS-list-parent', severity: 'Serious', engine_severity: 'serious',
    first_seen: '2026-W20', last_seen: '2026-W25', weeks_seen: 6, likely_source: 'template',
    xpath: 'button[aria-label="Preference details"]',
    examples: [{ url: 'https://example.gov/consent', xpath: 'button[aria-label="Preference details"]', html_snippet: '<button class="qc-cmp2-consent-list-item-header" role="listitem">' }],
  };
  bugs[1] = {
    ...bugs[1], pattern_id: 'VS-list-owned', rule_id: 'sia-r68', severity: 'Moderate', engine_severity: null,
    first_seen: '2026-W21', last_seen: '2026-W25', weeks_seen: 5, likely_source: 'template',
    examples: [{ url: 'https://example.gov/consent', xpath: '<p class="qc-cmp2-consent-list-item-description">', html_snippet: '<p class="qc-cmp2-consent-list-item-description">' }],
  };

  const correlations = attachFindingCorrelations(bugs);
  assert.equal(correlations[0].status, 'related');
  assert.equal(correlations[0].evidence.observation_pairs[0].relation, 'same_component');
  const original = structuredClone(bugs);
  const reporting = buildFindingReporting(bugs);

  assert.equal(reporting.summary.engine_finding_count, 2);
  assert.equal(reporting.summary.remediation_group_count, 2, 'related component findings are not merged as duplicates');
  assert.equal(reporting.summary.remediation_task_count, null, 'one likely component remediation is not asserted as one task');
  assert.deepEqual(bugs, original, 'severity, history, IDs, URLs and examples remain unchanged');
  assert.equal(reporting.byFindingId.get('VS-list-parent').engine_severity, 'serious');
  assert.equal(reporting.byFindingId.get('VS-list-parent').remediation_priority.conformance_tier, 'required');
  assert.equal(reporting.byFindingId.get('VS-list-owned').engine_severity, null);
});

test('reporting preserves stable finding and occurrence IDs, severity and historical URLs', () => {
  const bug = {
    ...pair()[0],
    pattern_id: 'VS-stable-pattern',
    instance_id: 'VS-stable-occurrence',
    severity: 'Critical',
    engine_severity: 'critical',
    first_seen: '2026-W20',
    last_seen: '2026-W25',
    weeks_seen: 6,
    affected_pages: ['https://example.gov/feedback?lang=en', 'https://example.gov/feedback?lang=fr'],
  };
  const result = buildFindingReporting([bug]).byFindingId.get(bug.pattern_id);
  assert.equal(result.engine_severity, 'critical');
  assert.equal(result.remediation_priority.score > 0, true);
  assert.deepEqual(result.distinct_urls.sample, bug.affected_pages);
  assert.deepEqual([bug.pattern_id, bug.instance_id, bug.first_seen, bug.last_seen, bug.weeks_seen], [
    'VS-stable-pattern', 'VS-stable-occurrence', '2026-W20', '2026-W25', 6,
  ]);
});

test('distinct URLs preserve query variants, deduplicate repeated URLs and disclose incomplete samples', () => {
  const [bug] = pair();
  bug.affected_pages = ['https://example.gov/feedback?a=1', 'https://example.gov/feedback?a=1', 'https://example.gov/feedback?a=2'];
  bug.frequency.pages_affected = 8;
  const result = buildFindingReporting([bug]).byFindingId.get(bug.pattern_id);
  assert.equal(result.distinct_urls.observed_count, 2);
  assert.equal(result.distinct_urls.complete, false);
  assert.equal(result.ownership, 'not_established');
  assert.equal(result.engine_severity, null);
  assert.equal(typeof result.remediation_priority.score, 'number');
});

test('representative evidence is inert, bounded and redacted without mutating observations', () => {
  const raw = { url: 'https://example.gov/?token=PRIVATE#top', xpath: 'input[value="PRIVATE"]', html_snippet: '<script>PRIVATE</script><input id="field" value="PRIVATE" data-token="PRIVATE" onclick="PRIVATE"><label for="field">PRIVATE</label><a href="javascript:PRIVATE">PRIVATE</a>' };
  const sanitized = sanitizeEvidence(raw);
  assert.ok(!JSON.stringify(sanitized).includes('PRIVATE'));
  assert.equal(sanitized.selector, null);
  assert.match(sanitized.html, /id="field"/);
  assert.match(raw.html_snippet, /PRIVATE/);
  assert.equal(sanitizeEvidence({ xpath: 'text: "PRIVATE"' }).selector, null);
});

test('public bug-report copies sanitize snippets, selector text, URLs and steps without mutating raw findings', () => {
  const raw = { url: 'https://example.gov/?token=PRIVATE', xpath: 'text: "PRIVATE"', html_snippet: '<input value="PRIVATE">', affected_pages: ['https://example.gov/?token=PRIVATE'], examples: [{ url: 'https://example.gov/?token=PRIVATE', target: 'text: "PRIVATE"', html: '<script>PRIVATE</script><input value="PRIVATE">' }], steps_to_reproduce: ['Open https://example.gov/?token=PRIVATE.'] };
  const safe = sanitizeBugEvidence(raw);
  assert.ok(!JSON.stringify(safe).includes('PRIVATE'));
  assert.equal(safe.xpath, null);
  assert.equal(safe.examples[0].sanitized, true);
  assert.match(safe.steps_to_reproduce[0], /\[REDACTED\]/);
  assert.ok(JSON.stringify(raw).includes('PRIVATE'));
});

test('complete summary URL evidence is counted distinctly without expanding the public sample', () => {
  const [bug] = pair();
  const affectedPages = Array.from({ length: 30 }, (_, index) => ({ url: `https://example.gov/feedback?source=${index}` }));
  bug.frequency.pages_affected = 30;
  const summary = { axe: { rules: { 'aria-required-parent': { impact: 'serious', affectedPages } } } };
  const result = buildFindingReporting([bug], { summary }).byFindingId.get(bug.pattern_id);
  assert.equal(result.distinct_urls.observed_count, 30);
  assert.equal(result.distinct_urls.complete, true);
  assert.equal(result.distinct_urls.sample.length, 25);
  assert.equal(result.distinct_urls.sample_capped, true);
  assert.equal(result.engine_severity, 'serious');
});