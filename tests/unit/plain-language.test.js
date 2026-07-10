import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPlainLanguage } from '../../src/engines/plain-language.js';

// A fake Playwright page: runPlainLanguage calls page.evaluate twice —
// first to extract main-content text, then to collect explained acronyms.
// Return the text on the first call and an empty acronym list after.
function fakePage(text) {
  let call = 0;
  return { evaluate: async () => (call++ === 0 ? text : []) };
}

const sentence = 'The quick brown fox jumps over the lazy dog today. ';

test('scores real prose and records no skip reason', async () => {
  const r = await runPlainLanguage(fakePage(sentence.repeat(12)));
  assert.equal(r.scored, true);
  assert.equal(r.scoreSkipReason, null);
  assert.notEqual(r.fleschReadingEase, null);
});

test('too few words is reported as too-little-text, not non-prose', async () => {
  const r = await runPlainLanguage(fakePage('word '.repeat(40)));
  assert.equal(r.scored, false);
  assert.equal(r.scoreSkipReason, 'too-little-text');
  assert.ok(r.wordCount < 100);
});

// Issue #201: a huge tabular page (many words, almost no sentence
// structure) must not be labeled "too little" anything.
test('many words but no prose structure is reported as non-prose', async () => {
  const r = await runPlainLanguage(fakePage('word '.repeat(500)));
  assert.equal(r.scored, false);
  assert.equal(r.scoreSkipReason, 'non-prose');
  assert.ok(r.wordCount >= 100);
  assert.equal(r.fleschKincaidGrade, null);
});
