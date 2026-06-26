import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTrainingPriorities } from '../../src/lib/training-priorities.js';

function makeBug(ruleId, wcagSc, pagesAffected) {
  return {
    rule_id: ruleId,
    wcag_sc: wcagSc,
    frequency: { pages_affected: pagesAffected, instances: pagesAffected, total_pages_scanned: 50 },
  };
}

test('returns top 5 SCs by total pages, in descending order', () => {
  const bugs = [
    makeBug('image-alt',   '1.1.1', 30),
    makeBug('label',       '1.3.1', 25),
    makeBug('color-contrast', '1.4.3', 20),
    makeBug('html-has-lang',  '3.1.1', 15),
    makeBug('link-name',   '2.4.4', 10),
    makeBug('aria-required-attr', '4.1.2', 5),  // 6th SC — should be excluded
  ];
  const result = computeTrainingPriorities(bugs);
  assert.equal(result.length, 5);
  assert.equal(result[0].wcag_sc, '1.1.1');
  assert.equal(result[0].total_pages, 30);
  assert.equal(result[4].wcag_sc, '2.4.4');
  assert.equal(result[4].total_pages, 10);
});

test('sums pages_affected across multiple rules for the same SC', () => {
  const bugs = [
    makeBug('image-alt',  '1.1.1', 20),
    makeBug('image-role', '1.1.1', 10),  // same SC, different rule — sums to 30
    makeBug('label',      '1.3.1', 25),
  ];
  const result = computeTrainingPriorities(bugs);
  // 1.1.1 has 30 combined pages (20+10), so it ranks above 1.3.1's 25
  assert.equal(result[0].wcag_sc, '1.1.1');
  assert.equal(result[0].total_pages, 30);
  assert.equal(result[0].rule_count, 2);
  assert.equal(result[1].wcag_sc, '1.3.1');
  assert.equal(result[1].total_pages, 25);
});

test('component_inconsistency true when 3+ rules, each on >= 5 pages', () => {
  const bugs = [
    makeBug('rule-a', '4.1.2', 6),
    makeBug('rule-b', '4.1.2', 7),
    makeBug('rule-c', '4.1.2', 8),
  ];
  const result = computeTrainingPriorities(bugs);
  assert.equal(result[0].component_inconsistency, true);
});

test('component_inconsistency false when all rules have < 5 pages', () => {
  const bugs = [
    makeBug('rule-a', '4.1.2', 4),
    makeBug('rule-b', '4.1.2', 4),
    makeBug('rule-c', '4.1.2', 4),
  ];
  const result = computeTrainingPriorities(bugs);
  assert.equal(result[0].component_inconsistency, false);
});

test('component_inconsistency false when only 2 rules fire the SC', () => {
  const bugs = [
    makeBug('rule-a', '4.1.2', 10),
    makeBug('rule-b', '4.1.2', 10),
  ];
  const result = computeTrainingPriorities(bugs);
  assert.equal(result[0].component_inconsistency, false);
});

test('component_inconsistency false for a single-rule SC', () => {
  const bugs = [makeBug('image-alt', '1.1.1', 20)];
  const result = computeTrainingPriorities(bugs);
  assert.equal(result[0].component_inconsistency, false);
});

test('returns known plain-English label for common SC', () => {
  const bugs = [makeBug('image-alt', '1.1.1', 5)];
  const result = computeTrainingPriorities(bugs);
  assert.equal(result[0].label, 'Non-text Content (images, icons)');
});

test('falls back to WCAG <sc> for unknown SC', () => {
  const bugs = [makeBug('custom-rule', '9.9.9', 5)];
  const result = computeTrainingPriorities(bugs);
  assert.equal(result[0].label, 'WCAG 9.9.9');
});

test('ignores bugs with no wcag_sc', () => {
  const bugs = [
    { rule_id: 'best-practice-rule', wcag_sc: null, frequency: { pages_affected: 50 } },
    makeBug('image-alt', '1.1.1', 5),
  ];
  const result = computeTrainingPriorities(bugs);
  assert.equal(result.length, 1);
  assert.equal(result[0].wcag_sc, '1.1.1');
});

test('returns empty array for no bugs', () => {
  assert.deepEqual(computeTrainingPriorities([]), []);
});
