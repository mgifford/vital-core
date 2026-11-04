import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveComponentSignatures, createSharedComponentTracker, attachComponentScope, scopeViewsFor, describeExample, matchSignature,
} from '../../src/lib/shared-components.js';

const consent = resolveComponentSignatures([{
  id: 'consent-dialog', label: 'Consent dialog', class_prefixes: ['qc-cmp2'], script_origins: ['inmobi.com'],
}], 'test')[0];

const toggle = { target: '.qc-cmp2-expandable-info:nth-child(1) > .qc-cmp2-toggle-switch > .css-w01txj.qc-cmp2-toggle[role="switch"]', html: '<button role="switch" class="qc-cmp2-toggle css-w01txj"><div class="toggle"></div>' };
const listHeader = { target: 'button[aria-label="Opt-Outs"]', html: '<button role="listitem" class="qc-cmp2-list-item-header" aria-label="Opt-Outs">' };
const listItem = { target: '#Google\\ Basic\\ Consents', html: '<li id="Google Basic Consents" class="qc-cmp2-list-item" role="list">' };
const hashedOnly = { target: 'div:nth-child(2) > .css-cf00qb > .css-jg567y', html: '<p class="css-jg567y">Opted In</p>' };
const honeypot = { target: '.js-form-type-textfield', html: '<div aria-labelledby="edit-url-label" class="js-form-item form-item js-form-type-textfield">' };

function track(signatures, observations, thirdParty = null) {
  const tracker = createSharedComponentTracker(signatures);
  for (const [engine, rule, url, examples, count] of observations) tracker.observe(engine, rule, url, examples, count ?? examples.length);
  return tracker.finalize({ thirdParty, pagesAudited: 10 });
}

test('signature validation reports every problem and rejects a signal-free signature', () => {
  assert.throws(() => resolveComponentSignatures([{ id: 'Bad Id' }, { id: 'ok' }, { id: 'ok', class_names: ['a'] }], 'cfg'), (error) => {
    assert.match(error.message, /id must be lowercase/);
    assert.match(error.message, /needs at least one of/);
    assert.match(error.message, /duplicate id "ok"/);
    return true;
  });
  assert.deepEqual(resolveComponentSignatures(undefined), []);
  assert.throws(() => resolveComponentSignatures([{ id: 'x', class_names: ['a'], min_signals: 9 }]), /min_signals/);
});

test('class matching honours boundaries and ignores children and unrelated look-alike classes', () => {
  const own = (html, target = '') => matchSignature({ html, target }, consent);
  assert.ok(own('<div class="qc-cmp2-container">').has('class'));
  assert.ok(own('<div class="qc-cmp2">').has('class'));
  assert.equal(own('<div class="qc-cmp20-container">').size, 0, 'digit continues the prefix');
  assert.equal(own('<div class="my-qc-cmp2-thing">').size, 0, 'prefix must start the token');
  assert.equal(own('<div class="wrapper"><span class="qc-cmp2-x">').size, 0, 'child classes do not attribute the element');
});

test('ancestry is read from the selector, with escapes and sibling combinators respected', () => {
  const described = describeExample({ target: '.qc-cmp2-expandable-info:nth-child(1) > .qc-cmp2-toggle-switch > .css-w01txj' });
  assert.deepEqual(described.ancestorClasses.sort(), ['qc-cmp2-expandable-info', 'qc-cmp2-toggle-switch']);
  const signals = matchSignature({ target: '.qc-cmp2-box > .inner-thing', html: '<p class="inner-thing">' }, consent);
  assert.deepEqual([...signals], ['ancestry']);
  assert.equal(describeExample({ target: '#Google\\ Basic\\ Consents' }).ids[0], 'Google Basic Consents');
  assert.equal(matchSignature({ target: '.qc-cmp2-box + .inner', html: '<p class="inner">' }, consent).size, 0, 'siblings are not ancestors');
  assert.equal(describeExample({ target: 'text: "Opted In"' }).structured, false);
  assert.equal(describeExample({ target: '<button class="qc-cmp2-toggle">' }).classes[0], 'qc-cmp2-toggle');
});

test('one component can hold several distinct defects, each kept as its own finding', () => {
  const origin = { vendors: [{ origin: 'inmobi.com', pages: 152 }] };
  const model = track([consent], [
    ['axe-core', 'button-name', 'https://x.test/a', [toggle]],
    ['axe-core', 'aria-allowed-role', 'https://x.test/a', [listHeader]],
    ['axe-core', 'aria-required-children', 'https://x.test/a', [listItem]],
    ['axe-core', 'button-name', 'https://x.test/b', [toggle]],
  ], origin);
  assert.equal(model.counts.engine_findings, 3);
  assert.equal(model.counts.shared_component, 3);
  const buttonName = model.rules['axe-core:button-name'];
  assert.equal(buttonName.pages, 2);
  assert.equal(buttonName.pages_in_component, 2);
  assert.deepEqual(buttonName.signals.sort(), ['ancestry', 'class', 'script_origin']);
  assert.equal(buttonName.confidence, 'high');
  assert.equal(model.components[0].findings.length, 3, 'distinct rules are not merged');
  assert.equal(model.components[0].pages_with_component_evidence, 2);
});

test('a single CSS prefix alone is only a candidate, never a verified component', () => {
  const model = track([consent], [['axe-core', 'list', 'https://x.test/a', [listHeader]]], { vendors: [] });
  const rule = model.rules['axe-core:list'];
  assert.equal(rule.classification, 'candidate_shared_component');
  assert.equal(rule.verified, false);
  assert.equal(rule.confidence, 'low');
  assert.equal(model.components[0].verified, false);
  assert.equal(scopeViewsFor({ component_scope: rule }).pageSpecific, true, 'candidates stay in the page-specific view');
  assert.equal(scopeViewsFor({ component_scope: rule }).sharedComponent, true);
});

test('findings inside and outside the component, and look-alike classes, are separated', () => {
  const origin = { vendors: [{ origin: 'inmobi.com', pages: 5 }] };
  const lookAlike = { target: '.qc-cmp20-banner', html: '<div class="qc-cmp20-banner">' };
  const model = track([consent], [
    ['axe-core', 'color-contrast', 'https://x.test/a', [toggle, hashedOnly]],
    ['axe-core', 'region', 'https://x.test/a', [lookAlike]],
    ['axe-core', 'aria-prohibited-attr', 'https://x.test/a', [honeypot]],
    ['alfa', 'sia-r66', 'https://x.test/a', [{ target: 'text: "Opted In"' }]],
  ], origin);
  assert.equal(model.rules['axe-core:color-contrast'].classification, 'mixed');
  assert.equal(model.rules['axe-core:color-contrast'].examples_outside_component, 1);
  assert.equal(model.rules['axe-core:region'].classification, 'not_attributed');
  assert.equal(model.rules['axe-core:aria-prohibited-attr'].classification, 'not_attributed');
  assert.equal(model.rules['alfa:sia-r66'].classification, 'undetermined', 'text-only evidence cannot attribute');
  const mixed = { component_scope: model.rules['axe-core:color-contrast'] };
  assert.deepEqual(scopeViewsFor(mixed), { fullPage: true, pageSpecific: true, sharedComponent: true });
  assert.deepEqual(scopeViewsFor({ component_scope: model.rules['axe-core:aria-prohibited-attr'] }), { fullPage: true, pageSpecific: true, sharedComponent: false });
});

test('only verified shared findings leave the page-specific view and the sample basis is disclosed', () => {
  const origin = { vendors: [{ origin: 'cdn.inmobi.com', pages: 3 }] };
  const model = track([consent], [['axe-core', 'button-name', 'https://x.test/a', [toggle], 40]], origin);
  const scope = model.rules['axe-core:button-name'];
  assert.equal(scope.verified, true);
  assert.equal(scope.sample_complete, false, '40 instances but one stored example');
  assert.equal(scope.basis, 'stored_examples');
  assert.deepEqual(scopeViewsFor({ component_scope: scope }), { fullPage: true, pageSpecific: false, sharedComponent: true });
});

test('attachComponentScope is additive and a no-op without signatures', () => {
  const bugs = [{ engine_key: 'axe-core', rule_id: 'list', pattern_id: 'VS-1', instance_id: 'VS-2' }];
  assert.equal(track([], [['axe-core', 'list', 'u', [listHeader]]]), null);
  attachComponentScope(bugs, null);
  assert.equal('component_scope' in bugs[0], false);
  const model = track([consent], [['axe-core', 'list', 'https://x.test/a', [listHeader]]]);
  attachComponentScope(bugs, model);
  assert.equal(bugs[0].component_scope.component_id, 'consent-dialog');
  assert.equal(bugs[0].pattern_id, 'VS-1', 'stable identifiers are untouched');
  assert.equal(scopeViewsFor({}).pageSpecific, true, 'findings without scope stay in every view');
});

test('a closed consent state produces no component evidence at all', () => {
  const model = track([consent], [['axe-core', 'color-contrast', 'https://x.test/a', [hashedOnly]]]);
  assert.equal(model.components[0].pages_with_component_evidence, 0);
  assert.equal(model.components[0].verified, false);
  assert.equal(model.counts.shared_component, 0);
});

test('a scan-time component mark attributes an element whose stored selector shows no ancestry', () => {
  const origin = { vendors: [{ origin: 'inmobi.com', pages: 3 }] };
  const marked = { target: 'div:nth-child(2) > .css-cf00qb > .css-jg567y', html: '<p class="css-jg567y">Opted In</p>', component: 'consent-dialog' };
  const model = track([consent], [
    ['axe-core', 'color-contrast', 'https://x.test/a', [marked]],
    ['axe-core', 'region', 'https://x.test/a', [hashedOnly]],
  ], origin);
  const contrast = model.rules['axe-core:color-contrast'];
  assert.equal(contrast.classification, 'shared_component');
  assert.deepEqual(contrast.signals.sort(), ['dom_ancestry', 'script_origin']);
  assert.equal(contrast.verified, true);
  assert.equal(model.rules['axe-core:region'].classification, 'not_attributed', 'unmarked look-alike stays unattributed');
  assert.equal(matchSignature({ target: 'text: "x"', component: 'other' }, consent).size, 0, 'a mark for another component does not count');
});

test('without the script origin a mark alone is only a candidate', () => {
  const model = track([consent], [['axe-core', 'color-contrast', 'https://x.test/a', [{ target: '#a', html: '<p id="a">x</p>', component: 'consent-dialog' }]]], { vendors: [] });
  assert.equal(model.rules['axe-core:color-contrast'].classification, 'candidate_shared_component');
});

test('actionIdsOutsideComponents drops only verified shared findings and keeps order', async () => {
  const { actionIdsOutsideComponents } = await import('../../src/lib/shared-components.js');
  const model = { rules: { 'axe-core:a': { classification: 'shared_component', verified: true }, 'axe-core:b': { classification: 'mixed', verified: true }, 'axe-core:c': { classification: 'candidate_shared_component', verified: false } } };
  const clusters = ['a', 'b', 'c', 'd'].map((rule, i) => ({ id: `cc-${i}`, engine_key: 'axe-core', rule_id: rule }));
  assert.deepEqual(actionIdsOutsideComponents(clusters, model), ['cc-1', 'cc-2', 'cc-3']);
  assert.deepEqual(actionIdsOutsideComponents(clusters, model, 2), ['cc-1', 'cc-2']);
  assert.equal(actionIdsOutsideComponents(clusters, null), null);
});
