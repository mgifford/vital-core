import type { DiscoveryQueueComposition, DiscoveryQueueEntry } from './discovery';

export function deriveQueueComposition(
  entries: DiscoveryQueueEntry[],
  urls: string[]
): DiscoveryQueueComposition {
  const selectedUrls = new Set(urls);
  return entries
    .filter(entry => selectedUrls.has(entry.url))
    .reduce<DiscoveryQueueComposition>(
      (counts, entry) => {
        counts[entry.source] += 1;
        return counts;
      },
      {
        recently_updated: 0,
        duckduckgo_seed: 0,
        priority_url: 0,
        stale_weekly_rescan: 0,
        sitemap_sample: 0
      }
    );
}