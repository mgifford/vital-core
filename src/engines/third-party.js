import { registrableDomain, isThirdParty } from '../lib/urls.js';

/**
 * Third-party resource evaluation, with a focus on third-party JavaScript.
 *
 * Third-party scripts are easy to drop onto a page (analytics, tag managers,
 * chat widgets, embeds) and frequently degrade it — extra bytes and load
 * time, and accessibility regressions from injected DOM the site owner never
 * reviewed. This engine inventories, per page, what each third-party origin
 * costs: how many requests and bytes it pulled, how long those took, and how
 * many of them were scripts.
 *
 * Mechanism mirrors the sustainability collector: a response hook attached
 * BEFORE navigation accumulates per-origin totals; collect() detaches it and
 * enriches the totals with per-origin timing from the page's Resource Timing
 * API. "Third party" means a different registrable domain (eTLD+1) than the
 * page — same-site subdomains (cdn.cms.gov for a cms.gov page) are first
 * party. See src/lib/urls.js.
 *
 * Accessibility attribution is intentionally NOT done here by re-running or
 * blocking: that belongs to a separate, heavier comparative mode. This engine
 * records the load-cost facts plus enough structure (which origins served
 * scripts, and on which page) for aggregate to correlate third parties with
 * the page's findings. Honest about limits: presence + cost is measured;
 * causation of any specific violation is left to the correlation view and a
 * human.
 */

const MAX_ORIGINS = 200; // bound record size on pathological pages

export function createThirdPartyCollector(page, pageUrl) {
  // origin (registrable domain) -> { requests, bytes, scripts, byType }
  const origins = new Map();
  let firstPartyBytes = 0;
  let firstPartyRequests = 0;

  const onResponse = async (response) => {
    const url = response.url();
    const type = response.request().resourceType() || 'other';
    let size = 0;
    try {
      const lenHeader = response.headers()['content-length'];
      if (lenHeader) {
        size = parseInt(lenHeader, 10) || 0;
      } else {
        const body = await response.body().catch(() => null);
        size = body ? body.length : 0;
      }
    } catch {
      size = 0;
    }

    if (!isThirdParty(url, pageUrl)) {
      firstPartyRequests++;
      firstPartyBytes += size;
      return;
    }
    let host;
    try { host = registrableDomain(new URL(url).hostname); } catch { return; }
    if (!host) return;
    let e = origins.get(host);
    if (!e) {
      if (origins.size >= MAX_ORIGINS) return;
      e = { origin: host, requests: 0, bytes: 0, scripts: 0, byType: {} };
      origins.set(host, e);
    }
    e.requests++;
    e.bytes += size;
    e.byType[type] = (e.byType[type] ?? 0) + 1;
    if (type === 'script') e.scripts++;
  };

  page.on('response', onResponse);

  return {
    async collect() {
      page.off('response', onResponse);

      // Per-origin timing from the Resource Timing API: total transfer
      // duration attributable to each registrable domain. Gives a "how much
      // wall-clock did this third party cost" signal the response hook can't.
      let timing = [];
      try {
        timing = await page.evaluate(() =>
          performance.getEntriesByType('resource').map((e) => ({
            name: e.name,
            duration: e.duration,
            transferSize: e.transferSize || 0,
            initiatorType: e.initiatorType,
          }))
        );
      } catch {
        timing = [];
      }
      const durByOrigin = {};
      for (const t of timing) {
        if (!isThirdParty(t.name, pageUrl)) continue;
        let host;
        try { host = registrableDomain(new URL(t.name).hostname); } catch { continue; }
        durByOrigin[host] = (durByOrigin[host] ?? 0) + (t.duration || 0);
      }

      const list = [...origins.values()]
        .map((e) => ({
          ...e,
          totalDurationMs: Math.round(durByOrigin[e.origin] ?? 0),
        }))
        .sort((a, b) => b.bytes - a.bytes);

      const scriptOrigins = list.filter((e) => e.scripts > 0);
      return {
        engine: 'third-party',
        pageUrl,
        thirdPartyOrigins: list.length,
        scriptOrigins: scriptOrigins.length,
        totalThirdPartyRequests: list.reduce((s, e) => s + e.requests, 0),
        totalThirdPartyBytes: list.reduce((s, e) => s + e.bytes, 0),
        totalThirdPartyScripts: list.reduce((s, e) => s + e.scripts, 0),
        firstPartyRequests,
        firstPartyBytes,
        // Per-origin detail, heaviest first.
        origins: list,
      };
    },
  };
}
