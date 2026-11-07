import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  INSPECT_HASH,
  inspectUrlFor,
  inspectBookmarklet,
  vitalInspect,
} from '../../src/lib/live-inspect.js';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);

const bug = (over = {}) => ({
  url: 'https://example.gov/page?x=1',
  selector: '.qc-cmp2-toggle',
  rule_id: 'button-name',
  rule_label: 'Buttons must have discernible text',
  wcag_sc: '4.1.2',
  remediation_tip: 'Add an accessible name.',
  occurrence_id: 'VO-abc12345',
  element: { tag: 'button', role: 'switch', name: null, name_source: 'none' },
  ...over,
});

test('inspect URL carries a compact payload for the live page', () => {
  const url = inspectUrlFor(bug());
  assert.ok(url.startsWith('https://example.gov/page?x=1#vital-inspect='));
  const token = url.split(`${INSPECT_HASH}=`)[1];
  const payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  assert.equal(payload.s, '.qc-cmp2-toggle');
  assert.equal(payload.t, 'button');
  assert.equal(payload.r, 'switch');
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
});

test('the bookmarklet is a self-contained javascript URL', () => {
  const code = inspectBookmarklet();
  assert.ok(code.startsWith('javascript:('));
  assert.match(code, /vital-inspect=/);
  assert.match(code, /Not found on this page/);
  assert.doesNotMatch(code, /https:\/\/cdn|fetch\(/);
});

test('highlighter outlines the recorded element, shows the fix and closes with Escape', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'walsall-consent.html'));
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const url = inspectUrlFor(bug({ url: `http://127.0.0.1:${port}/consent` }));
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(vitalInspect);
    assert.equal(await page.locator('#vital-inspect-ui').count(), 1);
    assert.equal(await page.locator('#vital-inspect-box').count(), 1);
    assert.match(await page.locator('#vital-inspect-title').innerText(), /Buttons must have discernible text/);
    const panel = await page.locator('#vital-inspect-ui').innerText();
    assert.match(panel, /Found on the live page/);
    assert.match(panel, /How to fix/);
    assert.match(panel, /Add an accessible name/);
    assert.match(panel, /sends nothing/);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Close');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#vital-inspect-ui').count(), 0);
    assert.equal(await page.locator('#vital-inspect-box').count(), 0);
  } finally {
    await browser.close();
    server.close();
  }
});

test('highlighter reports a moved element instead of drawing a wrong box', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'walsall-consent.html'));
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(inspectUrlFor(bug({ url: `http://127.0.0.1:${port}/consent`, selector: '#not-here' })), { waitUntil: 'load' });
    await page.evaluate(vitalInspect);
    assert.equal(await page.locator('#vital-inspect-box').count(), 0);
    assert.match(await page.locator('#vital-inspect-ui').innerText(), /Not found on this page/);

    await page.goto(inspectUrlFor(bug({ url: `http://127.0.0.1:${port}/consent`, element: { tag: 'div', role: 'switch', name: null, name_source: 'none' } })), { waitUntil: 'load' });
    await page.evaluate(vitalInspect);
    assert.match(await page.locator('#vital-inspect-ui').innerText(), /differs from the recorded evidence/);
    assert.equal(await page.locator('#vital-inspect-box').count(), 1);
  } finally {
    await browser.close();
    server.close();
  }
});
