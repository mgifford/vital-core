import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  INSPECT_HASH,
  inspectUrlFor,
  inspectUnavailableReason,
  inspectUnavailableText,
  inspectBookmarklet,
  vitalInspect,
} from '../../src/lib/live-inspect.js';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'live-inspect.html');

const bug = (over = {}) => {
  const base = {
    url: 'https://example.gov/page?x=1',
    selector: '#named',
    rule_id: 'button-name',
    rule_label: 'Buttons must have discernible text',
    wcag_sc: '4.1.2',
    remediation_tip: 'Add an accessible name.',
    occurrence_id: 'VO-abc12345',
    element: { available: true, tag: 'button', role: null, name: 'Save changes', name_source: 'aria-label' },
  };
  return { ...base, ...over, element: { ...base.element, ...(over.element ?? {}) } };
};

async function withFixture(fn) {
  const html = fs.readFileSync(FIXTURE);
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    await fn({ browser, base: `http://127.0.0.1:${server.address().port}` });
  } finally {
    await browser.close();
    server.close();
  }
}

async function openInspect(page, base, over = {}) {
  const url = inspectUrlFor(bug({ url: `${base}/page`, ...over }));
  assert.ok(url, 'inspect URL generated');
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(vitalInspect);
}

test('inspect URL carries a compact payload for the live page', () => {
  const url = inspectUrlFor(bug());
  assert.ok(url.startsWith('https://example.gov/page?x=1#vital-inspect='));
  const token = url.split(`${INSPECT_HASH}=`)[1];
  const payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  assert.equal(payload.s, '#named');
  assert.equal(payload.t, 'button');
  assert.equal(payload.r, null);
  assert.equal(payload.n, 'Save changes');
  assert.equal(payload.ns, 'aria-label');
  assert.equal(payload.rule, 'button-name');
  assert.equal(payload.w, '4.1.2');
  assert.equal(payload.fix, 'Add an accessible name.');
  assert.equal(payload.o, 'VO-abc12345');

  const withHash = inspectUrlFor(bug({ url: 'https://example.gov/page#section' }));
  assert.match(withHash, /#section&vital-inspect=/);
});

test('inspect URL is null when the live highlight cannot be honest', () => {
  assert.equal(inspectUrlFor(bug({ url: 'file:///tmp/page.html' })), null);
  assert.equal(inspectUrlFor(bug({ selector: '' })), null);
  assert.equal(inspectUrlFor(bug({ url: null })), null);
  assert.equal(inspectUrlFor(bug({ element: { available: true, shadow: true } })), null);
  assert.equal(inspectUrlFor(bug({ element: { available: true, iframe: true } })), null);
  assert.equal(inspectUrlFor(bug({ element: { available: false, reason: 'frame-or-shadow-path' } })), null);
  assert.equal(inspectUnavailableReason(bug({ element: { available: true, shadow: true } })), 'shadow-root');
  assert.match(inspectUnavailableText('shadow-root'), /shadow root/i);
  assert.match(inspectUnavailableText('frame-or-shadow-path'), /frame or shadow root/i);
});

test('the bookmarklet is a self-contained javascript URL', () => {
  const code = inspectBookmarklet();
  assert.ok(code.startsWith('javascript:('));
  assert.match(code, /vital-inspect=/);
  assert.match(code, /Element not found/);
  assert.doesNotMatch(code, /https:\/\/cdn|fetch\(/);
  assert.doesNotMatch(code, /INSPECT_HASH/);
});

test('a unique element with recorded name identity is matched, not called a reproduction', async () => {
  await withFixture(async ({ browser, base }) => {
    const page = await browser.newPage();
    await openInspect(page, base);
    assert.equal(await page.locator('#vital-inspect-box').count(), 1);
    assert.match(await page.locator('#vital-inspect-title').innerText(), /Recorded element located/);
    const panel = await page.locator('#vital-inspect-ui').innerText();
    assert.match(panel, /does not re-test the accessibility violation/);
    assert.match(panel, /Historical remediation guidance/);
    assert.match(panel, /Add an accessible name/);
    assert.match(panel, /Runs locally in your browser/);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Close');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#vital-inspect-ui').count(), 0);
    assert.equal(await page.locator('#vital-inspect-box').count(), 0);
  });
});

test('multiple matches are candidates with previous/next inspection', async () => {
  await withFixture(async ({ browser, base }) => {
    const page = await browser.newPage();
    await openInspect(page, base, {
      selector: '.dupe',
      element: { tag: 'div', role: null, name: null, name_source: 'none' },
    });
    assert.match(await page.locator('#vital-inspect-title').innerText(), /Possible matching element/);
    assert.match(await page.locator('#vital-inspect-ui').innerText(), /Candidate 1 of 2/);
    assert.equal(await page.locator('#vital-inspect-box').count(), 1);
    await page.getByRole('button', { name: 'Next candidate' }).click();
    assert.match(await page.locator('#vital-inspect-ui').innerText(), /Candidate 2 of 2/);
    await page.getByRole('button', { name: 'Previous candidate' }).click();
    assert.match(await page.locator('#vital-inspect-ui').innerText(), /Candidate 1 of 2/);
  });
});

test('changed tag, role and name are reported and not highlighted as the occurrence', async () => {
  await withFixture(async ({ browser, base }) => {
    const page = await browser.newPage();
    await openInspect(page, base, { element: { tag: 'img', role: null, name: 'Save changes', name_source: 'aria-label' } });
    assert.match(await page.locator('#vital-inspect-title').innerText(), /Recorded element changed/);
    assert.match(await page.locator('#vital-inspect-ui').innerText(), /tag: recorded img, live button/);
    assert.equal(await page.locator('#vital-inspect-box').count(), 0);
    await page.getByRole('button', { name: 'Show changed element' }).click();
    assert.equal(await page.locator('#vital-inspect-box').count(), 1);
    assert.match(await page.locator('#vital-inspect-box').getAttribute('style'), /dashed/);

    await openInspect(page, base, { element: { role: 'switch' } });
    assert.match(await page.locator('#vital-inspect-ui').innerText(), /role: recorded switch, live none/);

    await openInspect(page, base, { selector: '#delete', element: { name: 'Save changes', name_source: 'aria-label' } });
    assert.match(await page.locator('#vital-inspect-ui').innerText(), /aria-label: recorded "Save changes", live "Delete"/);
  });
});

test('incomplete historical identity is a candidate, not a match', async () => {
  await withFixture(async ({ browser, base }) => {
    const page = await browser.newPage();
    await openInspect(page, base, { element: { tag: null, role: null, name: null, name_source: 'none' } });
    assert.match(await page.locator('#vital-inspect-title').innerText(), /Possible matching element/);
    assert.match(await page.locator('#vital-inspect-ui').innerText(), /Recorded tag or role was not available/);
    assert.equal(await page.locator('#vital-inspect-box').count(), 1);
  });
});

test('a missing element is not found and offers Find again', async () => {
  await withFixture(async ({ browser, base }) => {
    const page = await browser.newPage();
    await openInspect(page, base, { selector: '#not-here' });
    assert.match(await page.locator('#vital-inspect-title').innerText(), /Element not found/);
    assert.match(await page.locator('#vital-inspect-ui').innerText(), /Possible causes/);
    assert.equal(await page.locator('#vital-inspect-box').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Find again' }).count(), 1);
  });
});

test('a selector that points at another component is changed, not silently accepted', async () => {
  await withFixture(async ({ browser, base }) => {
    const page = await browser.newPage();
    await openInspect(page, base, {
      selector: '#role-target',
      element: { tag: 'button', role: 'switch', name: 'Save changes', name_source: 'aria-label' },
    });
    assert.match(await page.locator('#vital-inspect-title').innerText(), /Recorded element changed/);
    assert.match(await page.locator('#vital-inspect-ui').innerText(), /aria-label: recorded "Save changes", live "Toggle preference"/);
    assert.equal(await page.locator('#vital-inspect-box').count(), 0);
  });
});
