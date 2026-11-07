import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textFragmentUrl } from '../../src/lib/text-fragment.js';

test('builds an encoded native text-fragment link', () => {
  const url = textFragmentUrl({
    url: 'https://example.gov/page?x=1',
    element: { text_anchor: 'Save, changes - now' },
  });
  assert.equal(url, 'https://example.gov/page?x=1#:~:text=Save%2C%20changes%20%2D%20now');
});

test('does not overwrite an existing fragment or invent a text anchor', () => {
  assert.equal(textFragmentUrl({ url: 'https://example.gov/page#section', element: { text_anchor: 'Save' } }), null);
  assert.equal(textFragmentUrl({ url: 'https://example.gov/page', element: {} }), null);
  assert.equal(textFragmentUrl({ url: 'file:///tmp/page', element: { text_anchor: 'Save' } }), null);
  assert.equal(textFragmentUrl({ url: 'https://example.gov/page', element: { text_anchor: 'ab' } }), null);
});
