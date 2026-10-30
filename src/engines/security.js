/**
 * Security & domain-hygiene checks, in the spirit of ScanGov's Security
 * topic (https://standards.scangov.org/). These are per-origin, not
 * per-page: HTTPS, security response headers, a published security.txt,
 * a government domain (and whose), and the bare and www. forms of the domain
 * answering. Checkable from a couple
 * of cheap header fetches, so this engine runs at a low rate (the
 * homepage/origin is what matters).
 *
 * Complements ScanGov: ScanGov scores a domain's homepage; we run the
 * same checks as part of our site-wide scan and track them week over week.
 * Standards methodology credit: ScanGov (CC0).
 *
 * Each check is { id, label, pass, detail }.
 */

import { getDomain } from 'tldts-icann';

// Namespaces only a government (or, for .edu, an accredited institution) can
// register. Other countries reserve a second-level domain instead of a TLD,
// so a .gov.uk council must count the same as a US .gov agency. A fleet adds
// its own with the `government_domains` setting.
export const GOVERNMENT_DOMAINS = [
  { suffix: '.gov', country: 'United States' },
  { suffix: '.mil', country: 'United States' },
  { suffix: '.edu', country: 'United States' },
  { suffix: '.fed.us', country: 'United States' },
  { suffix: '.gov.uk', country: 'United Kingdom' },
  { suffix: '.gov.scot', country: 'Scotland' },
  { suffix: '.gov.wales', country: 'Wales' },
  { suffix: '.llyw.cymru', country: 'Wales' },
  { suffix: '.gc.ca', country: 'Canada' },
  { suffix: '.canada.ca', country: 'Canada' },
  { suffix: '.gov.au', country: 'Australia' },
  { suffix: '.govt.nz', country: 'New Zealand' },
  { suffix: '.go.jp', country: 'Japan' },
  { suffix: '.gouv.fr', country: 'France' },
  { suffix: '.gov.ie', country: 'Ireland' },
  { suffix: '.europa.eu', country: 'European Union' },
];

const bare = (hostname) => String(hostname ?? '').toLowerCase().replace(/\.$/, '');

/** The government namespace a host sits in ({ suffix, country }), or null. */
export function governmentDomain(hostname, extra = []) {
  const host = bare(hostname);
  if (!host) return null;
  return [...extra, ...GOVERNMENT_DOMAINS].find(({ suffix }) => host.endsWith(suffix) || host === suffix.slice(1)) ?? null;
}

/** The government namespace a host sits in (e.g. '.gov.uk'), or null. */
export function governmentSuffix(hostname, extra = []) {
  return governmentDomain(hostname, extra)?.suffix ?? null;
}

export function governmentDomainCheck(hostname, extra = []) {
  const gov = governmentDomain(hostname, extra);
  const host = bare(hostname);
  return {
    id: 'gov-tld',
    label: 'Government domain',
    pass: !!gov,
    detail: gov ? `${gov.suffix.slice(1)} (${gov.country})` : `${getDomain(host) ?? host} is not a listed government domain`,
  };
}

/**
 * Re-derives the government-domain check of a stored security result. It
 * needs no network, so records scanned before a namespace was listed (or
 * before a fleet set `government_domains`) report today's answer.
 */
export function withCurrentGovernmentCheck(security, hostname, extra = []) {
  if (!security?.checks?.some((c) => c.id === 'gov-tld')) return security;
  const checks = security.checks.map((c) => (c.id === 'gov-tld' ? governmentDomainCheck(hostname, extra) : c));
  return { ...security, checks, passed: checks.filter((c) => c.pass).length };
}

/**
 * The addresses a visitor might type for a site other than its own host:
 * its registrable domain with and without www. For go.walsall.gov.uk that is
 * walsall.gov.uk and www.walsall.gov.uk, not www.go.walsall.gov.uk.
 */
export function wwwVariants(hostname) {
  const host = bare(hostname);
  const domain = getDomain(host);
  if (!domain) return [];
  const apex = domain.startsWith('www.') ? domain.slice(4) : domain;
  return [apex, `www.${apex}`].filter((h) => h !== host);
}

/**
 * `origin` is the site's resolved canonical origin (canonical.js), so a site
 * with no working HTTPS is checked over http and fails "Served over HTTPS";
 * `httpsProblem` says why.
 */
export async function runSecurity(origin, userAgent, timeoutMs = 15000, { httpsProblem = null, governmentDomains = [] } = {}) {
  const checks = [];
  const add = (id, label, pass, detail = '') => checks.push({ id, label, pass, detail });

  let url;
  try {
    url = new URL(origin);
  } catch {
    return { engine: 'security', checks: [], passed: 0, total: 0 };
  }

  // HTTPS + the response headers come from one fetch of the origin.
  const res = await safeFetch(origin, userAgent, timeoutMs);
  const headers = res?.headers;

  add('https', 'Served over HTTPS', url.protocol === 'https:', httpsProblem ?? url.protocol);

  if (headers) {
    add('hsts', 'HTTP Strict Transport Security (HSTS)', headers.has('strict-transport-security'));
    add('csp', 'Content Security Policy (CSP)', headers.has('content-security-policy'));
    add('x-content-type-options', 'X-Content-Type-Options: nosniff',
      (headers.get('x-content-type-options') || '').toLowerCase().includes('nosniff'));
    // Clickjacking protection: X-Frame-Options OR CSP frame-ancestors.
    const xfo = headers.has('x-frame-options');
    const frameAncestors = (headers.get('content-security-policy') || '').includes('frame-ancestors');
    add('clickjacking', 'Clickjacking protection (X-Frame-Options or CSP frame-ancestors)', xfo || frameAncestors);
  } else {
    add('hsts', 'HTTP Strict Transport Security (HSTS)', false, 'origin unreachable');
  }

  const host = url.hostname.toLowerCase();
  checks.push(governmentDomainCheck(host, governmentDomains));

  // security.txt (well-known location, with legacy fallback).
  const stdPath = `${url.protocol}//${url.host}/.well-known/security.txt`;
  const legacyPath = `${url.protocol}//${url.host}/security.txt`;
  const st = await safeFetch(stdPath, userAgent, timeoutMs);
  const stLegacy = st?.ok ? null : await safeFetch(legacyPath, userAgent, timeoutMs);
  add('security-txt', 'Published security.txt', !!(st?.ok || stLegacy?.ok));

  // www resolution: the bare and www. forms of the site's domain should each
  // answer, by redirecting here or serving the site, not with an error.
  const variants = wwwVariants(host);
  if (variants.length) {
    const results = [];
    for (const v of variants) results.push({ v, res: await safeFetch(`${url.protocol}//${v}/`, userAgent, timeoutMs) });
    add('www-resolution', 'Resolves with and without www',
      results.every(({ res }) => res && res.status < 400),
      results.map(({ v, res }) => `${v} ${describeLanding(v, res)}`).join('; '));
  }

  const passed = checks.filter((c) => c.pass).length;
  return { engine: 'security', checks, passed, total: checks.length };
}

async function safeFetch(u, userAgent, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(u, { method: 'GET', redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': userAgent } });
    return { ok: res.ok, status: res.status, headers: res.headers, url: res.url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function describeLanding(variant, res) {
  if (!res) return 'does not answer';
  if (res.status >= 400) return `answers HTTP ${res.status}`;
  let landed = null;
  try { landed = new URL(res.url).hostname; } catch { /* a fetch stand-in without a url */ }
  return landed && landed !== variant ? `redirects to ${landed}` : 'answers';
}
