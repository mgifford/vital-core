import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectStablePerformanceCohort } from '../../src/lib/performance-cohort.js';
import { pageId } from '../../src/lib/urls.js';

const origin = 'https://example.gov';
const page = (path, extra = {}) => ({ url: origin + path, depth: 0, lastScannedWeek: null, ...extra });
function stateOf(entries) {
  return { pages: Object.fromEntries(entries.map(([path, extra]) => [pageId(origin + path), page(path, extra)])) };
}

test('stable cohort includes homepage, priority and one representative per family', () => {
  const state = stateOf([['/', {}], ['/services/', {}], ['/forms/a', {}], ['/forms/b', {}], ['/about', {}]]);
  const target = { pageFamilies: [{ id: 'forms', route: '/forms*' }] };
  const cohort = selectStablePerformanceCohort(state, target, origin);
  const urls = cohort.stable.map((entry) => entry.url);
  assert.ok(urls.includes(origin + '/'));
  assert.equal(cohort.familiesRepresented.length, 1);
  const family = cohort.stable.find((entry) => entry.reason === 'page-family:forms');
  assert.ok(family.url.startsWith(origin + '/forms/'));
  assert.ok(state.pages[pageId(family.url)].performanceCohort.stable);
});

test('a family representative stays stable across later selections', () => {
  const state = stateOf([['/', {}], ['/forms/b', {}], ['/forms/a', {}]]);
  const target = { pageFamilies: [{ id: 'forms', route: '/forms*' }] };
  const first = selectStablePerformanceCohort(state, target, origin);
  const chosen = first.stable.find((entry) => entry.reason === 'page-family:forms').url;
  const second = selectStablePerformanceCohort(state, target, origin);
  const again = second.stable.find((entry) => entry.reason === 'page-family:forms').url;
  assert.equal(again, chosen);
});

test('priority URLs are included and never dropped by the family cap', () => {
  const entries = [['/', {}]];
  for (let i = 0; i < 15; i++) entries.push([`/forms/${i}`, { priority: true }]);
  const state = stateOf(entries);
  const cohort = selectStablePerformanceCohort(state, { pageFamilies: [{ id: 'forms', route: '/forms*' }] }, origin);
  assert.equal(cohort.stable.filter((entry) => entry.reason === 'priority-url').length, 15);
  assert.ok(cohort.stable.some((entry) => entry.reason === 'homepage'));
});
