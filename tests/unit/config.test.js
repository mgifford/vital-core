import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLanguages, loadConfig } from '../../src/lib/config.js';

test('config: defaults to [en]/en when nothing is set', () => {
  const r = resolveLanguages(undefined, undefined, 'x');
  assert.deepEqual(r.languages, ['en']);
  assert.equal(r.defaultLanguage, 'en');
});

test('config: a target inherits the global fallback when both keys are unset', () => {
  const global = { languages: ['en', 'fr'], defaultLanguage: 'fr' };
  const r = resolveLanguages(undefined, undefined, 'target', global);
  assert.deepEqual(r.languages, ['en', 'fr']);
  assert.equal(r.defaultLanguage, 'fr');
});

test('config: a target can override the language list', () => {
  const global = { languages: ['en'], defaultLanguage: 'en' };
  const r = resolveLanguages(['en', 'ja'], undefined, 'target', global);
  assert.deepEqual(r.languages, ['en', 'ja']);
  assert.equal(r.defaultLanguage, 'en'); // first listed when no explicit default
});

test('config: de-duplicates and defaults to the first language', () => {
  const r = resolveLanguages(['fr', 'fr', 'en'], undefined, 'x');
  assert.deepEqual(r.languages, ['fr', 'en']);
  assert.equal(r.defaultLanguage, 'fr');
});

test('config: rejects an unsupported language', () => {
  assert.throws(() => resolveLanguages(['en', 'zz'], undefined, 'x'), /Unsupported language "zz"/);
});

test('config: rejects a default_language not in the list', () => {
  assert.throws(() => resolveLanguages(['en', 'fr'], 'ja', 'x'), /not in its languages list/);
});

test('config: loadConfig exposes languages on every target', () => {
  const c = loadConfig();
  assert.ok(Array.isArray(c.languages) && c.languages.includes('en'));
  for (const t of c.targets) {
    assert.ok(Array.isArray(t.languages) && t.languages.length >= 1);
    assert.ok(t.languages.includes(t.defaultLanguage));
  }
});

test('config: normalizes supported design_system values', () => {
  const c = loadConfig();
  const cms = c.targets.find((t) => t.domain === 'www.cms.gov');
  assert.equal(cms?.design_system, 'cms-ds');
});
