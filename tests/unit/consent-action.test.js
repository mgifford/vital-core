import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { resolveConsentHandling, runConsentAction } from '../../src/engines/consent-action.js';
import { resolveComponentSignatures, createSharedComponentTracker } from '../../src/lib/shared-components.js';

const signatures = resolveComponentSignatures([{ id: 'consent-dialog', class_prefixes: ['qc-cmp2'] }]);
const base = { component: 'consent-dialog', reject_selectors: ['#disagree-btn'], accept_selectors: ['#accept-btn'] };

test('consent handling is off unless configured and defaults to rejecting', () => {
  assert.equal(resolveConsentHandling(undefined, signatures), null);
  const cfg = resolveConsentHandling(base, signatures);
  assert.equal(cfg.choice, 'reject');
  assert.equal(cfg.wait_ms, 2000);
  assert.deepEqual(cfg.selectors.reject, ['#disagree-btn']);
});

test('invalid consent handling reports every problem', () => {
  assert.throws(() => resolveConsentHandling({ choice: 'maybe', component: 'nope', wait_ms: -1, reject_selectors: 'x' }, signatures, 'cfg'), (error) => {
    assert.match(error.message, /choice must be reject or accept/);
    assert.match(error.message, /"nope" is not a configured component_signatures id/);
    assert.match(error.message, /reject_selectors must be a list/);
    assert.match(error.message, /wait_ms must be a whole number/);
    return true;
  });
  assert.throws(() => resolveConsentHandling({ component: 'consent-dialog', choice: 'accept' }, signatures), /accept_selectors needs at least one selector/);
});

const DIALOG = (extra = '') => `<main><h1>Page</h1></main>
<div id="qc-cmp2-ui" role="dialog"><button id="more-options-btn" onclick="window.__clicked='more'">MORE OPTIONS</button>
<button id="disagree-btn" onclick="window.__clicked='reject';document.getElementById('qc-cmp2-ui').remove()">DISAGREE</button>
<button id="accept-btn" onclick="window.__clicked='accept';document.getElementById('qc-cmp2-ui').remove()">AGREE</button>${extra}</div>`;

async function withPage(html, fn) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    return await fn(page);
  } finally { await browser.close(); }
}

test('the chosen configured button is clicked through the dialog itself, and only that one', async () => {
  const rejected = await withPage(DIALOG(), async (page) => {
    const result = await runConsentAction(page, resolveConsentHandling({ ...base, wait_ms: 0 }, signatures));
    return { result, clicked: await page.evaluate(() => window.__clicked), dialogGone: await page.locator('#qc-cmp2-ui').count() === 0 };
  });
  assert.deepEqual(rejected.result, { clicked: true, selector: '#disagree-btn' });
  assert.equal(rejected.clicked, 'reject', 'agree and more-options were not touched');
  assert.equal(rejected.dialogGone, true);
  const accepted = await withPage(DIALOG(), async (page) => {
    await runConsentAction(page, resolveConsentHandling({ ...base, choice: 'accept', wait_ms: 0 }, signatures));
    return page.evaluate(() => window.__clicked);
  });
  assert.equal(accepted, 'accept', 'accept happens only when explicitly configured');
});

test('nothing is clicked when no configured button is visible, and unconfigured buttons are never guessed', async () => {
  const none = await withPage('<main><h1>No dialog</h1><button onclick="window.__clicked=\'other\'">Agree</button></main>', async (page) => ({
    result: await runConsentAction(page, resolveConsentHandling({ ...base, wait_ms: 0 }, signatures)),
    clicked: await page.evaluate(() => window.__clicked ?? null),
  }));
  assert.deepEqual(none.result, { clicked: false, selector: null });
  assert.equal(none.clicked, null);
  const hidden = await withPage(DIALOG().replace('id="disagree-btn"', 'id="disagree-btn" style="display:none"'), async (page) => ({
    result: await runConsentAction(page, resolveConsentHandling({ ...base, wait_ms: 0 }, signatures)),
    clicked: await page.evaluate(() => window.__clicked ?? null),
  }));
  assert.equal(hidden.result.clicked, false, 'a hidden button is not clicked');
  assert.equal(hidden.clicked, null);
  const fallback = await withPage(DIALOG(), async (page) => runConsentAction(page, resolveConsentHandling({ ...base, reject_selectors: ['#missing', '#disagree-btn'], wait_ms: 0 }, signatures)));
  assert.equal(fallback.selector, '#disagree-btn', 'selectors are tried in order');
});

test('consent states roll up per run and are absent when handling is not used', () => {
  const tracker = createSharedComponentTracker(signatures);
  for (const state of ['dialog_open_then_clicked', 'after_decision', 'after_decision', 'no_dialog']) tracker.observeConsent({ state, choice: 'reject' });
  tracker.observeConsent(undefined);
  const model = tracker.finalize({ pagesAudited: 4 });
  assert.deepEqual(model.consent_handling, { choice: 'reject', pages_by_state: { after_decision: 2, dialog_open_then_clicked: 1, no_dialog: 1 } });
  assert.equal('consent_handling' in createSharedComponentTracker(signatures).finalize(), false);
});
