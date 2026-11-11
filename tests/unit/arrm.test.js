import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARRM_SOURCE, ARRM_ROLES, arrmForWcag } from '../../src/lib/arrm.js';

test('ARRM mapping is pinned and covers the WCAG criteria without inventing roles', () => {
  assert.equal(ARRM_SOURCE.revision, '70f9d027d7a87ab72058ded2037915a76795e46a');
  assert.ok(ARRM_SOURCE.url.includes(ARRM_SOURCE.revision));
  const links = arrmForWcag('1.3.2');
  assert.ok(links.tasks.length > 0);
  assert.ok(links.roles.includes('Front-End Development'));
  assert.ok(links.tasks.every((task) => task.wcag_sc === '1.3.2'));
  assert.equal(arrmForWcag('99.99.99').tasks.length, 0);
  assert.ok(ARRM_ROLES.includes('Content Authoring'));
});

test('ARRM keeps 4.1.1 as a WCAG 2.0 mapping and exposes the source note', () => {
  const parsing = arrmForWcag('4.1.1');
  assert.ok(parsing.tasks.length > 0);
  assert.match(ARRM_SOURCE.note, /not an assignment/);
});
