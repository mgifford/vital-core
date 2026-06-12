import crypto from 'node:crypto';

/**
 * URL identity is the foundation of week-over-week comparability.
 * One normalization function, used everywhere. If this changes,
 * historical comparisons break, so treat it as a stable contract.
 */

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|msclkid|mc_cid|mc_eid|ref$)/i;
const SKIP_EXTENSIONS = /\.(pdf|zip|gz|tar|doc|docx|xls|xlsx|ppt|pptx|jpg|jpeg|png|gif|svg|webp|avif|ico|mp3|mp4|webm|mov|avi|css|js|mjs|json|xml|rss|atom|woff2?|ttf|eot|map)$/i;

/**
 * Normalize a URL relative to a base. Returns the canonical string,
 * or null if the URL should not be crawled (off-host, non-http,
 * binary asset, mailto, etc.).
 */
export function normalizeUrl(raw, baseUrl, host) {
  let u;
  try {
    u = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (host && u.hostname.toLowerCase() !== host.toLowerCase()) return null;
  if (SKIP_EXTENSIONS.test(u.pathname)) return null;

  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) {
    u.port = '';
  }
  // Drop tracking parameters; sort the rest for stable identity.
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  u.search = '';
  for (const [k, v] of params) u.searchParams.append(k, v);
  // Trailing slash: strip except for the root path.
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.toString();
}

/** Short stable identifier for a normalized URL. */
export function pageId(normalizedUrl) {
  return crypto.createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 16);
}
