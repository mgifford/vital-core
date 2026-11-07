#!/usr/bin/env node
/**
 * Open a finding (or an ad-hoc selector/XPath) in a headed browser, with the
 * same VITAL Inspect highlighter used by the bookmarklet.
 *
 *   npm run inspect -- --bugs <bugs.json|URL> --id <VS-id|pattern-id>
 *   npm run inspect -- --url https://example.gov/page --selector '#main h2'
 *   npm run inspect -- --url https://example.gov/page --xpath '//main//h2'
 *   npm run inspect -- --bugs ... --id ... --dry-run
 *
 * No extension and no bookmark are needed. The browser stays open until you
 * close it. `--headless` exists for automation and is not useful visually.
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { inspectBookmarklet, inspectUnavailableReason, inspectUnavailableText, inspectUrlFor } from '../src/lib/live-inspect.js';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const token = process.argv[i];
  if (!token.startsWith('--')) continue;
  const key = token.slice(2);
  const next = process.argv[i + 1];
  args[key] = next && !next.startsWith('--') ? (i++, next) : true;
}

function usage(message) {
  if (message) console.error(message);
  console.error('Usage: npm run inspect -- (--bugs <file|URL> --id <VS-id|pattern-id> | --url <http(s) URL> (--selector <css> | --xpath <xpath>)) [--dry-run] [--headless] [--timeout <ms>]');
  process.exit(2);
}

async function loadBug() {
  if (!args.bugs || !args.id) return null;
  const raw = /^https?:\/\//i.test(args.bugs)
    ? await (await fetch(args.bugs)).text()
    : fs.readFileSync(args.bugs, 'utf8');
  const doc = JSON.parse(raw);
  const reports = Array.isArray(doc) ? doc : doc.reports ?? doc.findings ?? [];
  return reports.find((report) => report.instance_id === args.id || report.pattern_id === args.id) ?? null;
}

async function main() {
  let bug;
  if (args.bugs || args.id) {
    if (!args.bugs || !args.id) usage('Both --bugs and --id are required.');
    bug = await loadBug();
    if (!bug) usage(`No finding ${args.id} in ${args.bugs}`);
  } else if (args.url) {
    if (!args.selector && !args.xpath) usage('Provide --selector or --xpath with --url.');
    bug = {
      url: String(args.url),
      selector: args.selector ? String(args.selector) : null,
      xpath: args.xpath ? String(args.xpath) : null,
      element: { available: true },
    };
  } else {
    usage();
  }

  const reason = inspectUnavailableReason(bug);
  const target = reason ? null : inspectUrlFor(bug);
  if (!target) {
    console.error(`Cannot inspect this finding: ${inspectUnavailableText(reason ?? 'no-selector')}`);
    process.exit(2);
  }
  if (args['dry-run']) {
    console.log(JSON.stringify({
      status: 'ready',
      url: target,
      selector: bug.selector ?? null,
      xpath: bug.xpath ?? null,
      element: bug.element ?? null,
    }, null, 2));
    return;
  }

  const timeout = Number(args.timeout) > 0 ? Number(args.timeout) : 30000;
  const browser = await chromium.launch({ headless: args.headless === true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);
    await page.goto(target, { waitUntil: 'load' });
    await page.evaluate(inspectBookmarklet().replace(/^javascript:/, ''));
    console.log('VITAL Inspect opened. Change the page state if needed, use Find again, then close the browser window to exit.');
    await new Promise((resolve) => browser.on('disconnected', resolve));
  } finally {
    if (browser.isConnected()) await browser.close();
  }
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
