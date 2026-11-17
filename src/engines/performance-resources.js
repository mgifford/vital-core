import { isThirdParty, registrableDomain } from '../lib/urls.js';

const MAX_RESOURCES = 200;
export const PERFORMANCE_RESOURCE_SCHEMA = 'performance-resource-inventory/1';

/** Resource Timing inventory from the page visit already in progress. */
export function createPerformanceResourceCollector(page, pageUrl, options = {}) {
  return {
    async collect() {
      let raw = [];
      let observed = 0;
      try {
        const sampled = await page.evaluate((limit) => {
          const all = performance.getEntriesByType('resource');
          // Sample evenly across the whole timeline, never just the last N:
          // navigation and early render-blocking resources must remain visible.
          const picks = all.length <= limit
            ? all
            : Array.from({ length: limit }, (_, i) => all[Math.floor((i * all.length) / limit)]);
          return {
            observed: all.length,
            entries: picks.map((entry) => ({
              name: entry.name,
              initiatorType: entry.initiatorType || 'other',
              transferSize: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
              encodedBodySize: Number.isFinite(entry.encodedBodySize) ? entry.encodedBodySize : null,
              decodedBodySize: Number.isFinite(entry.decodedBodySize) ? entry.decodedBodySize : null,
              duration: Number.isFinite(entry.duration) ? Math.round(entry.duration) : null,
              renderBlockingStatus: entry.renderBlockingStatus ?? null,
            })),
          };
        }, MAX_RESOURCES);
        raw = Array.isArray(sampled) ? sampled : sampled.entries;
        observed = Array.isArray(sampled) ? sampled.length : sampled.observed;
      } catch {
        raw = [];
      }
      const resources = [];
      const byKey = new Map();
      for (const entry of raw) {
        let key;
        try {
          const url = new URL(entry.name);
          key = `${url.origin}${url.pathname}`;
        } catch { continue; }
        let item = byKey.get(key);
        if (!item) {
          item = {
            key,
            type: entry.initiatorType,
            third_party: isThirdParty(entry.name, pageUrl),
            origin: (() => { try { return registrableDomain(new URL(entry.name).hostname); } catch { return null; } })(),
            occurrences: 0,
            transfer_bytes: 0,
            encoded_body_bytes: 0,
            decoded_body_bytes: 0,
            zero_transfer: 0,
            unavailable_transfer: 0,
            duration_ms: 0,
            render_blocking: false,
          };
          byKey.set(key, item);
        }
        item.occurrences++;
        item.transfer_bytes += entry.transferSize ?? 0;
        item.encoded_body_bytes += entry.encodedBodySize ?? 0;
        item.decoded_body_bytes += entry.decodedBodySize ?? 0;
        if (entry.transferSize === 0) item.zero_transfer++;
        if (entry.transferSize == null) item.unavailable_transfer++;
        item.duration_ms += entry.duration ?? 0;
        if (entry.renderBlockingStatus === 'blocking') item.render_blocking = true;
        resources.push(key);
      }
      const list = [...byKey.values()].sort((a, b) => b.transfer_bytes - a.transfer_bytes || b.decoded_body_bytes - a.decoded_body_bytes).slice(0, MAX_RESOURCES);
      return {
        engine: 'performance-resources',
        schema_version: PERFORMANCE_RESOURCE_SCHEMA,
        resource_count: list.length,
        total_transfer_bytes: list.reduce((sum, item) => sum + item.transfer_bytes, 0),
        total_decoded_bytes: list.reduce((sum, item) => sum + item.decoded_body_bytes, 0),
        third_party_resources: list.filter((item) => item.third_party).length,
        observed_entries: observed,
        retained_entries: list.length,
        truncated: observed > list.length,
        resources: list,
        measurement: {
          final_url: (() => { try { return page.url(); } catch { return null; } })(),
          main_document_included: false,
          boundary: 'Resource Timing entries from one page load; the HTML navigation document is excluded, as are server infrastructure and device energy.',
          limitations: ['Cross-origin resources may report zero or unavailable size without Timing-Allow-Origin.', 'Resource keys strip query strings; distinct query variants are not separated.', 'Presence does not establish component ownership or a performance defect.'],
        },
      };
    },
  };
}
