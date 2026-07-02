/**
 * Public-interest and sustainability signal checks — run once per origin
 * per week (like security.js). Checks are cheap HEAD/GET fetches; none
 * require a browser page.
 *
 * Checks:
 *   1. Accessibility statement — heuristic search across well-known paths
 *      and common link-text patterns found on the homepage.
 *   2. carbon.txt — machine-readable sustainability file (carbontxt.org).
 *   3. Green Web Foundation — renewable-hosting registry lookup.
 *   4. XML + human-readable sitemaps — discoverability for machines/people.
 *
 * Each check returns { id, label, result, detail, url, checkedAt }
 * where result is 'pass' | 'fail' | 'unknown'.
 */

const TIMEOUT_MS = 12000;

// ---------------------------------------------------------------------------
// Shared fetch helper (same pattern as security.js)
// ---------------------------------------------------------------------------

async function safeFetch(url, userAgent, { method = 'GET', timeoutMs = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': userAgent },
    });
    const text = method === 'GET' && res.ok ? await res.text().catch(() => '') : '';
    return { ok: res.ok, status: res.status, text };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 1. Accessibility statement
// ---------------------------------------------------------------------------

// Well-known paths to try before falling back to homepage link-scan.
const A11Y_PATHS = [
  '/accessibility',
  '/accessibility-statement',
  '/accessibility/',
  '/accessibility-statement/',
  '/about/accessibility',
  '/about/accessibility-statement',
  '/web-accessibility',
  '/digital-accessibility',
];

// Link-text patterns that strongly suggest an accessibility statement link.
const A11Y_LINK_RE = /\baccessib(?:ility|le)\s*(statement|policy|declaration|notice|commitment)?\b/i;

async function checkA11yStatement(origin, userAgent) {
  const checkedAt = new Date().toISOString();

  // Try well-known paths first (HEAD is enough to detect existence).
  for (const p of A11Y_PATHS) {
    const url = `${origin}${p}`;
    const res = await safeFetch(url, userAgent, { method: 'HEAD' });
    if (res?.ok) {
      return { result: 'pass', url, confidence: 'high', checkedAt };
    }
  }

  // Fall back: fetch homepage HTML and look for accessibility-statement links.
  const home = await safeFetch(origin + '/', userAgent);
  if (home?.text) {
    // Extract href values from <a> tags whose text or href matches the pattern.
    const linkRe = /<a\s[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    let m;
    while ((m = linkRe.exec(home.text)) !== null) {
      const [, href, text] = m;
      if (A11Y_LINK_RE.test(text) || A11Y_LINK_RE.test(href)) {
        const resolved = href.startsWith('http') ? href : `${origin}${href.startsWith('/') ? '' : '/'}${href}`;
        return { result: 'pass', url: resolved, confidence: 'medium', checkedAt };
      }
    }
  }

  return { result: 'fail', url: null, confidence: null, checkedAt };
}

// ---------------------------------------------------------------------------
// 2. carbon.txt
// ---------------------------------------------------------------------------

async function checkCarbonTxt(origin, userAgent) {
  const checkedAt = new Date().toISOString();
  const candidates = [
    `${origin}/carbon.txt`,
    // Also try www. variant when origin is apex, or apex when origin is www.
    origin.includes('://www.')
      ? `${origin.replace('://www.', '://')}/carbon.txt`
      : `${origin.replace('://', '://www.')}/carbon.txt`,
  ];

  for (const url of candidates) {
    const res = await safeFetch(url, userAgent);
    if (!res?.ok) continue;

    // Basic validity: carbon.txt should contain at least one known section header.
    const text = res.text ?? '';
    const valid = /^\s*\[/m.test(text) || /^(upstream|org|services)\s*=/im.test(text);
    // Extract a few key fields for the report.
    const fields = {};
    for (const [, k, v] of text.matchAll(/^([a-z_]+)\s*=\s*(.+)$/gim)) {
      fields[k.toLowerCase().trim()] = v.trim();
    }

    return { result: 'pass', url, valid, fields, checkedAt };
  }

  return { result: 'fail', url: null, valid: false, fields: {}, checkedAt };
}

// ---------------------------------------------------------------------------
// 3. Green Web Foundation
// ---------------------------------------------------------------------------

// Public API — no key required for lightweight checks.
const GWF_API = 'https://api.thegreenwebfoundation.org/greencheck';

async function checkGreenWebFoundation(domain, userAgent) {
  const checkedAt = new Date().toISOString();
  // Strip www. for the lookup — GWF indexes by registrable domain.
  const bare = domain.replace(/^www\./, '');
  const url = `${GWF_API}/${encodeURIComponent(bare)}`;
  const res = await safeFetch(url, userAgent);
  if (!res?.ok || !res.text) {
    return { result: 'unknown', green: null, hostedBy: null, url, checkedAt };
  }
  let data;
  try { data = JSON.parse(res.text); } catch { return { result: 'unknown', green: null, hostedBy: null, url, checkedAt }; }

  const green = data.green === true;
  const hostedBy = data.hosted_by ?? data.hostedby ?? null;
  return {
    result: green ? 'pass' : 'fail',
    green,
    hostedBy,
    url,
    checkedAt,
  };
}

// ---------------------------------------------------------------------------
// 4. Sitemaps
// ---------------------------------------------------------------------------

const XML_SITEMAP_PATHS = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap/sitemap.xml'];
const HUMAN_SITEMAP_PATHS = ['/sitemap', '/site-map', '/sitemap.html', '/sitemap/', '/site-map/'];

async function checkSitemaps(origin, userAgent) {
  const checkedAt = new Date().toISOString();

  // XML sitemap.
  let xmlFound = false;
  let xmlUrl = null;
  for (const p of XML_SITEMAP_PATHS) {
    const url = `${origin}${p}`;
    const res = await safeFetch(url, userAgent, { method: 'HEAD' });
    if (res?.ok) { xmlFound = true; xmlUrl = url; break; }
  }

  // Human-readable sitemap.
  let humanFound = false;
  let humanUrl = null;
  for (const p of HUMAN_SITEMAP_PATHS) {
    const url = `${origin}${p}`;
    const res = await safeFetch(url, userAgent, { method: 'HEAD' });
    if (res?.ok) { humanFound = true; humanUrl = url; break; }
  }

  return {
    xml: { found: xmlFound, url: xmlUrl },
    human: { found: humanFound, url: humanUrl },
    checkedAt,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function runPublicInterest(origin, domain, userAgent) {
  const [a11y, carbon, gwf, sitemaps] = await Promise.all([
    checkA11yStatement(origin, userAgent).catch(() => ({ result: 'unknown', url: null, confidence: null, checkedAt: new Date().toISOString() })),
    checkCarbonTxt(origin, userAgent).catch(() => ({ result: 'unknown', url: null, valid: false, fields: {}, checkedAt: new Date().toISOString() })),
    checkGreenWebFoundation(domain, userAgent).catch(() => ({ result: 'unknown', green: null, hostedBy: null, url: null, checkedAt: new Date().toISOString() })),
    checkSitemaps(origin, userAgent).catch(() => ({ xml: { found: false, url: null }, human: { found: false, url: null }, checkedAt: new Date().toISOString() })),
  ]);

  return {
    engine: 'public-interest',
    checkedAt: new Date().toISOString(),
    a11yStatement: a11y,
    carbonTxt: carbon,
    greenWebFoundation: gwf,
    sitemaps,
  };
}
