/**
 * Technology detection engine using the HTTPArchive/wappalyzer fork.
 *
 * Vendor source: https://github.com/HTTPArchive/wappalyzer (GPL-3.0)
 * Vendored to vendor/wappalyzer/ — update by re-running scripts/update-wappalyzer.sh.
 *
 * The fork is a browser extension, not an npm package, so we load the core
 * detection module via Function() (required because it uses top-level `const`
 * which CJS require() can't capture). We collect the inputs Playwright-side
 * (HTML, response headers, script srcs, JS globals, cookies, meta tags) and
 * pass them to Wappalyzer.analyze() synchronously.
 *
 * Result shape: [{ name, category, categories, confidence, version, evidence }]
 * Sorted by category then name. Confidence is 0–100 (Wappalyzer's scale).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const VENDOR_DIR = path.resolve(new URL('../../vendor/wappalyzer', import.meta.url).pathname);

// Load and initialise Wappalyzer once at module load time.
const Wappalyzer = (() => {
  const code = fs.readFileSync(path.join(VENDOR_DIR, 'wappalyzer.js'), 'utf8');
  const fn = new Function('module', 'exports', 'require', code);
  const m = { exports: {} };
  fn(m, m.exports, require);
  const W = m.exports;

  const categories = JSON.parse(fs.readFileSync(path.join(VENDOR_DIR, 'categories.json'), 'utf8'));
  let allTech = {};
  for (const f of fs.readdirSync(path.join(VENDOR_DIR, 'technologies'))) {
    if (f.endsWith('.json')) {
      Object.assign(allTech, JSON.parse(fs.readFileSync(path.join(VENDOR_DIR, 'technologies', f), 'utf8')));
    }
  }
  W.setCategories(categories);
  W.setTechnologies(allTech);
  return W;
})();

/**
 * Run Wappalyzer detection on the current Playwright page.
 *
 * pageHeaders: plain object of HTTP response headers (any case keys) from
 *   the Playwright response, passed separately since headers aren't
 *   accessible from page.evaluate().
 *
 * Returns an array of detections:
 *   [{ name, category, confidence, version, evidence }]
 * sorted by category then name. confidence is 0–100.
 */
export async function runTech(page, pageHeaders = {}) {
  // Collect all detection inputs from the live page DOM + network.
  const pageData = await page.evaluate(() => {
    // Script srcs (for scriptSrc pattern matching).
    const scriptSrc = Array.from(document.querySelectorAll('script[src]'))
      .map((el) => el.src).filter(Boolean);

    // Inline script content joined (for scripts pattern matching).
    const scripts = Array.from(document.querySelectorAll('script:not([src])'))
      .map((el) => el.textContent || '').join('\n').slice(0, 100000);

    // Meta tags: { name/property -> [value] } (Wappalyzer expects arrays).
    const meta = {};
    for (const el of document.querySelectorAll('meta[name], meta[property]')) {
      const key = (el.getAttribute('name') || el.getAttribute('property') || '').toLowerCase();
      const val = el.getAttribute('content') || '';
      if (key) (meta[key] ??= []).push(val);
    }

    // Cookies: { name -> value }.
    const cookies = {};
    for (const part of document.cookie.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k) cookies[k.trim()] = rest.join('=').trim();
    }

    // JS globals — Wappalyzer's `js` patterns test window[property].
    // Collect all enumerable top-level keys (limited to reasonable length).
    const js = {};
    for (const key of Object.keys(window)) {
      if (key.length < 60) {
        try {
          const val = window[key];
          if (val !== null && val !== undefined) {
            js[key] = typeof val === 'object' ? '' : String(val).slice(0, 200);
          }
        } catch { /* some globals throw on access */ }
      }
    }

    return {
      url: window.location.href,
      html: document.documentElement.outerHTML.slice(0, 500000),
      scriptSrc,
      scripts,
      meta,
      cookies,
      js,
    };
  });

  // Headers: Wappalyzer expects an array of [name, value] pairs (lowercased).
  const headers = Object.entries(pageHeaders).map(([k, v]) => [k.toLowerCase(), v]);

  const detections = Wappalyzer.analyze({
    url: pageData.url,
    html: pageData.html,
    scriptSrc: pageData.scriptSrc,
    scripts: pageData.scripts,
    meta: pageData.meta,
    cookies: pageData.cookies,
    js: pageData.js,
    headers,
  });

  const resolved = Wappalyzer.resolve(detections);

  // resolve() returns full category objects: [{ id, name, slug, ... }]
  return resolved
    .map((d) => ({
      name: d.name,
      // Use the first category (highest priority) as the primary grouping key.
      category: d.categories.length ? d.categories[0].name : 'Other',
      categories: d.categories.map((c) => c.name),
      confidence: d.confidence,
      version: d.version || null,
      website: d.website || null,
      cpe: d.cpe || null,
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}
