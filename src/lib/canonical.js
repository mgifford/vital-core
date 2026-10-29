import { bareHost } from './urls.js';

/**
 * The origin a site serves its pages from: the scheme and host its homepage
 * redirects to. scan.js resolves it once per run and records every same-site
 * URL in that form (normalizeUrl's canonicalOrigin), so the http:// and
 * https://, or apex and www., forms of a page are scanned once instead of
 * twice, each behind a redirect.
 */

/** The final URL's origin when it is the same site, else the configured one. */
export function pickCanonicalOrigin(configuredOrigin, finalUrl) {
  const configured = new URL(configuredOrigin);
  let final;
  try {
    final = new URL(finalUrl);
  } catch {
    return configured.origin;
  }
  if (final.protocol !== 'http:' && final.protocol !== 'https:') return configured.origin;
  return bareHost(final.hostname) === bareHost(configured.hostname) ? final.origin : configured.origin;
}

/**
 * What "Served over HTTPS" should say for the resolved origin: null when it
 * is https, otherwise why the site is being scanned over http.
 */
export function httpsProblem({ origin, configured, httpsError = null }) {
  if (origin.startsWith('https:')) return null;
  if (httpsError) return `no working HTTPS (${httpsError}); served over http`;
  if (configured.startsWith('https:')) return 'HTTPS redirects to HTTP';
  return 'http';
}

async function fetchHome(origin, userAgent, timeoutMs) {
  try {
    const res = await fetch(new URL('/', origin), {
      headers: { 'user-agent': userAgent },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.body?.cancel().catch(() => {});
    return { url: res.url };
  } catch (err) {
    if (err.name === 'TimeoutError') return { error: `no response within ${Math.round(timeoutMs / 1000)} s` };
    return { error: err.cause?.code ?? err.cause?.message ?? err.message };
  }
}

/**
 * Follow the homepage's redirects to find the canonical origin. When an
 * https:// origin fails and http:// answers, the site is scanned over http
 * and the HTTPS error is kept for the security check. When nothing answers,
 * or the homepage redirects to another site, the configured origin is kept.
 */
export async function resolveCanonicalOrigin(configuredOrigin, userAgent, timeoutMs = 20000) {
  const configured = new URL(configuredOrigin).origin;
  let home = await fetchHome(configured, userAgent, timeoutMs);
  let httpsError = null;
  if (home.error && configured.startsWith('https:')) {
    const plain = await fetchHome(configured.replace(/^https:/, 'http:'), userAgent, timeoutMs);
    if (!plain.error) {
      httpsError = home.error;
      home = plain;
    }
  }
  if (home.error) {
    return { origin: configured, configured, httpsProblem: null, homeError: home.error, note: `homepage unreachable (${home.error}); keeping ${configured}` };
  }
  const origin = pickCanonicalOrigin(configured, home.url);
  let note = null;
  if (origin === configured && new URL(home.url).origin !== configured) {
    note = `homepage redirects to another site (${new URL(home.url).host}); keeping ${configured}`;
  } else if (origin !== configured) {
    note = `homepage redirects from ${configured}`;
  }
  return { origin, configured, httpsProblem: httpsProblem({ origin, configured, httpsError }), note };
}
