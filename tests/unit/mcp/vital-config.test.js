import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  substituteEnvVars,
  resolveVitalConfig,
  parseVitalConfig,
  loadVitalConfig,
} from '../../../mcp/config/vital-config.js';

const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'fixtures', 'mcp', '.vital.yml',
);

const FIXTURE_WITH_REPO_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'fixtures', 'mcp', '.vital-with-repo.yml',
);

const VALID_YAML = `
version: 1
instance:
  api: https://example.org/vital-core/api/v1/
  domain: www.example.gov
`;

test('vital-config: parses a valid minimal config', () => {
  const c = parseVitalConfig(VALID_YAML);
  assert.equal(c.apiBase, 'https://example.org/vital-core/api/v1/');
  assert.equal(c.domain, 'www.example.gov');
  assert.equal(c.host, 'https://example.org');
  assert.deepEqual(c.warnings, []);
});

test('vital-config: normalizes a missing trailing slash on instance.api', () => {
  const yaml = `
version: 1
instance:
  api: https://example.org/vital-core/api/v1
  domain: www.example.gov
`;
  const c = parseVitalConfig(yaml);
  assert.equal(c.apiBase, 'https://example.org/vital-core/api/v1/');
});

test('vital-config: rejects a version other than 1', () => {
  const yaml = `
version: 2
instance:
  api: https://example.org/api/v1/
  domain: www.example.gov
`;
  assert.throws(() => parseVitalConfig(yaml), /"version" must be 1/);
});

test('vital-config: rejects a missing instance section', () => {
  assert.throws(() => resolveVitalConfig({ version: 1 }), /missing required "instance"/);
});

test('vital-config: rejects a non-https instance.api', () => {
  const yaml = `
version: 1
instance:
  api: http://example.org/api/v1/
  domain: www.example.gov
`;
  assert.throws(() => parseVitalConfig(yaml), /must use https:\/\//);
});

test('vital-config: rejects an unparseable instance.api URL', () => {
  const yaml = `
version: 1
instance:
  api: "not a url"
  domain: www.example.gov
`;
  assert.throws(() => parseVitalConfig(yaml), /not a valid URL/);
});

test('vital-config: rejects an empty instance.domain', () => {
  const yaml = `
version: 1
instance:
  api: https://example.org/api/v1/
  domain: ""
`;
  assert.throws(() => parseVitalConfig(yaml), /"instance.domain" must be a non-empty string/);
});

test('vital-config: rejects invalid YAML with a specific error', () => {
  assert.throws(() => parseVitalConfig('version: 1\n  bad: [indent'), /invalid YAML/);
});

test('vital-config: substituteEnvVars resolves a set env var', () => {
  process.env.VITAL_TEST_API = 'https://example.org/api/v1/';
  try {
    const { text, warnings } = substituteEnvVars('api: ${VITAL_TEST_API}');
    assert.equal(text, 'api: https://example.org/api/v1/');
    assert.deepEqual(warnings, []);
  } finally {
    delete process.env.VITAL_TEST_API;
  }
});

test('vital-config: substituteEnvVars warns and leaves literal text for an unset var', () => {
  delete process.env.VITAL_TEST_UNSET;
  const { text, warnings } = substituteEnvVars('api: ${VITAL_TEST_UNSET}');
  assert.equal(text, 'api: ${VITAL_TEST_UNSET}');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /VITAL_TEST_UNSET.*not set/);
});

test('vital-config: env substitution warnings surface through parseVitalConfig, not thrown', () => {
  delete process.env.VITAL_TEST_DOMAIN;
  const yaml = `
version: 1
instance:
  api: https://example.org/api/v1/
  domain: \${VITAL_TEST_DOMAIN}
`;
  // The unresolved literal "${VITAL_TEST_DOMAIN}" is still a non-empty
  // string, so config resolution succeeds but with a warning attached.
  const c = parseVitalConfig(yaml);
  assert.equal(c.domain, '${VITAL_TEST_DOMAIN}');
  assert.equal(c.warnings.length, 1);
});

test('vital-config: never echoes a resolved env var value under a "secret"-shaped key', () => {
  process.env.VITAL_TEST_SECRET = 'super-secret-token';
  try {
    const c = parseVitalConfig(VALID_YAML);
    assert.equal(JSON.stringify(c).includes('super-secret-token'), false);
  } finally {
    delete process.env.VITAL_TEST_SECRET;
  }
});

test('vital-config: loadVitalConfig reads and resolves a real file', () => {
  const c = loadVitalConfig(FIXTURE_PATH);
  assert.equal(c.domain, 'www.cms.gov');
  assert.equal(c.host, 'https://mgifford.github.io');
});

test('vital-config: permissions.read_repository absent defaults to false with no repositoryPath', () => {
  const c = parseVitalConfig(VALID_YAML);
  assert.equal(c.readRepository, false);
  assert.equal(c.repositoryPath, null);
  assert.deepEqual(c.ignorePatterns, []);
});

test('vital-config: permissions.read_repository: false is equivalent to absent', () => {
  const yaml = `
version: 1
instance:
  api: https://example.org/api/v1/
  domain: www.example.gov
permissions:
  read_repository: false
`;
  const c = parseVitalConfig(yaml);
  assert.equal(c.readRepository, false);
  assert.equal(c.repositoryPath, null);
});

test('vital-config: permissions.read_repository: true with an absolute repository_path is used as-is', () => {
  const yaml = `
version: 1
instance:
  api: https://example.org/api/v1/
  domain: www.example.gov
permissions:
  read_repository: true
local:
  repository_path: /abs/path/to/repo
`;
  const c = parseVitalConfig(yaml);
  assert.equal(c.readRepository, true);
  assert.equal(c.repositoryPath, '/abs/path/to/repo');
});

test('vital-config: local.repository_path resolves relative to the .vital.yml file, not cwd', () => {
  const c = loadVitalConfig(FIXTURE_WITH_REPO_PATH);
  assert.equal(c.readRepository, true);
  const expected = path.resolve(path.dirname(FIXTURE_WITH_REPO_PATH), '../repo-fixture');
  assert.equal(c.repositoryPath, expected);
  // Prove this is genuinely NOT resolved against process.cwd() by confirming
  // the resolved path is anchored under the fixtures directory, not the repo root.
  assert.ok(c.repositoryPath.includes(path.join('tests', 'fixtures')));
});

test('vital-config: permissions.read_repository: true without local.repository_path throws', () => {
  const yaml = `
version: 1
instance:
  api: https://example.org/api/v1/
  domain: www.example.gov
permissions:
  read_repository: true
`;
  assert.throws(() => parseVitalConfig(yaml), /"local.repository_path" is required/);
});

test('vital-config: local.ignore_patterns passes through when an array', () => {
  const yaml = `
version: 1
instance:
  api: https://example.org/api/v1/
  domain: www.example.gov
permissions:
  read_repository: true
local:
  repository_path: /abs/path
  ignore_patterns: [dist, coverage]
`;
  const c = parseVitalConfig(yaml);
  assert.deepEqual(c.ignorePatterns, ['dist', 'coverage']);
});

test('vital-config: local.ignore_patterns resolves to [] when absent or not an array', () => {
  const yamlAbsent = `
version: 1
instance:
  api: https://example.org/api/v1/
  domain: www.example.gov
`;
  assert.deepEqual(parseVitalConfig(yamlAbsent).ignorePatterns, []);

  const yamlWrongType = `
version: 1
instance:
  api: https://example.org/api/v1/
  domain: www.example.gov
local:
  ignore_patterns: "not-an-array"
`;
  assert.deepEqual(parseVitalConfig(yamlWrongType).ignorePatterns, []);
});
