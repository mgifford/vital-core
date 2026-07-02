#!/usr/bin/env node
/**
 * Quick validator for the public-interest engine.
 *
 * Runs the four origin-level checks (accessibility statement, carbon.txt,
 * Green Web Foundation, sitemaps) against one or more domains and prints
 * the results immediately — no full scan or report build needed.
 *
 * Usage:
 *   node scripts/check-public-interest.js www.cms.gov
 *   node scripts/check-public-interest.js www.cms.gov www.medicare.gov
 *   node scripts/check-public-interest.js --json www.cms.gov   # raw JSON output
 *
 * Exit code: 0 always (this is a diagnostic tool, not a CI gate).
 */

import { runPublicInterest } from '../src/engines/public-interest.js';
import { loadConfig } from '../src/lib/config.js';

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const domains = args.filter((a) => !a.startsWith('--'));

if (!domains.length) {
  // Default to all configured targets when no domain is specified.
  const config = loadConfig();
  domains.push(...config.targets.map((t) => t.domain));
}

const UA = 'vital-scans/check-public-interest (+https://github.com/mgifford/vital-core)';

// ANSI colours — skip when stdout is not a TTY or JSON mode is on.
const colour = !jsonMode && process.stdout.isTTY;
const c = {
  pass:    colour ? '\x1b[32m' : '',
  fail:    colour ? '\x1b[31m' : '',
  unknown: colour ? '\x1b[33m' : '',
  dim:     colour ? '\x1b[2m'  : '',
  bold:    colour ? '\x1b[1m'  : '',
  reset:   colour ? '\x1b[0m'  : '',
};

function badge(result) {
  if (result === 'pass')    return `${c.pass}✓${c.reset}`;
  if (result === 'fail')    return `${c.fail}✗${c.reset}`;
  return `${c.unknown}~${c.reset}`;
}

function label(result) {
  if (result === 'pass')    return `${c.pass}pass${c.reset}`;
  if (result === 'fail')    return `${c.fail}not found${c.reset}`;
  return `${c.unknown}unknown${c.reset}`;
}

async function checkDomain(domain) {
  const origin = `https://${domain}`;
  process.stderr.write(`${c.dim}Checking ${domain}…${c.reset}\n`);
  const start = Date.now();
  const result = await runPublicInterest(origin, domain, UA);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (jsonMode) {
    process.stdout.write(JSON.stringify({ domain, elapsed_s: Number(elapsed), ...result }, null, 2) + '\n');
    return;
  }

  const { a11yStatement: a, carbonTxt: ct, greenWebFoundation: gwf, sitemaps: sm } = result;

  console.log(`\n${c.bold}${domain}${c.reset} ${c.dim}(${elapsed}s)${c.reset}`);

  // Accessibility statement
  const a11yConf = a.confidence ? ` ${c.dim}[${a.confidence} confidence]${c.reset}` : '';
  console.log(`  ${badge(a.result)} Accessibility statement  ${label(a.result)}${a11yConf}`);
  if (a.url) console.log(`     ${c.dim}${a.url}${c.reset}`);

  // carbon.txt
  const carbonNote = ct.result === 'pass'
    ? (ct.valid ? ' (valid)' : ' (found but may be malformed)')
    : '';
  const carbonFields = ct.fields && Object.keys(ct.fields).length
    ? `  ${c.dim}fields: ${Object.keys(ct.fields).slice(0, 4).join(', ')}${c.reset}` : '';
  console.log(`  ${badge(ct.result)} carbon.txt               ${label(ct.result)}${carbonNote}`);
  if (ct.url)   console.log(`     ${c.dim}${ct.url}${c.reset}`);
  if (carbonFields) console.log(`    ${carbonFields}`);

  // Green Web Foundation
  const gwfNote = gwf.hostedBy ? `  ${c.dim}hosted by: ${gwf.hostedBy}${c.reset}` : '';
  console.log(`  ${badge(gwf.result)} Green Web Foundation     ${gwf.result === 'pass' ? `${c.pass}green${c.reset}` : gwf.result === 'fail' ? `${c.fail}not green${c.reset}` : `${c.unknown}unknown${c.reset}`}${gwfNote}`);

  // Sitemaps
  const xmlBadge  = badge(sm.xml?.found  ? 'pass' : 'fail');
  const humBadge  = badge(sm.human?.found ? 'pass' : 'fail');
  console.log(`  ${xmlBadge} XML sitemap             ${sm.xml?.found  ? `${c.pass}found${c.reset}` : `${c.fail}not found${c.reset}`}`);
  if (sm.xml?.url)   console.log(`     ${c.dim}${sm.xml.url}${c.reset}`);
  console.log(`  ${humBadge} Human-readable sitemap  ${sm.human?.found ? `${c.pass}found${c.reset}` : `${c.fail}not found${c.reset}`}`);
  if (sm.human?.url) console.log(`     ${c.dim}${sm.human.url}${c.reset}`);
}

// Run checks sequentially to be polite to external APIs.
for (const domain of domains) {
  await checkDomain(domain).catch((err) => {
    console.error(`${c.fail}Error checking ${domain}:${c.reset}`, err.message);
  });
}
