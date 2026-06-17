/**
 * Roll up per-page third-party observations into a per-origin summary for a
 * domain/week. Third-party JS varies page to page, so the rollup stays
 * page-resolved: each origin records how many pages it appeared on (and which),
 * its median load cost, whether it served scripts, and — for the accessibility
 * angle — on how many of those pages the page also had an accessibility finding.
 *
 * The finding co-occurrence is an association signal ("pages carrying this
 * vendor also tend to have findings"), not proof the vendor caused them. The
 * rigorous causal answer needs the comparative blocked-load mode; this is the
 * always-on, cheap attribution.
 */

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * `pages` is [{ pageUrl, hasFindings, origins: [{ origin, requests, bytes,
 * scripts, totalDurationMs }] }] — one entry per page the third-party engine
 * ran on. Returns
 *   {
 *     pagesScanned,
 *     vendors: [{
 *       origin, pages, pagesWithScripts, isScriptVendor,
 *       medianBytes, medianDurationMs, medianRequests,
 *       pagesWithFindings,            // pages with this origin that also had a finding
 *       examplePages: string[],       // up to 5
 *     }],   // sorted by pages desc, then medianBytes desc
 *   }
 */
export function rollupThirdParty(pages) {
  const byOrigin = new Map();
  for (const p of pages) {
    for (const o of p.origins ?? []) {
      let e = byOrigin.get(o.origin);
      if (!e) {
        e = { origin: o.origin, pages: 0, pagesWithScripts: 0, bytes: [], durations: [], requests: [], pagesWithFindings: 0, examplePages: [] };
        byOrigin.set(o.origin, e);
      }
      e.pages++;
      if (o.scripts > 0) e.pagesWithScripts++;
      e.bytes.push(o.bytes ?? 0);
      e.durations.push(o.totalDurationMs ?? 0);
      e.requests.push(o.requests ?? 0);
      if (p.hasFindings) e.pagesWithFindings++;
      if (e.examplePages.length < 5) e.examplePages.push(p.pageUrl);
    }
  }
  const vendors = [...byOrigin.values()]
    .map((e) => ({
      origin: e.origin,
      pages: e.pages,
      pagesWithScripts: e.pagesWithScripts,
      isScriptVendor: e.pagesWithScripts > 0,
      medianBytes: median(e.bytes),
      medianDurationMs: median(e.durations),
      medianRequests: median(e.requests),
      pagesWithFindings: e.pagesWithFindings,
      examplePages: e.examplePages,
    }))
    .sort((a, b) => b.pages - a.pages || b.medianBytes - a.medianBytes);
  return { pagesScanned: pages.length, vendors };
}
