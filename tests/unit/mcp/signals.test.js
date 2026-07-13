import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSignals } from '../../../mcp/local/signals.js';

test('signals: extracts a css_class signal', () => {
  const signals = extractSignals({ html_snippet: '<div class="hero-banner-distinctive">Hi</div>' });
  assert.ok(signals.some((s) => s.type === 'css_class' && s.value === 'hero-banner-distinctive'));
});

test('signals: extracts a css_id signal', () => {
  const signals = extractSignals({ html_snippet: '<div id="main-nav-header">Hi</div>' });
  assert.ok(signals.some((s) => s.type === 'css_id' && s.value === 'main-nav-header'));
});

test('signals: extracts data_attr signals', () => {
  const signals = extractSignals({ html_snippet: '<div data-component="hero-banner" data-track="click">Hi</div>' });
  assert.ok(signals.some((s) => s.type === 'data_attr' && s.value === 'data-component=hero-banner'));
  assert.ok(signals.some((s) => s.type === 'data_attr' && s.value === 'data-track=click'));
});

test('signals: extracts an asset_url signal', () => {
  const signals = extractSignals({ html_snippet: '<link href="/assets/hero-banner.css">' });
  assert.ok(signals.some((s) => s.type === 'asset_url' && s.value === '/assets/hero-banner.css'));
});

test('signals: extracts a distinctive text run, filters boilerplate/short text', () => {
  const long = extractSignals({ html_snippet: '<p>Schedule your appointment with a specialist today</p>' });
  assert.ok(long.some((s) => s.type === 'text'));

  const short = extractSignals({ html_snippet: '<p>the and for</p>' });
  assert.ok(!short.some((s) => s.type === 'text'));
});

test('signals: empty or missing html_snippet returns an empty array without throwing', () => {
  assert.deepEqual(extractSignals({ html_snippet: '' }), []);
  assert.deepEqual(extractSignals({}), []);
  assert.deepEqual(extractSignals(null), []);
  assert.deepEqual(extractSignals(undefined), []);
});

test('signals: adversarial input (path traversal / shell metacharacters) is extracted as inert literal text, never interpreted', () => {
  const pathTraversal = extractSignals({ html_snippet: '<div class="../../etc/passwd">x</div>' });
  const traversalSignal = pathTraversal.find((s) => s.type === 'css_class');
  assert.equal(traversalSignal.value, '../../etc/passwd');

  const shellMeta = extractSignals({ html_snippet: '<div data-x="$(rm -rf /)">x</div>' });
  const shellSignal = shellMeta.find((s) => s.type === 'data_attr');
  assert.equal(shellSignal.value, 'data-x=$(rm -rf /)');

  // Neither call throws or behaves differently from ordinary input — proven
  // simply by both assertions above succeeding without an exception.
});
