// Real-browser verification for the WebMCP bridge (spec.md Scenario 1),
// per plan.md WP03 T004. Not wired into `npm run test:unit` — it needs a
// real Chromium binary, which the unit suite's Node-only tests don't
// require. Run manually: node scripts/webmcp-bridge-e2e-check.mjs
// (set PLAYWRIGHT_CHROMIUM_PATH if your environment's pre-installed
// Chromium revision doesn't match this repo's pinned Playwright version —
// e.g. a sandbox with browsers baked in at a different path than what
// `playwright install` would normally fetch).
//
// Loads a minimal HTML page containing the real generated bridge script,
// with a stub document.modelContext installed before the script runs (the
// WebMCP proposal has no browser implementation yet to test against for
// real, so this is the standard "test the integration point" pattern) and
// a route intercept standing in for the /api/v1/ static files. Asserts
// tool registration and a full tool-call round trip through the actual
// browser JS engine, not a Node vm sandbox.
import { chromium } from 'playwright';
import { webmcpBridgeScript } from '../src/report-html.js';

const TARGET = { domain: 'example.gov', key: 'example.gov', webmcpEnabled: true };
const FIXTURE_SNAPSHOT = { latest_week: '2026-W25' };
const FIXTURE_FINDINGS = {
  findings: [
    { finding_id: 'VS-aaaa', rule_id: 'color-contrast', severity: 'Serious', pages_affected: 40, rule_label: 'Contrast' },
    { finding_id: 'VS-bbbb', rule_id: 'image-alt', severity: 'Critical', pages_affected: 5, rule_label: 'Alt text' },
  ],
};

async function main() {
  const browser = await chromium.launch({
    args: ['--disable-dev-shm-usage'],
    // Standard auto-discovery works on any machine with `playwright install`
    // run normally. Override only for environments (like sandboxes) whose
    // pre-installed Chromium revision doesn't match this repo's pinned
    // Playwright version.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
  });
  try {
    const page = await browser.newPage();

    await page.route('**/api/v1/**', (route) => {
      const url = route.request().url();
      const body = url.includes('snapshot.json') ? FIXTURE_SNAPSHOT : FIXTURE_FINDINGS;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    // Stub document.modelContext before any page script runs, capturing
    // registrations on window so the test can inspect/call them after load.
    await page.addInitScript(() => {
      window.__registeredTools = {};
      document.modelContext = {
        registerTool(def) {
          window.__registeredTools[def.name] = def;
          return Promise.resolve();
        },
      };
    });

    const bridgeScriptHtml = webmcpBridgeScript(TARGET);
    const fullHtml = `<!doctype html><html><head><base href="https://example.gov/"></head><body>${bridgeScriptHtml}</body></html>`;
    // page.setContent() does not reliably trigger addInitScript for the
    // resulting document (confirmed empirically in this sandbox); a real
    // navigation does. A <base> tag gives the relative /api/v1/ fetches
    // inside the bridge script a real origin to resolve against so
    // page.route() can intercept them.
    await page.goto('data:text/html,' + encodeURIComponent(fullHtml));

    const toolNames = await page.evaluate(() => Object.keys(window.__registeredTools).sort());
    const expected = ['vital_get_finding_context', 'vital_get_project_context', 'vital_list_findings'];
    assertDeepEqual(toolNames, expected, 'registered tool names');

    const listResult = await page.evaluate(async () => {
      const result = await window.__registeredTools.vital_list_findings.execute({ severity: ['Critical'] });
      return JSON.parse(result.content[0].text);
    });
    assertDeepEqual(
      listResult.findings.map((f) => f.finding_id),
      ['VS-bbbb'],
      'vital_list_findings severity filter',
    );

    console.log('PASS: WebMCP bridge verified in a real headless Chromium page.');
    console.log('  Registered tools:', toolNames.join(', '));
    console.log('  vital_list_findings({severity:["Critical"]}) ->', JSON.stringify(listResult));
  } finally {
    await browser.close();
  }
}

function assertDeepEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`FAIL (${label}): expected ${e}, got ${a}`);
  }
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exitCode = 1;
});
