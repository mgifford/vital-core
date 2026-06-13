/**
 * Link checking. After a scan, the unique links seen on scanned pages
 * are probed for reachability. Broken links (4xx/5xx, DNS failures,
 * timeouts) are recorded into the run so reports can surface them.
 *
 * Design notes:
 *  - Politeness first. Checks are capped per run, run with bounded
 *    concurrency, and pause between requests to the same host. We are a
 *    guest on every server we touch, including the ones our targets
 *    link out to.
 *  - HEAD with a GET fallback. Many servers reject or mishandle HEAD;
 *    a 405/501 or network oddity retries once with GET (range-limited).
 *  - Identity preserved. Uses the scanner's user-agent so a server can
 *    recognize and allowlist us.
 */

const BROKEN_MIN = 400; // status >= this counts as broken (4xx/5xx)
// Statuses that are noisy false positives for link checking: many sites
// answer bots with 403/429 while the link is fine for humans.
const SOFT_OK = new Set([401, 403, 429]);

/**
 * Check one URL. Returns { url, status, ok, broken, reason }.
 *   ok      = reachable (2xx/3xx, or a soft-ok bot challenge)
 *   broken  = definitively broken (4xx except soft-ok, 5xx, network)
 */
export async function checkLink(url, { userAgent, timeoutMs = 15000 } = {}) {
  const attempt = async (method) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'user-agent': userAgent, accept: '*/*' },
      });
      return { status: res.status };
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    let { status } = await attempt('HEAD');
    // Some servers don't implement HEAD; retry once with GET.
    if (status === 405 || status === 501) {
      ({ status } = await attempt('GET'));
    }
    const broken = status >= BROKEN_MIN && !SOFT_OK.has(status);
    return { url, status, ok: !broken, broken, reason: broken ? `HTTP ${status}` : null };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timeout' : String(err?.cause?.code || err?.message || err).slice(0, 80);
    return { url, status: 0, ok: false, broken: true, reason };
  }
}

/**
 * Check a list of URLs with bounded concurrency and per-host pacing.
 * Returns only the broken ones (capped), plus a count of how many were
 * checked. `urls` should already be de-duplicated.
 */
export async function checkLinks(urls, { userAgent, timeoutMs = 15000, concurrency = 4, perHostDelayMs = 250, cap = 500 } = {}) {
  const toCheck = urls.slice(0, cap);
  const broken = [];
  const lastHostHit = new Map();
  let checked = 0;

  let cursor = 0;
  async function worker() {
    while (cursor < toCheck.length) {
      const url = toCheck[cursor++];
      // Per-host pacing: don't hammer one server even across workers.
      let host = '';
      try {
        host = new URL(url).host;
      } catch {
        continue;
      }
      const wait = (lastHostHit.get(host) ?? 0) + perHostDelayMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastHostHit.set(host, Date.now());

      const result = await checkLink(url, { userAgent, timeoutMs });
      checked++;
      if (result.broken) broken.push(result);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, toCheck.length) }, worker));
  return { checked, total: urls.length, broken };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
