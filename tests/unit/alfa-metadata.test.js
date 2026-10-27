import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWcag, alfaRuleMetadata } from '../../src/lib/wcag.js';
import { rulePlainLabel } from '../../src/lib/rule-label.js';
import { validateAlfaMetadataFromWorkspace } from '../../src/lib/alfa-metadata-validation.js';

test('alfa metadata: sia-r111 maps to WCAG 2.5.5 AAA and 44x44 enhanced label', () => {
  const wcag = resolveWcag('alfa', { ruleId: 'sia-r111' });
  assert.equal(wcag?.sc, '2.5.5');
  assert.equal(wcag?.level, 'AAA');
  const label = rulePlainLabel('alfa', 'sia-r111').toLowerCase();
  assert.match(label, /44×44|44x44/);
  assert.match(label, /enhanced/);
});

test('alfa metadata: sia-r113 maps to WCAG 2.5.8 AA and 24x24 minimum label', () => {
  const wcag = resolveWcag('alfa', { ruleId: 'sia-r113' });
  assert.equal(wcag?.sc, '2.5.8');
  assert.equal(wcag?.level, 'AA');
  const label = rulePlainLabel('alfa', 'sia-r113').toLowerCase();
  assert.match(label, /24×24|24x24/);
  assert.match(label, /minimum/);
});

test('alfa metadata: sia-r66 maps to WCAG 1.4.6 AAA', () => {
  const wcag = resolveWcag('alfa', { ruleId: 'sia-r66' });
  assert.equal(wcag?.sc, '1.4.6');
  assert.equal(wcag?.level, 'AAA');
});

test('alfa metadata: sia-r50 (autoplaying audio) maps to WCAG 1.4.2, per its own declared requirements', () => {
  // Corrected 2026-07-27: @siteimprove/alfa-rules 0.117.0's sia-r50/rule.js
  // declares `requirements: [Criterion.of("1.4.2"), ...]` -- the prior
  // notRequiredForConformance override was factually wrong.
  const wcag = resolveWcag('alfa', { ruleId: 'sia-r50' });
  assert.equal(wcag?.sc, '1.4.2');
  const meta = alfaRuleMetadata('sia-r50');
  assert.equal(meta.notRequiredForConformance, false);
  assert.deepEqual(meta.wcagScs, ['1.4.2']);
});

test('alfa metadata: sia-r54 (assertive live region atomicity) has no WCAG mapping, per its own declared requirements', () => {
  // Corrected 2026-07-27: sia-r54/rule.js declares no `requirements` field
  // at all -- the prior ['3.3.1', '4.1.3'] mapping was unsupported.
  const label = rulePlainLabel('alfa', 'sia-r54');
  assert.equal(label, 'Assertive live region is marked as atomic');
  const wcag = resolveWcag('alfa', { ruleId: 'sia-r54' });
  assert.equal(wcag, null);
  const meta = alfaRuleMetadata('sia-r54');
  assert.deepEqual(meta.wcagScs, []);
});

test('alfa metadata: labels match what the rule checks (2026-10-25 drift regressions)', () => {
  // Each pair was checked against @siteimprove/alfa-rules 0.117.0's
  // dist/sia-rN/rule.{js,d.ts} requirements and Outcomes; before the fix
  // these titles belonged to other rules.
  assert.equal(rulePlainLabel('alfa', 'sia-r57'), 'Text is included in a landmark');
  assert.equal(rulePlainLabel('alfa', 'sia-r61'), 'Page starts with a level 1 heading');
  assert.equal(rulePlainLabel('alfa', 'sia-r73'), 'Paragraph line height is at least 1.5');
  assert.equal(rulePlainLabel('alfa', 'sia-r69'), 'Text has minimum contrast');
  assert.equal(rulePlainLabel('alfa', 'sia-r84'), 'Scrollable element is keyboard accessible');
});

test('alfa metadata: best-practice rules carry no WCAG criterion', () => {
  for (const id of ['sia-r53', 'sia-r57', 'sia-r61', 'sia-r78']) {
    const meta = alfaRuleMetadata(id);
    assert.equal(meta.bestPractice, true, `${id} should be a best practice`);
    assert.deepEqual(meta.wcagScs, [], `${id} should have no WCAG criterion`);
    assert.equal(resolveWcag('alfa', { ruleId: id }), null);
  }
  for (const id of ['sia-r66', 'sia-r113', 'sia-r22']) {
    assert.equal(alfaRuleMetadata(id).bestPractice, false, `${id} is not a best practice`);
  }
});

test('alfa metadata: sia-r70 is not mapped as WCAG 2.4.4', () => {
  const wcag = resolveWcag('alfa', { ruleId: 'sia-r70' });
  assert.equal(wcag, null);
  const meta = alfaRuleMetadata('sia-r70');
  assert.equal(meta.notRequiredForConformance, true);
});

test('alfa metadata validation catches stale drift regressions', async () => {
  const result = await validateAlfaMetadataFromWorkspace();
  assert.deepEqual(result.errors, []);
});
