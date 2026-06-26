import { test } from 'node:test';
import assert from 'node:assert/strict';
import { techRemediationTip, supportedPlatforms } from '../../src/lib/remediation-prompts.js';

function tech(name) {
  return [{ name, category: 'CMS', pagesConfirmed: 5 }];
}

test('returns tip for Drupal image-alt', () => {
  const result = techRemediationTip(tech('Drupal'), 'image-alt');
  assert.ok(result, 'expected a result object');
  assert.equal(result.tech, 'Drupal');
  assert.ok(result.tip.length > 10, 'tip should be non-trivial');
});

test('returns tip for WordPress image-alt', () => {
  const result = techRemediationTip(tech('WordPress'), 'image-alt');
  assert.ok(result);
  assert.equal(result.tech, 'WordPress');
  assert.ok(result.tip.includes('Block Editor') || result.tip.includes('Media Library'));
});

test('returns tip for SharePoint label', () => {
  const result = techRemediationTip(tech('SharePoint'), 'label');
  assert.ok(result);
  assert.equal(result.tech, 'SharePoint');
});

test('returns null for unknown platform', () => {
  assert.equal(techRemediationTip(tech('SomeUnknownCMS'), 'image-alt'), null);
});

test('returns null for known platform but unknown rule', () => {
  assert.equal(techRemediationTip(tech('Drupal'), 'no-such-rule-xyz'), null);
});

test('returns null for empty tech array', () => {
  assert.equal(techRemediationTip([], 'image-alt'), null);
});

test('returns null for null tech', () => {
  assert.equal(techRemediationTip(null, 'image-alt'), null);
});

test('accepts plain string entries in tech array', () => {
  const result = techRemediationTip(['Drupal'], 'label');
  assert.ok(result);
  assert.equal(result.tech, 'Drupal');
});

test('picks first matching platform when multiple techs listed', () => {
  const mixed = [
    { name: 'UnknownCMS', category: 'CMS' },
    { name: 'WordPress', category: 'CMS' },
  ];
  const result = techRemediationTip(mixed, 'image-alt');
  assert.ok(result);
  assert.equal(result.tech, 'WordPress');
});

test('supportedPlatforms returns at least Drupal and WordPress', () => {
  const platforms = supportedPlatforms();
  assert.ok(platforms.includes('drupal'));
  assert.ok(platforms.includes('wordpress'));
});
