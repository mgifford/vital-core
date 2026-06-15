/**
 * Security & domain-hygiene checks, in the spirit of ScanGov's Security
 * topic (https://standards.scangov.org/). These are per-origin, not
 * per-page: HTTPS, security response headers, a published security.txt,
 * a sponsored government TLD, and www resolution. Checkable from a couple
 * of cheap header fetches, so this engine runs at a low rate (the
 * homepage/origin is what matters).
 *
 * Complements ScanGov: ScanGov scores a domain's homepage; we run the
 * same checks as part of our site-wide scan and track them week over week.
 * Standards methodology credit: ScanGov (CC0).
 *
 * Each check is { id, label, pass, detail }.
 */

const SPONSORED_TLDS = ['.gov', '.mil', '.edu', '.fed.us'];

export async function runSecurity(origin, userAgent, timeoutMs = 15000) {
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

  add('https', 'Served over HTTPS', url.protocol === 'https:', url.protocol);

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

  // Sponsored government TLD.
  const host = url.hostname.toLowerCase();
  add('gov-tld', 'Sponsored government TLD (.gov/.mil/.edu)',
    SPONSORED_TLDS.some((t) => host.endsWith(t)), host.split('.').slice(-1)[0]);

  // security.txt (well-known location, with legacy fallback).
  const stdPath = `${url.protocol}//${url.host}/.well-known/security.txt`;
  const legacyPath = `${url.protocol}//${url.host}/security.txt`;
  const st = await safeFetch(stdPath, userAgent, timeoutMs);
  const stLegacy = st?.ok ? null : await safeFetch(legacyPath, userAgent, timeoutMs);
  add('security-txt', 'Published security.txt', !!(st?.ok || stLegacy?.ok));

  // www resolution: the other-of-www variant should also resolve.
  const altHost = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
  const alt = await safeFetch(`${url.protocol}//${altHost}/`, userAgent, timeoutMs);
  add('www-resolution', 'Resolves with and without www', !!(alt && alt.status < 400), altHost);

  const passed = checks.filter((c) => c.pass).length;
  return { engine: 'security', checks, passed, total: checks.length };
}

async function safeFetch(u, userAgent, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(u, { method: 'GET', redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': userAgent } });
    return { ok: res.ok, status: res.status, headers: res.headers };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
