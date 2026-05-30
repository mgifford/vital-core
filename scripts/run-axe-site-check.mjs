import { AxeBuilder } from '@axe-core/playwright';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const siteDir = process.env.A11Y_SITE_DIR || 'docs';
const siteBaseUrl = process.env.A11Y_BASE_URL || 'http://127.0.0.1:4173';
const rootDir = path.resolve(siteDir);

async function collectHtmlFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectHtmlFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }

  return files;
}

function toPageUrl(filePath) {
  const rel = path.relative(rootDir, filePath).split(path.sep).join('/');
  return new URL(rel, `${siteBaseUrl}/`).toString();
}

function formatViolation(violation) {
  const nodes = (violation.nodes || []).slice(0, 3).map((node) => node.target.join(' ')).join(' | ');
  return `- [${violation.id}] ${violation.help} (${violation.impact || 'unknown'})\n  ${violation.helpUrl}\n  Targets: ${nodes}`;
}

async function run() {
  const htmlFiles = await collectHtmlFiles(rootDir);

  if (!htmlFiles.length) {
    throw new Error(`No HTML files found in ${rootDir}`);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = [];

  try {
    for (const filePath of htmlFiles) {
      const url = toPageUrl(filePath);
      process.stdout.write(`Checking ${url}\n`);
      await page.goto(url, { waitUntil: 'networkidle' });

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
        .analyze();

      if (results.violations.length) {
        failures.push({
          url,
          violations: results.violations
        });
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  if (!failures.length) {
    process.stdout.write(`Axe checks passed for ${htmlFiles.length} page(s).\n`);
    return;
  }

  const details = failures
    .map((failure) => {
      const violations = failure.violations.map(formatViolation).join('\n');
      return [`Page: ${failure.url}`, violations].join('\n');
    })
    .join('\n\n');

  throw new Error(`Axe found accessibility violations on ${failures.length} page(s).\n\n${details}`);
}

run().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
