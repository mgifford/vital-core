import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { runComponentObservation } from '../../src/engines/component-observation.js';
import { resolveComponentSignatures, createSharedComponentTracker } from '../../src/lib/shared-components.js';

const signatures = resolveComponentSignatures([{ id: 'consent', label: 'Consent dialog', class_prefixes: ['qc-cmp2'] }, { id: 'chat', label: 'Chat', attributes: [{ name: 'data-widget', value: 'chat' }] }]);

const OPEN = `<main><h1>Page</h1><p class="qc-cmp20-banner">look-alike</p></main>
<div role="dialog" class="qc-cmp2-container"><div class="qc-cmp2-footer"><button class="qc-cmp2-btn">  AGREE  </button><button aria-label="Disagree" class="qc-cmp2-btn"></button></div></div>
<div data-widget="chat" style="display:none"><button>Hidden chat</button></div>`;
const CLOSED = '<main><h1>Page</h1><p class="qc-cmp20-banner">look-alike</p></main>';

async function observe(html) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const before = await page.content();
    const result = await runComponentObservation(page, signatures);
    assert.equal(await page.content(), before, 'observation must not change the page');
    return result;
  } finally { await browser.close(); }
}

test('observation records presence, visibility, dialog role and button labels for an open component', async () => {
  const { components } = await observe(OPEN);
  const consent = components.find((c) => c.id === 'consent');
  assert.equal(consent.present, true);
  assert.equal(consent.dialog, true);
  assert.ok(consent.visible_count >= 1);
  assert.deepEqual(consent.button_labels, ['AGREE', 'Disagree']);
  const chat = components.find((c) => c.id === 'chat');
  assert.equal(chat.present, true, 'present but display:none');
  assert.equal(chat.visible_count, 0);
  assert.deepEqual(chat.button_labels, [], 'hidden buttons are not reported');
});

test('a closed state and look-alike classes record as absent', async () => {
  const { components } = await observe(CLOSED);
  assert.deepEqual(components.map((c) => [c.id, c.present, c.dialog]), [['consent', false, false], ['chat', false, false]]);
});

test('observations roll up per component and stay absent when never observed', async () => {
  const tracker = createSharedComponentTracker(signatures);
  tracker.observeState((await observe(OPEN)));
  tracker.observeState((await observe(CLOSED)));
  tracker.observeState(undefined);
  const model = tracker.finalize({ pagesAudited: 2 });
  const consent = model.components.find((c) => c.id === 'consent').observation;
  assert.deepEqual([consent.pages_observed, consent.pages_present, consent.pages_with_dialog], [2, 1, 1]);
  assert.deepEqual(consent.button_labels, [{ label: 'AGREE', pages: 1 }, { label: 'Disagree', pages: 1 }]);
  assert.equal(consent.basis, 'best_effort_at_audit_time');
  const none = createSharedComponentTracker(signatures);
  assert.equal(none.finalize().components[0].observation, null);
});

test('annotateComponentExamples marks elements inside a component by real DOM ancestry only', async () => {
  const { annotateComponentExamples } = await import('../../src/engines/component-observation.js');
  const html = `<main><p id="outside" style="color:#aaa">outside</p></main>
<div class="qc-cmp2-container"><section><p id="inside-note">inside</p></section></div>
<div class="qc-cmp20-banner"><p id="lookalike">look-alike</p></div>`;
  const axe = { violations: { 'color-contrast': { examples: [{ target: '#outside' }, { target: '#inside-note' }, { target: '#lookalike' }, { target: 'p[' }, { target: 'text: "x"' }] } } };
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    await annotateComponentExamples(page, signatures, axe);
  } finally { await browser.close(); }
  assert.deepEqual(axe.violations['color-contrast'].examples.map((e) => e.component ?? null), [null, 'consent', null, null, null]);
});
