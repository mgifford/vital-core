import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { inspectUrlFor, inspectBookmarklet, vitalInspect } from '../../src/lib/live-inspect.js';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const PAGE = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'live-inspect.html'), 'utf8');
const bug = (url) => ({
  url,
  selector: '#named',
  rule_id: 'button-name',
  rule_label: 'Buttons must have discernible text',
  wcag_sc: '4.1.2',
  remediation_tip: 'Add an accessible name.',
  occurrence_id: 'VO-abc12345',
  observation_id: 'VOB-abc12345',
  finding_ref: 'VFR-abc12345',
  element: { available: true, tag: 'button', role: null, name: 'Save changes', name_source: 'aria-label' },
});

function pageWithBookmarklet(csp) {
  const bookmarklet = inspectBookmarklet().replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return PAGE
    .replace('<head>', `<head>${csp ? `<meta http-equiv="Content-Security-Policy" content="${csp}">` : ''}`)
    .replace('<body>', `<body><a id="run" href="${bookmarklet}">run</a>`);
}

async function withServer(html, fn) {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}/page`);
  } finally {
    server.close();
  }
}

const browserLaunchers = [['Chromium', chromium]];
try {
  if (fs.existsSync(webkit.executablePath())) browserLaunchers.push(['WebKit', webkit]);
} catch { /* WebKit is optional outside the full test job */ }

for (const [name, launcher] of browserLaunchers) {
  test(`${name}: a javascript: activation runs without CSP and is blocked by script-src`, async (t) => {
    let browser;
    try {
      browser = await launcher.launch();
    } catch (error) {
      t.skip(`${name} cannot launch in this environment: ${error.message}`);
      return;
    }
    try {
      await withServer(pageWithBookmarklet(''), async (base) => {
        const page = await browser.newPage();
        await page.goto(inspectUrlFor(bug(base)), { waitUntil: 'load' });
        await page.click('#run').catch(() => {});
        await page.waitForTimeout(300);
        assert.equal(await page.locator('#vital-inspect-ui').count(), 1, 'javascript: activation works');
        await page.keyboard.press('Escape');
      });
      await withServer(pageWithBookmarklet("default-src 'self'; script-src 'self'; style-src 'self'"), async (base) => {
        const page = await browser.newPage();
        await page.goto(inspectUrlFor(bug(base)), { waitUntil: 'load' });
        await page.click('#run').catch(() => {});
        await page.waitForTimeout(300);
        assert.equal(await page.locator('#vital-inspect-ui').count(), 0, 'script-src blocks javascript: activation');
      });
    } finally {
      await browser.close();
    }
  });
}

test('an access-denied page is reported as blocked, not as a missing element', async () => {
  const blocked = '<!doctype html><html><head><title>Access Denied</title></head><body><h1>Access Denied</h1><p>You don\'t have permission to access this server. Reference #18.abc</p><a id="run" href="' + inspectBookmarklet().replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '">run</a></body></html>';
  const browser = await chromium.launch();
  try {
    await withServer(blocked, async (base) => {
      const page = await browser.newPage();
      await page.goto(inspectUrlFor(bug(base)), { waitUntil: 'load' });
      await page.click('#run').catch(() => {});
      await page.waitForTimeout(300);
      const panel = await page.locator('#vital-inspect-ui').innerText();
      assert.match(panel, /Page access blocked/);
      assert.doesNotMatch(panel, /^Element not found/m);
      assert.match(panel, /access-denied|bot-block|permission/i);
    });
  } finally {
    await browser.close();
  }
});
