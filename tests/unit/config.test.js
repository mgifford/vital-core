import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLanguages, loadConfig, ciDataRepo } from '../../src/lib/config.js';

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
  const c = loadConfig(`
targets:
  - domain: example.gov
    design_system: CMS-DS
`);
  assert.equal(c.targets[0].design_system, 'cms-ds');
});

test('config: spelling_locale defaults to en-US, merges from defaults, and normalizes case', () => {
  const c = loadConfig(`
defaults:
  spelling_locale: en-gb
targets:
  - domain: www.example.gov.uk
  - domain: www.example.gc.ca
    spelling_locale: EN-CA
`);
  assert.deepEqual(c.targets.map((t) => t.spelling_locale), ['en-GB', 'en-CA']);
  assert.equal(loadConfig('targets:\n  - domain: example.gov\n').targets[0].spelling_locale, 'en-US');
});

test('config: government_domains adds a fleet\'s own namespaces, normalized, with a country', () => {
  const c = loadConfig(`
defaults:
  government_domains:
    - { suffix: GOB.MX, country: Mexico }
targets:
  - domain: www.sat.gob.mx
  - domain: www.cms.gov
    government_domains: []
`);
  assert.deepEqual(c.targets[0].governmentDomains, [{ suffix: '.gob.mx', country: 'Mexico' }]);
  assert.deepEqual(c.targets[1].governmentDomains, []);
  assert.deepEqual(loadConfig('targets:\n  - domain: example.gov\n').targets[0].governmentDomains, []);
  assert.throws(() => loadConfig('targets:\n  - domain: a.mx\n    government_domains: [{ suffix: .gob.mx }]\n'), /needs a suffix such as "\.gob\.mx" and a country/);
  assert.throws(() => loadConfig('targets:\n  - domain: a.mx\n    government_domains: .gob.mx\n'), /must be a list/);
});

test('config: an unsupported spelling_locale fails with the supported values', () => {
  assert.throws(
    () => loadConfig('targets:\n  - domain: example.gov.uk\n    spelling_locale: en-UK\n'),
    /Unsupported spelling_locale "en-UK" in target example\.gov\.uk\. Supported: en-US, en-GB, en-CA, en-AU\./,
  );
});

test('config: webmcpEnabled defaults to false when the flag is absent', () => {
  const c = loadConfig(`
targets:
  - domain: example.gov
`);
  assert.equal(c.targets[0].webmcpEnabled, false);
});

test('config: webmcpEnabled is true only for an explicit `webmcp: true`', () => {
  const c = loadConfig(`
targets:
  - domain: example.gov
    webmcp: true
`);
  assert.equal(c.targets[0].webmcpEnabled, true);
});

test('config: webmcpEnabled is false for an explicit `webmcp: false`', () => {
  const c = loadConfig(`
targets:
  - domain: example.gov
    webmcp: false
`);
  assert.equal(c.targets[0].webmcpEnabled, false);
});

test('config: webmcpEnabled is false for a non-boolean truthy value (opt-in requires literal true)', () => {
  const c = loadConfig(`
targets:
  - domain: example.gov
    webmcp: "yes"
`);
  assert.equal(c.targets[0].webmcpEnabled, false);
});

test('config: webmcp has no global default — only per-target opt-in', () => {
  const c = loadConfig(`
webmcp: true
targets:
  - domain: example.gov
`);
  assert.equal(c.targets[0].webmcpEnabled, false);
});

test('config: webmcpEnabled resolves to a strict boolean for every real target', () => {
  // Which targets opt in is expected to change over time (it's live in
  // config/targets.yml now, not just documented) — this only guards the
  // resolution logic's type, not a specific enabled/disabled snapshot.
  const c = loadConfig();
  for (const t of c.targets) {
    assert.equal(typeof t.webmcpEnabled, 'boolean');
  }
});

test('config: loadConfig surfaces reportBaseUrl with no trailing slash', () => {
  const c = loadConfig();
  assert.equal(typeof c.reportBaseUrl, 'string');
  assert.ok(!c.reportBaseUrl.endsWith('/'), 'reportBaseUrl should have its trailing slash stripped');
});

test('config: findingPolicy is available on every target', () => {
  const c = loadConfig();
  for (const t of c.targets) {
    assert.ok(t.findingPolicy, `missing findingPolicy for ${t.domain}`);
    assert.ok(t.findingPolicy.defaults);
  }
});

test('config: rejects invalid finding policy entries', () => {
  assert.throws(
    () => loadConfig(`
defaults:
  finding_policy:
    rules:
      - match: { engine: alfa, rule_id: sia-r113 }
        obligation: invalid
        handling: report
targets:
  - domain: example.gov
`),
    /unknown obligation/
  );
});

test('config: data_repo defaults to mgifford/vital-core-data', () => {
  const c = loadConfig(`
targets:
  - domain: example.gov
`);
  assert.equal(c.dataRepo, 'mgifford/vital-core-data');
  assert.equal(c.targets[0].dataRepo, 'mgifford/vital-core-data');
  assert.equal(ciDataRepo(c), 'mgifford/vital-core-data');
});

test('config: a target can override the global data_repo', () => {
  const c = loadConfig(`
data_repo: someone/global-data
targets:
  - domain: a.gov
  - domain: b.gov
    data_repo: someone/b-data
`);
  assert.equal(c.targets[0].dataRepo, 'someone/global-data');
  assert.equal(c.targets[1].dataRepo, 'someone/b-data');
});

test('config: rejects a malformed data_repo', () => {
  assert.throws(() => loadConfig(`
data_repo: not-a-repo
targets:
  - domain: a.gov
`), /owner\/name/);
});

test('config: rejects data_repo on an hf_only target', () => {
  assert.throws(() => loadConfig(`
targets:
  - domain: www.va.gov
    hf_only: true
    data_repo: someone/va-data
`), /hf_only/);
});

test('config: ciDataRepo refuses non-hf_only targets split across repos', () => {
  const c = loadConfig(`
targets:
  - domain: a.gov
  - domain: b.gov
    data_repo: someone/other
`);
  assert.throws(() => ciDataRepo(c), /one data_repo/);
});

test('config: the real targets.yml resolves to a single CI data repo', () => {
  assert.equal(ciDataRepo(loadConfig()), loadConfig().dataRepo);
});
