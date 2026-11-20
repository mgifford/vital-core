import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceRepo, repoUrl, repoBlobBase } from '../../src/lib/repo-links.js';

test('repo-links: an instance uses GITHUB_REPOSITORY', () => {
  const env = { GITHUB_REPOSITORY: 'localgovdrupal/vital-core-lgd' };
  assert.equal(sourceRepo(env), 'localgovdrupal/vital-core-lgd');
  assert.equal(repoUrl(env), 'https://github.com/localgovdrupal/vital-core-lgd');
  assert.equal(repoBlobBase(env), 'https://github.com/localgovdrupal/vital-core-lgd/blob/main');
});

test('repo-links: a local build falls back to upstream', () => {
  assert.equal(sourceRepo({}), 'mgifford/vital-core');
  assert.equal(sourceRepo({ GITHUB_REPOSITORY: '' }), 'mgifford/vital-core');
  assert.equal(sourceRepo({ GITHUB_REPOSITORY: 'not a slug' }), 'mgifford/vital-core');
  assert.equal(sourceRepo({ GITHUB_REPOSITORY: 'owner/name/extra' }), 'mgifford/vital-core');
});
