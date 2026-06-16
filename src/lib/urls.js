import crypto from 'node:crypto';

/**
 * URL identity is the foundation of week-over-week comparability.
 * One normalization function, used everywhere. If this changes,
 * historical comparisons break, so treat it as a stable contract.
 */

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|msclkid|mc_cid|mc_eid|ref$)/i;
const SKIP_EXTENSIONS = /\.(pdf|zip|gz|tar|doc|docx|xls|xlsx|ppt|pptx|jpg|jpeg|png|gif|svg|webp|avif|ico|mp3|mp4|webm|mov|avi|css|js|mjs|json|xml|rss|atom|woff2?|ttf|eot|map)$/i;

/**
 * Strip a single leading `www.` label, lowercased. Used for host
 * comparison so the apex domain and its www variant count as the same
 * site (cdc.gov == www.cdc.gov), while any other subdomain stays
 * distinct (data.cms.gov != www.cms.gov).
 */
function bareHost(hostname) {
  return hostname.toLowerCase().replace(/^www\./, '');
}

/**
 * Normalize a URL relative to a base. Returns the canonical string,
 * or null if the URL should not be crawled (off-host, non-http,
 * binary asset, mailto, etc.).
 *
 * Host matching treats the apex and its `www.` variant as the same
 * host. The normalized URL keeps the link's actual hostname, so a site
 * that lives on (or redirects to) www stores www URLs consistently.
 */
export function normalizeUrl(raw, baseUrl, host) {
  let u;
  try {
    u = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (host && bareHost(u.hostname) !== bareHost(host)) return null;
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

/**
 * Build a URL filter from a target's url_include / url_exclude config.
 *
 * Both accept an array of strings. Each string is matched against the
 * full normalized URL (so it can match on path, query string, or domain).
 * Simple substring match — no regex complexity in config files.
 *
 * url_include: if set, only URLs whose full string contains at least one
 *   of the listed substrings are crawled/scanned. Used to restrict a scan
 *   to a subtree (e.g. url_include: ["/children/"]).
 *
 * url_exclude: URLs whose full string contains any of the listed substrings
 *   are skipped. Applied after url_include. Used to prune noise
 *   (e.g. url_exclude: ["press_release", "?page=", "/search?"]).
 *
 * Returns a function (url: string) -> boolean (true = keep, false = skip).
 * When neither is configured, always returns true.
 */
export function buildUrlFilter(target) {
  const includes = (target.url_include ?? []).map(String);
  const excludes = (target.url_exclude ?? []).map(String);
  if (!includes.length && !excludes.length) return () => true;
  return (url) => {
    if (includes.length && !includes.some((p) => url.includes(p))) return false;
    if (excludes.some((p) => url.includes(p))) return false;
    return true;
  };
}
