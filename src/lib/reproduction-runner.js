import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { executeReproduction } from './reproduction.js';

const require = createRequire(import.meta.url);
const AXE_SOURCE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

/**
 * Run one reproduction plan in a fresh Chromium. Used by the CLI and the tests
 * only — never by a scheduled scan. Returns the same shape the generated script
 * prints, so the two paths cannot disagree.
 */
export async function runReproduction(plan, { launcher = chromium } = {}) {
  if (!plan || plan.status === 'unavailable') {
    return { status: 'unavailable', reason: plan?.reason ?? 'no-plan' };
  }
  const browser = await launcher.launch();
  try {
    const context = await browser.newContext(plan.context ?? {});
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(30000);
    try {
      await page.goto(plan.url, { waitUntil: 'load' });
    } catch (error) {
      return { status: 'page_unavailable', detail: String(error?.message ?? error) };
    }
    return await executeReproduction(page, AXE_SOURCE, plan);
  } finally {
    await browser.close();
  }
}
