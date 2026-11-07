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
  inspectCodeFor,
  inspectBookmarklet,
  decodeInspectToken,
  validateInspectPayload,
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
  assert.equal(payload.id, 'VO-abc12345');
  assert.equal(payload.u, undefined, 'the full URL is not transported');
  assert.equal(payload.org, 'https://example.gov');

  const withHash = inspectUrlFor(bug({ url: 'https://example.gov/page#section' }));
  assert.match(withHash, /#section&vital-inspect=/);
});

test('inspect URL is null when the live highlight cannot be honest', () => {
  assert.equal(inspectUrlFor(bug({ url: 'file:///tmp/page.html' })), null);
  assert.equal(inspectUrlFor(bug({ selector: '' })), null);
  assert.equal(inspectUrlFor(bug({ url: null })), null);
  assert.equal(inspectUrlFor({ ...bug(), element: null }), null, 'missing element evidence is not a highlightable target');
  assert.equal(inspectUnavailableReason({ ...bug(), element: null }), 'no-element-evidence');
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
    assert.match(panel, /Occurrence: VO-abc12345/);
    assert.match(panel, /Historical remediation guidance/);
    assert.match(panel, /Add an accessible name/);
    assert.match(panel, /Runs locally in your browser/);
    assert.equal(await page.evaluate(() => document.activeElement?.shadowRoot?.activeElement?.textContent), 'Close');
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

test('inspection codes are bounded, versioned and origin-scoped', () => {
  const token = inspectCodeFor(bug());
  const payload = decodeInspectToken(token);
  assert.equal(payload.org, 'https://example.gov');
  assert.equal(payload.u, undefined);
  assert.deepEqual(validateInspectPayload(payload, 'https://example.gov/page'), { ok: true });
  assert.equal(validateInspectPayload(payload, 'https://other.gov/page').ok, false);
  assert.match(validateInspectPayload({ ...payload, v: 2 }).reason, /version/);
  assert.match(validateInspectPayload({ ...payload, extra: true }).reason, /unexpected/);
  assert.match(validateInspectPayload({ ...payload, s: 'x'.repeat(501) }).reason, /selector/);
  assert.match(validateInspectPayload({ ...payload, org: 'https://example.gov/path' }).reason, /origin/);
  assert.match(validateInspectPayload({ ...payload, s: '<h3 id="x">' }).reason, /not CSS/);
  assert.match(validateInspectPayload({ ...payload, s: '{"type":"document"}' }).reason, /not CSS/);
  assert.match(validateInspectPayload({ ...payload, h: 'javascript:alert(1)' }).reason, /documentation/);
  assert.throws(() => decodeInspectToken('a'.repeat(8193)), /encoding/);
  assert.throws(() => decodeInspectToken('not-base64!'), /encoding/);
  assert.equal(inspectCodeFor(bug({ element: { shadow: true } })), null);
});

test('a real javascript: activation runs without CSP and is blocked by script-src', async () => {
  const bookmarklet = inspectBookmarklet();
  const html = (csp) => `<!doctype html><html><head>${csp ? `<meta http-equiv="Content-Security-Policy" content="${csp}">` : ''}</head><body><button id="named" aria-label="Save">Save</button><a id="run" href="${bookmarklet.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">run</a></body></html>`;
  const server = (csp) => {
    const body = html(csp);
    return http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(body); });
  };
  const browser = await chromium.launch();
  try {
    const open = async (csp) => {
      const s = server(csp);
      await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
      const port = s.address().port;
      const page = await browser.newPage();
      await page.goto(inspectUrlFor(bug({ url: `http://127.0.0.1:${port}/page` })), { waitUntil: 'load' });
      await page.click('#run').catch(() => {});
      await page.waitForTimeout(250);
      return { page, close: () => { s.close(); } };
    };

    const openPage = await open('');
    assert.equal(await openPage.page.locator('#vital-inspect-ui').count(), 1, 'javascript: activation works without CSP');
    openPage.close();

    const cspPage = await open("default-src 'self'; script-src 'self'; style-src 'self'");
    assert.equal(await cspPage.page.locator('#vital-inspect-ui').count(), 0, 'script-src without unsafe-inline blocks the javascript: activation in Chromium');
    cspPage.close();

    const nonePage = await open("default-src 'none'; script-src 'none'");
    assert.equal(await nonePage.page.locator('#vital-inspect-ui').count(), 0, 'script-src none blocks the javascript: activation');
    nonePage.close();

    const stylePage = await open("script-src 'unsafe-inline'; style-src 'none'");
    assert.equal(await stylePage.page.locator('#vital-inspect-ui').count(), 1);
    assert.equal(await stylePage.page.locator('#vital-inspect-ui').evaluate((el) => getComputedStyle(el).position), 'fixed');
    stylePage.close();
  } finally {
    await browser.close();
  }
});

test('a pasted inspection code is accepted when the fragment is unavailable', async () => {
  await withFixture(async ({ browser, base }) => {
    const page = await browser.newPage();
    const token = inspectCodeFor(bug({ url: `${base}/page` }));
    await page.goto(`${base}/page`, { waitUntil: 'load' });
    page.once('dialog', (dialog) => dialog.accept(token));
    await page.evaluate(inspectBookmarklet().replace(/^javascript:/, ''));
    assert.equal(await page.locator('#vital-inspect-ui').count(), 1);
    assert.match(await page.locator('#vital-inspect-title').innerText(), /Recorded element located/);
  });
});

test('an invalid code is rejected before any highlighting', async () => {
  await withFixture(async ({ browser, base }) => {
    const page = await browser.newPage();
    await page.goto(`${base}/page#vital-inspect=not-a-payload`, { waitUntil: 'load' });
    const messages = [];
    page.on('dialog', async (dialog) => { messages.push(dialog.message()); await dialog.dismiss(); });
    await page.evaluate(inspectBookmarklet().replace(/^javascript:/, ''));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#vital-inspect-ui').count(), 0);
    assert.match(messages.join(' '), /damaged or unsupported/);
  });
});

test('repeated activation replaces the overlay and leaves no duplicate UI', async () => {
  await withFixture(async ({ browser, base }) => {
    const page = await browser.newPage();
    await openInspect(page, base);
    assert.equal(await page.locator('#vital-inspect-ui').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#vital-inspect-ui').count(), 0);
    await page.evaluate(vitalInspect);
    assert.equal(await page.locator('#vital-inspect-ui').count(), 1);
    await page.evaluate(vitalInspect);
    assert.equal(await page.locator('#vital-inspect-ui').count(), 1, 'a second activation replaces, not duplicates');
    assert.equal(await page.locator('#vital-inspect-box').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#vital-inspect-box').count(), 0);
  });
});

async function withPage(html, fn, contextOptions = {}) {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    await fn({ page, base: `http://127.0.0.1:${server.address().port}` });
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
}

test('removal and replacement suspend the highlight and require Find again', async () => {
  await withFixture(async ({ browser, base }) => {
    const page = await browser.newPage();
    await openInspect(page, base);
    assert.equal(await page.locator('#vital-inspect-box').count(), 1);
    await page.evaluate(() => document.getElementById('named').remove());
    await page.waitForFunction(() => /removed or replaced/.test(document.querySelector('#vital-inspect-host').shadowRoot.querySelector('#vital-inspect-status').textContent));
    assert.equal(await page.locator('#vital-inspect-box').count(), 0);
    assert.match(await page.locator('#vital-inspect-title').innerText(), /Live element changed/);
  });
});

test('a hidden element suspends and then restores the highlight', async () => {
  await withFixture(async ({ browser, base }) => {
    const page = await browser.newPage();
    await openInspect(page, base);
    await page.evaluate(() => { document.getElementById('named').style.display = 'none'; });
    await page.waitForFunction(() => /hidden/.test(document.querySelector('#vital-inspect-host').shadowRoot.querySelector('#vital-inspect-status').textContent));
    assert.equal(await page.locator('#vital-inspect-box').count(), 0);
    await page.evaluate(() => { document.getElementById('named').style.display = ''; });
    await page.waitForFunction(() => /does not re-test/.test(document.querySelector('#vital-inspect-host').shadowRoot.querySelector('#vital-inspect-status').textContent));
    assert.equal(await page.locator('#vital-inspect-box').count(), 1);
  });
});

test('an identity attribute change while open is reported, not silently accepted', async () => {
  await withFixture(async ({ browser, base }) => {
    const page = await browser.newPage();
    await openInspect(page, base);
    await page.evaluate(() => document.getElementById('named').setAttribute('aria-label', 'Changed while open'));
    await page.waitForFunction(() => /identity changed/.test(document.querySelector('#vital-inspect-host').shadowRoot.querySelector('#vital-inspect-status').textContent));
    assert.match(await page.locator('#vital-inspect-ui').innerText(), /aria-label: recorded "Save changes", live "Changed while open"/);
    assert.equal(await page.locator('#vital-inspect-box').count(), 0);
  });
});

test('the panel is isolated from aggressive page CSS and can collapse/move', async () => {
  const html = '<!doctype html><html><body><button id="named" aria-label="Save">Save</button><style>button { display: none !important; } div { border: 12px solid red !important; }</style></body></html>';
  await withPage(html, async ({ page, base }) => {
    await page.goto(inspectUrlFor(bug({ url: `${base}/page` })));
    await page.evaluate(vitalInspect);
    assert.equal(await page.locator('#vital-inspect-close').isVisible(), true, 'shadow UI is not hidden by page button rules');
    await page.getByRole('button', { name: 'Collapse' }).click();
    assert.equal(await page.locator('#vital-inspect-details').isHidden(), true);
    await page.getByRole('button', { name: 'Expand' }).click();
    const before = await page.locator('#vital-inspect-ui').getAttribute('data-corner');
    await page.getByRole('button', { name: 'Move panel' }).click();
    assert.notEqual(await page.locator('#vital-inspect-ui').getAttribute('data-corner'), before);
  });
});

test('the panel fits a 320px viewport and exposes keyboard controls', async () => {
  await withPage(fs.readFileSync(FIXTURE, 'utf8'), async ({ page, base }) => {
    await page.setViewportSize({ width: 320, height: 600 });
    await page.goto(inspectUrlFor(bug({ url: `${base}/page` })));
    await page.evaluate(vitalInspect);
    const box = await page.locator('#vital-inspect-ui').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 320, `panel fits: ${JSON.stringify(box)}`);
    await page.getByRole('button', { name: 'Move panel' }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#vital-inspect-close').isVisible(), true);
    await page.getByRole('button', { name: 'Close' }).click();
    assert.equal(await page.locator('#vital-inspect-host').count(), 0);
  });
});

test('forced-colors mode keeps the overlay visible', async () => {
  await withPage(fs.readFileSync(FIXTURE, 'utf8'), async ({ page, base }) => {
    await page.goto(inspectUrlFor(bug({ url: `${base}/page` })));
    await page.evaluate(vitalInspect);
    assert.equal(await page.locator('#vital-inspect-ui').isVisible(), true);
    const border = await page.locator('#vital-inspect-box').evaluate((el) => getComputedStyle(el).borderTopStyle);
    assert.ok(border && border !== 'none', 'highlight has a visible border in forced colors');
  }, { forcedColors: 'active' });
});

test('axe-core finds no violations inside the overlay', async () => {
  await withPage(fs.readFileSync(FIXTURE, 'utf8'), async ({ page, base }) => {
    await page.goto(inspectUrlFor(bug({ url: `${base}/page` })));
    await page.evaluate(vitalInspect);
    const axeSource = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
    await page.evaluate(axeSource);
    const results = await page.evaluate(async () => window.axe.run(document));
    const overlay = results.violations.filter((violation) => violation.nodes.some((node) => JSON.stringify(node.target).includes('vital-inspect')));
    assert.deepEqual(overlay, []);
  });
});

test('an XPath payload locates the element for the local inspector', async () => {
  await withFixture(async ({ browser, base }) => {
    const page = await browser.newPage();
    const url = inspectUrlFor(bug({ url: `${base}/page`, selector: null, xpath: '//*[@id="named"]' }));
    assert.ok(url);
    await page.goto(url);
    await page.evaluate(vitalInspect);
    assert.match(await page.locator('#vital-inspect-title').innerText(), /Recorded element located/);
    assert.equal(await page.locator('#vital-inspect-box').count(), 1);
  });
});
