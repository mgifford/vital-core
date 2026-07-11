// Redaction for URLs surfaced in the static JSON API (issue #136). The API is
// published to GitHub Pages, so any URL it emits must not carry a fragment or a
// sensitive query-string value (auth tokens, session ids, emails, etc.). This
// is independent of the scan-time url_exclude filter (which drops whole pages
// before they are ever fetched) and the render-time url_exclude_patterns filter
// (which hides pages from a report) — those are applied separately in aggregate.

export const REDACTED = '[REDACTED]';

// Query-parameter names whose *values* are redacted. Matched case-insensitively
// as a whole word or as a segment of a snake/camel/kebab name (so `access_token`
// and `csrfToken` both match `token`). Deliberately covers the common families
// rather than trying to be exhaustive; a per-target denylist extends it.
const SENSITIVE_PARAM_PARTS = [
  'token', 'secret', 'session', 'sid', 'auth', 'password', 'passwd', 'pwd',
  'email', 'apikey', 'api_key', 'access', 'signature', 'sig', 'code',
  'key', 'nonce', 'state', 'jwt', 'bearer', 'otp',
];

function normalizeParamName(name) {
  // Insert a break at camelCase boundaries (csrfToken -> csrf_Token) before
  // lowercasing, so segment matching sees `token` inside `csrfToken`.
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

function isSensitiveParam(name, denyParts) {
  const norm = normalizeParamName(name);
  const segments = norm.split('_').filter(Boolean);
  const parts = denyParts && denyParts.length
    ? SENSITIVE_PARAM_PARTS.concat(denyParts.map((d) => normalizeParamName(d)))
    : SENSITIVE_PARAM_PARTS;
  // Match on a whole segment (so `code` matches `?code=…` and `?id_token=…`
  // via the `token` segment, but `?nodecode=…` — one segment "nodecode" — does
  // not spuriously match `code`).
  return parts.some((p) => segments.includes(p));
}

function redactQueryString(search, denyParts) {
  // `search` includes the leading '?'. Preserve param order and names; replace
  // only sensitive values. Work on the raw string so we don't re-encode benign
  // values (URLSearchParams would normalize '+', '%20', etc.).
  const q = search.startsWith('?') ? search.slice(1) : search;
  if (!q) return '';
  const out = q.split('&').map((pair) => {
    const eq = pair.indexOf('=');
    const name = eq === -1 ? pair : pair.slice(0, eq);
    if (eq === -1) return pair; // bare flag, no value to redact
    return isSensitiveParam(name, denyParts) ? `${name}=${REDACTED}` : pair;
  });
  return '?' + out.join('&');
}

/**
 * Redact one URL for publication: strip any #fragment and replace the value of
 * any sensitive query parameter with [REDACTED]. Accepts absolute URLs and the
 * already-normalized path-only strings the scanner sometimes stores; both are
 * handled by string surgery so no origin is required and benign parts are left
 * byte-for-byte intact. Non-string input is returned unchanged.
 */
export function redactUrl(url, { denyParams = [] } = {}) {
  if (typeof url !== 'string' || url === '') return url;
  const hashIdx = url.indexOf('#');
  const noFragment = hashIdx === -1 ? url : url.slice(0, hashIdx);
  const qIdx = noFragment.indexOf('?');
  if (qIdx === -1) return noFragment;
  const base = noFragment.slice(0, qIdx);
  const query = redactQueryString(noFragment.slice(qIdx), denyParams);
  return base + query;
}

/**
 * Return a shallow copy of a bug-report object with every URL-bearing field
 * redacted: `url`, `affected_pages[]` (array of strings), and `examples[].url`.
 * Other fields are passed through untouched. Pure — does not mutate `bug`.
 */
export function redactBugUrls(bug, opts = {}) {
  if (!bug || typeof bug !== 'object') return bug;
  const out = { ...bug };
  if (typeof out.url === 'string') out.url = redactUrl(out.url, opts);
  if (Array.isArray(out.affected_pages)) {
    out.affected_pages = out.affected_pages.map((u) => redactUrl(u, opts));
  }
  if (Array.isArray(out.examples)) {
    out.examples = out.examples.map((ex) =>
      ex && typeof ex.url === 'string' ? { ...ex, url: redactUrl(ex.url, opts) } : ex
    );
  }
  return out;
}

/** Map redactBugUrls over an array of bugs. */
export function redactBugs(bugs, opts = {}) {
  if (!Array.isArray(bugs)) return bugs;
  return bugs.map((b) => redactBugUrls(b, opts));
}

/**
 * Deep-redact every URL-bearing field in an arbitrary structure: the value of
 * any object key named `url` is redacted, and any key named `urls` holding an
 * array of strings has each entry redacted. Returns a redacted deep copy;
 * non-URL values are copied through unchanged. Used at the API boundary
 * (buildSnapshot's weekly series) where URLs are nested inside internal objects
 * whose full shape we don't want to enumerate — this guarantees no `url` field
 * escapes regardless of nesting depth.
 */
export function deepRedactUrls(value, opts = {}) {
  if (Array.isArray(value)) return value.map((v) => deepRedactUrls(v, opts));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'url' && typeof v === 'string') out[k] = redactUrl(v, opts);
      else if (k === 'urls' && Array.isArray(v)) out[k] = v.map((u) => (typeof u === 'string' ? redactUrl(u, opts) : deepRedactUrls(u, opts)));
      else out[k] = deepRedactUrls(v, opts);
    }
    return out;
  }
  return value;
}
