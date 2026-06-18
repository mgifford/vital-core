import test from 'node:test';
import assert from 'node:assert/strict';
import { rulePlainLabel } from '../../src/lib/rule-label.js';

test('rulePlainLabel prefers explicit config label for Alfa rules', () => {
  const label = rulePlainLabel('alfa', 'sia-r87');
  assert.equal(label, 'First focusable element is link to main content');
});

test('rulePlainLabel falls back to engine help text', () => {
  const label = rulePlainLabel('axe-core', 'image-alt', {
    help: 'Images must have alternate text',
  });
  assert.equal(label, 'Images must have alternate text');
});

test('rulePlainLabel falls back to WCAG name if no rule label/help exists', () => {
  const label = rulePlainLabel('alfa', 'sia-r9999', {
    wcag: { name: 'Bypass Blocks' },
  });
  assert.equal(label, 'Bypass Blocks');
});
