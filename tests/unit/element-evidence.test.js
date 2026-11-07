import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  condenseInstance,
  sanitizeElementEvidence,
  sanitizeSemanticContext,
  safeSelector,
  MAX_RULE_INSTANCES,
} from '../../src/lib/element-evidence.js';

const element = {
  available: true,
  selector: 'button[aria-label="Opt-Outs"]',
  selector_matches: 1,
  tag: 'button',
  role: null,
  name: 'Opt-Outs',
  name_source: 'aria-label',
  labelledby_ids: [],
  id: 'cmp-opt-out',
  shadow: false,
  iframe: false,
  visible: true,
  rect: { x: 10, y: 20, width: 30, height: 40 },
  text_anchor: 'Opt out of sale',
  ancestry: [
    { tag: 'body', role: null, name: null, name_source: 'none' },
    { tag: 'main', role: null, name: null, name_source: 'none' },
    { tag: 'div', role: 'dialog', name: 'Privacy', name_source: 'aria-label' },
    { tag: 'button', role: null, name: 'Opt-Outs', name_source: 'aria-label' },
  ],
};

const semantic = {
  nearest_region: { role: 'main', name: null, unnamed: true },
  region_ancestry: [{ role: 'main', name: null, unnamed: true }],
  widget: { role: 'dialog', name: 'Privacy', unnamed: false },
  widget_ancestry: [{ role: 'dialog', name: 'Privacy', unnamed: false }],
  path: [{ role: 'main', name: null, unnamed: true }, { role: 'dialog', name: 'Privacy', unnamed: false }],
  in_dialog: true,
  unnamed_landmarks: [],
  unclassified: false,
  ancestry_complete: true,
  ancestry_depth: 6,
};

test('element evidence: public copy drops ids and ancestry but keeps locator facts', () => {
  const safe = sanitizeElementEvidence(element);
  assert.equal(safe.selector, 'button[aria-label="Opt-Outs"]');
  assert.equal(safe.selector_matches, 1);
  assert.equal(safe.tag, 'button');
  assert.equal(safe.name, 'Opt-Outs');
  assert.equal(safe.rect.width, 30);
  assert.equal(safe.text_anchor, 'Opt out of sale');
  assert.equal('id' in safe, false);
  assert.equal('ancestry' in safe, false);
});

test('element evidence: unavailable evidence states the reason instead of inventing fields', () => {
  assert.deepEqual(sanitizeElementEvidence({ available: false, reason: 'not-found' }), { available: false, reason: 'not-found' });
  assert.equal(sanitizeElementEvidence(null), null);
});

test('element evidence: unsafe selectors are withheld from public output', () => {
  assert.equal(safeSelector('text: "Private"'), null);
  assert.equal(safeSelector('input[value="PRIVATE"]'), null);
  assert.equal(safeSelector('input[data-token="PRIVATE"]'), null);
  assert.equal(safeSelector('<button>'), null);
  assert.equal(safeSelector('button[aria-label="Opt-Outs"]'), 'button[aria-label="Opt-Outs"]');
  assert.equal(safeSelector('x'.repeat(1100)).length, 1000);
  assert.equal(safeSelector(null), null);
});

test('element evidence: condenseInstance keeps bounded evidence and drops unknown fields', () => {
  const condensed = condenseInstance({ url: 'https://example.gov/cookies', target: element.selector, html: '<button>', element, component: 'cmp', secret: 'PRIVATE' });
  assert.equal(condensed.url, 'https://example.gov/cookies');
  assert.equal(condensed.target, element.selector);
  assert.equal(condensed.component, 'cmp');
  assert.equal(condensed.element.selector_matches, 1);
  assert.equal('secret' in condensed, false);
  assert.equal(condensed.element.id, 'cmp-opt-out');
  assert.equal(condensed.element.text_anchor, 'Opt out of sale');
});

test('element evidence: condenseInstance omits evidence keys it does not have', () => {
  const condensed = condenseInstance({ url: 'https://example.gov/a', target: 'li', html: '<li>' });
  assert.deepEqual(Object.keys(condensed).sort(), ['html', 'target', 'url']);
});

test('element evidence: the per-rule instance cap is the documented five', () => {
  assert.equal(MAX_RULE_INSTANCES, 5);
});

test('semantic context sanitizer returns a deep copy', () => {
  const safe = sanitizeSemanticContext(semantic);
  assert.deepEqual(safe, semantic);
  safe.region_ancestry[0].name = 'mutated';
  assert.equal(semantic.region_ancestry[0].name, null);
  assert.equal(sanitizeSemanticContext(null), null);
});

test('element evidence: raw ancestry is never carried into the stored instance', () => {
  const condensed = condenseInstance({ url: 'https://example.gov/a', target: 'button', html: null, element, semantic_context: semantic });
  assert.equal('ancestry' in condensed.element, false);
  assert.equal(condensed.element.id, 'cmp-opt-out');
  assert.equal(condensed.element.text_anchor, 'Opt out of sale');
  assert.equal(condensed.semantic_context.nearest_region.role, 'main');
});

test('element evidence: unavailable element clones keep the reason and selector only', () => {
  const condensed = condenseInstance({ url: 'https://example.gov/a', target: 'text: "x"', html: null, element: { available: false, reason: 'not-found', selector: 'text: "x"' } });
  assert.deepEqual(condensed.element, { available: false, reason: 'not-found', selector: 'text: "x"' });
});
