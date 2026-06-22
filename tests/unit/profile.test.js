import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyProfile, loadProfile } from '../../src/lib/config.js';

// A minimal fake config standing in for loadConfig()'s output, so the test
// doesn't depend on the live targets.yml roster (which changes over time).
const fakeConfig = {
  defaults: {},
  sampling: {},
  sustainabilityMetric: 'co2',
  targets: [
    { domain: 'www.cms.gov', key: 'www.cms.gov' },
    { domain: 'www.medicaid.gov', key: 'www.medicaid.gov' },
    { domain: 'www.cdc.gov', key: 'www.cdc.gov' },
  ],
};

test('applyProfile with null profile returns config unchanged (GitHub Pages default)', () => {
  const out = applyProfile(fakeConfig, null);
  assert.equal(out, fakeConfig); // same reference: no scoping, no copy
  assert.equal(out.targets.length, 3);
});

test('applyProfile restricts targets to the profile selection', () => {
  const profile = {
    name: 'CMS',
    targetKeys: new Set(['www.cms.gov', 'www.medicaid.gov']),
    branding: { title: 'CMS Accessibility' },
    reportBaseUrl: '',
  };
  const out = applyProfile(fakeConfig, profile);
  assert.deepEqual(
    out.targets.map((t) => t.key).sort(),
    ['www.cms.gov', 'www.medicaid.gov']
  );
  assert.equal(out.profile.name, 'CMS');
  // Input is never mutated.
  assert.equal(fakeConfig.targets.length, 3);
});

test('applyProfile fails loudly when a profile names an unknown target', () => {
  const profile = {
    name: 'Bad',
    targetKeys: new Set(['www.cms.gov', 'does-not-exist.gov']),
    branding: {},
    reportBaseUrl: '',
  };
  assert.throws(() => applyProfile(fakeConfig, profile), /not in targets\.yml/);
});

test('loadProfile returns null for an unset profile name', () => {
  assert.equal(loadProfile(undefined), null);
  assert.equal(loadProfile(''), null);
});

test('loadProfile reads the committed cms.yml profile', () => {
  const p = loadProfile('cms');
  assert.equal(p.name, 'CMS');
  assert.ok(p.targetKeys.has('www.cms.gov'), 'cms profile selects www.cms.gov');
  assert.ok(p.branding.title, 'cms profile has a branding title');
});

test('loadProfile throws a helpful error for a missing profile', () => {
  assert.throws(() => loadProfile('nonexistent-profile'), /config\/profiles\/nonexistent-profile\.yml/);
});
