import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePageFamilies, createPageFamilyTracker } from '../../src/lib/page-families.js';
import { normalizeUrl, pageId } from '../../src/lib/urls.js';

const families = resolvePageFamilies([{ id: 'feedback-form', label: 'Feedback form', route: '/feedback', state_params: ['rating'], variant_params: ['page', 'title'] }], 'test');
const base = 'https://go.example.test';

function run(urls) {
  const tracker = createPageFamilyTracker(families);
  for (const url of urls) tracker.observe(url);
  return tracker.finalize();
}

test('feedback URLs differing by parent page and rating count as one declared implementation', () => {
  const result = run([
    `${base}/feedback?page=%2Fa&rating=Good&title=A`,
    `${base}/feedback?page=%2Fb&rating=Good&title=B`,
    `${base}/feedback?page=%2Fa&rating=Poor&title=A`,
    `${base}/feedback?page=%2Fc&rating=Ok&title=C`,
    `${base}/contact-us`,
    `${base}/housing`,
  ]);
  const [family] = result.families;
  assert.equal(result.urls_total, 6);
  assert.equal(result.urls_in_families, 4);
  assert.equal(result.urls_outside_families, 2);
  assert.equal(result.known_implementation_count, 1);
  assert.equal(family.url_count, 4);
  assert.deepEqual(family.states.rating, { Good: 2, Ok: 1, Poor: 1 });
  assert.deepEqual(family.variants, { page: { distinct_values: 3 }, title: { distinct_values: 3 } });
  assert.equal(family.implementation_basis, 'configured_route');
  assert.equal(family.representative_sampling, 'not_applied');
});

test('a genuinely different page state is kept as its own URL and is not folded into the family', () => {
  const result = run([`${base}/feedback?page=%2Fa&rating=Good`, `${base}/feedback/thanks`, `${base}/feedbackx`]);
  assert.equal(result.families[0].url_count, 1, 'only the exact route matches');
  assert.equal(result.urls_outside_families, 2);
});

test('family counts leave URL identity unchanged: every state variant is still its own page', () => {
  const ids = ['Good', 'Poor', 'Ok'].map((rating) => pageId(normalizeUrl(`${base}/feedback?page=%2Fa&rating=${rating}&utm_source=mail`, base, 'go.example.test')));
  assert.equal(new Set(ids).size, 3);
});

test('no configured families means no model', () => {
  const tracker = createPageFamilyTracker([]);
  tracker.observe(`${base}/feedback`);
  assert.equal(tracker.finalize(), null);
  assert.deepEqual(resolvePageFamilies(undefined), []);
});

test('route prefixes and invalid configuration', () => {
  const prefix = resolvePageFamilies([{ id: 'news', route: '/newsroom/*' }]);
  const tracker = createPageFamilyTracker(prefix);
  tracker.observe(`${base}/newsroom/story-1`);
  tracker.observe(`${base}/newsroom`);
  assert.equal(tracker.finalize().families[0].url_count, 1);
  assert.throws(() => resolvePageFamilies([{ id: 'Bad', route: 'feedback' }, { id: 'x', route: '/x', state_params: 'rating' }], 'cfg'), (error) => {
    assert.match(error.message, /id must be lowercase/);
    assert.match(error.message, /route must be a path/);
    assert.match(error.message, /state_params must be a list/);
    return true;
  });
});

test('state values are capped so a free-text parameter cannot grow the summary', () => {
  const tracker = createPageFamilyTracker(resolvePageFamilies([{ id: 'f', route: '/feedback', state_params: ['rating'] }]));
  for (let i = 0; i < 40; i++) tracker.observe(`${base}/feedback?rating=v${i}`);
  const states = tracker.finalize().families[0].states.rating;
  assert.ok(Object.keys(states).length <= 21);
  assert.equal(states['(other)'], 20);
});
