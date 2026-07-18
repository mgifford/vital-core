import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMisspellings } from '../../src/lib/spell.js';

// Regression: a GitHub Actions run crashed in aggregate.js's summarizeRecords
// with "Cannot read properties of undefined (reading 'length')" at
// `misspellingCounts[w] ??= {...}`. Cause: misspellingCounts/acronymCounts
// were plain `{}` objects keyed by words scraped from arbitrary page prose.
// A page containing a real-but-misspelled-looking word that also names an
// Object.prototype member (e.g. "constructor", "toString",
// "hasOwnProperty") resolves `obj[w]` through the prototype chain to that
// inherited function — which is not undefined, so `??=` never replaces it,
// and `.examplePages` is undefined on it. The fix is Object.create(null).
// This test reproduces the exact accumulation pattern used in aggregate.js.

function accumulate(container, words) {
  for (const w of words) {
    const entry = (container[w] ??= { pages: 0, examplePages: [] });
    entry.pages++;
    if (entry.examplePages.length < 5) entry.examplePages.push('https://example.gov/page');
  }
  return container;
}

test('findMisspellings can flag real Object.prototype member names as misspelled', () => {
  const { misspelled } = findMisspellings(['constructor', 'toString', 'hasOwnProperty', 'watsit'], 25, []);
  assert.ok(misspelled.includes('toString'), 'toString is treated as an ordinary unrecognized word');
  assert.ok(misspelled.includes('hasOwnProperty'), 'hasOwnProperty is treated as an ordinary unrecognized word');
});

test('a plain {} accumulator crashes on a prototype-colliding key (documents the bug)', () => {
  assert.throws(
    () => accumulate({}, ['constructor']),
    /Cannot read propert(y|ies) of undefined/,
    'plain object map crashes exactly as seen in the CI failure',
  );
});

test('Object.create(null) accumulator survives every Object.prototype member name as a key', () => {
  const dangerous = ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf', 'watch', 'length'];
  const container = accumulate(Object.create(null), dangerous);
  for (const w of dangerous) {
    assert.equal(container[w].pages, 1, `"${w}" tracked as its own entry, not inherited`);
    assert.deepEqual(container[w].examplePages, ['https://example.gov/page']);
  }
  // Object.entries still works normally for the aggregate.js consumer sites.
  assert.equal(Object.entries(container).length, dangerous.length);
});
