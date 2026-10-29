import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DIRS } from './config.js';

/**
 * URL identity is the foundation of week-over-week comparability.
 * One normalization function, used everywhere. If this changes,
 * historical comparisons break, so treat it as a stable contract.
 * The scheme and host come from the site's canonical origin (canonical.js)
 * when the caller passes it, so a redirect variant is never a second page.
 */

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|msclkid|mc_cid|mc_eid|ref$)/i;
const SKIP_EXTENSIONS = /\.(pdf|zip|gz|tar|doc|docx|xls|xlsx|ppt|pptx|jpg|jpeg|png|gif|svg|webp|avif|ico|mp3|mp4|webm|mov|avi|css|js|mjs|json|xml|rss|atom|woff2?|ttf|eot|map)$/i;

/**
 * Strip a single leading `www.` label, lowercased. Used for host
 * comparison so the apex domain and its www variant count as the same
 * site (cdc.gov == www.cdc.gov), while any other subdomain stays
 * distinct (data.cms.gov != www.cms.gov).
 */
export function bareHost(hostname) {
  return hostname.toLowerCase().replace(/^www\./, '');
}

// Common multi-label public suffixes. Not the full Public Suffix List (that
// would be a heavy dependency for marginal gain here), but enough to classify
// first- vs third-party correctly for the gov/edu/org/co.uk-style hosts we
// actually encounter. eTLD+1 falls back to the last two labels otherwise.
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au',
  'co.nz', 'govt.nz', 'org.nz', 'co.jp', 'or.jp', 'go.jp',
  'com.br', 'gov.br', 'org.br', 'co.za', 'gov.za', 'org.za',
  'com.mx', 'gob.mx', 'gc.ca', 'on.ca', 'qc.ca',
]);

/**
 * Registrable domain (eTLD+1) of a hostname — the unit at which we judge
 * "same site" vs "third party". E.g. fonts.googleapis.com -> googleapis.com,
 * www.cdc.gov -> cdc.gov, x.service.gov.uk -> service.gov.uk. Lowercased.
 * Returns the input lowercased if it has too few labels to reduce.
 */
export function registrableDomain(hostname) {
  if (!hostname) return '';
  const labels = hostname.toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

/**
 * Is `resourceUrl` served from a different registrable domain than the page?
 * Third-party = different eTLD+1. Same-site subdomains (cdn.cms.gov for a
 * cms.gov page) are first-party. Non-http(s) URLs (data:, blob:) are not
 * third party. Returns false on parse failure (conservative).
 */
export function isThirdParty(resourceUrl, pageUrl) {
  let r, p;
  try { r = new URL(resourceUrl); p = new URL(pageUrl); } catch { return false; }
  if (r.protocol !== 'http:' && r.protocol !== 'https:') return false;
  return registrableDomain(r.hostname) !== registrableDomain(p.hostname);
}

/**
 * Normalize a URL relative to a base. Returns the canonical string,
 * or null if the URL should not be crawled (off-host, non-http,
 * binary asset, mailto, etc.).
 *
 * Host matching treats the apex and its `www.` variant as the same
 * host. Without `canonicalOrigin` the normalized URL keeps the link's own
 * scheme and hostname. With it (the origin the site's homepage redirects
 * to, from canonical.js), a same-site URL takes that scheme and host, so
 * `http://example.gov/a` and `https://www.example.gov/a` are one page.
 * URLs already in canonical form keep their page IDs.
 */
export function normalizeUrl(raw, baseUrl, host, canonicalOrigin) {
  let u;
  try {
    u = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (host && bareHost(u.hostname) !== bareHost(host)) return null;
  if (SKIP_EXTENSIONS.test(u.pathname)) return null;
  if (canonicalOrigin) adoptOrigin(u, canonicalOrigin);

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

function adoptOrigin(u, canonicalOrigin) {
  const c = new URL(canonicalOrigin);
  if (bareHost(u.hostname) !== bareHost(c.hostname)) return;
  u.protocol = c.protocol;
  u.host = c.host;
}

/** A normalized URL with a same-site scheme and host replaced by canonicalOrigin's. */
export function toCanonicalOrigin(url, canonicalOrigin) {
  const u = new URL(url);
  adoptOrigin(u, canonicalOrigin);
  return u.toString();
}

/**
 * A URL without its scheme, a leading `www.` or a fragment, for matching a
 * page however its address is written (http or https, apex or www).
 */
export function urlMatchKey(url) {
  return String(url ?? '').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./i, '').replace(/#.*$/, '');
}

/** Short stable identifier for a normalized URL. */
export function pageId(normalizedUrl) {
  return crypto.createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 16);
}

/**
 * Compile one filter pattern into a matcher (url: string) -> boolean.
 *
 * A pattern wrapped in slashes — `/press[-_]release/i` — is a JavaScript
 * regular expression (an optional trailing flag string is honored); anything
 * else is a plain case-sensitive substring. An unparseable regex falls back
 * to a literal substring match on the raw text (including the slashes) and
 * warns, so a typo can never silently match everything or nothing.
 */
function compilePattern(pattern, key) {
  const str = String(pattern);
  const m = /^\/(.+)\/([a-z]*)$/i.exec(str);
  if (m) {
    try {
      const re = new RegExp(m[1], m[2]);
      return (url) => re.test(url);
    } catch (err) {
      console.warn(`[${key ?? '?'}] invalid url filter regex ${str}: ${err.message}; treating as substring`);
    }
  }
  return (url) => url.includes(str);
}

/**
 * Read a URL-pattern file: one pattern per line, blank lines and `#` comments
 * ignored. Relative paths resolve under `config/` then the repo root, matching
 * priority_urls_file. A missing file warns and contributes no patterns (the
 * scan still runs) rather than throwing.
 */
function readPatternFile(file, key) {
  const candidates = path.isAbsolute(file)
    ? [file]
    : [path.join(DIRS.config, file), path.join(DIRS.root, file)];
  const p = candidates.find((c) => fs.existsSync(c));
  if (!p) {
    console.warn(`[${key ?? '?'}] url pattern file not found: tried ${candidates.join(', ')}`);
    return [];
  }
  const out = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (t && !t.startsWith('#')) out.push(t);
  }
  return out;
}

/**
 * Resolve a target's URL patterns from an inline array plus an optional file,
 * merged in that order. Used for both url_include (+ url_include_file) and
 * url_exclude (+ url_exclude_file). Returns an array of raw pattern strings.
 */
export function resolveUrlPatterns(list, file, key) {
  const patterns = [...(list ?? [])].map(String);
  if (file) patterns.push(...readPatternFile(file, key));
  return patterns;
}

/**
 * Build a URL filter from a target's url_include / url_exclude config.
 *
 * Each accepts an inline array (`url_include` / `url_exclude`) and/or a file of
 * patterns (`url_include_file` / `url_exclude_file`, one per line, `#` comments
 * allowed — resolved under config/ like priority_urls_file). Inline and file
 * patterns are merged. Every pattern is matched against the full normalized URL
 * (so it can match on path, query string, or host) as a substring, or — when
 * wrapped in slashes, e.g. `/\/news\/\d{4}\//` — as a regular expression.
 *
 * url_include: if set, only URLs matching at least one include pattern are
 *   crawled/scanned. Used to restrict a scan to a subtree (e.g. ["/children/"]).
 *
 * url_exclude: URLs matching any exclude pattern are skipped. Applied after
 *   url_include. Used to prune noise (e.g. ["press_release", "?page="]).
 *
 * Returns a function (url: string) -> boolean (true = keep, false = skip).
 * When neither list nor file is configured, always returns true.
 */
export function buildUrlFilter(target) {
  const key = target.key;
  const includePatterns = resolveUrlPatterns(target.url_include, target.url_include_file, key);
  const excludePatterns = resolveUrlPatterns(target.url_exclude, target.url_exclude_file, key);
  if (!includePatterns.length && !excludePatterns.length) return () => true;
  const includes = includePatterns.map((p) => compilePattern(p, key));
  const excludes = excludePatterns.map((p) => compilePattern(p, key));
  return (url) => {
    if (includes.length && !includes.some((m) => m(url))) return false;
    if (excludes.some((m) => m(url))) return false;
    return true;
  };
}
