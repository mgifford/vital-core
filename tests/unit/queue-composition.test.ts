import { describe, expect, it } from 'vitest';
import type { DiscoveryQueueEntry } from '../../src/engine/discovery';
import { deriveQueueComposition } from '../../src/engine/queue-composition';

describe('deriveQueueComposition', () => {
  it('counts only the URLs that are present in the final queue slice', () => {
    const entries: DiscoveryQueueEntry[] = [
      {
        url: 'https://www.cms.gov/recent',
        source: 'recently_updated',
        reason: 'recent',
        templateKey: '/recent',
        lastSuccessAt: null,
        lastModified: null
      },
      {
        url: 'https://www.cms.gov/seed',
        source: 'duckduckgo_seed',
        reason: 'seed',
        templateKey: '/seed',
        lastSuccessAt: null,
        lastModified: null
      },
      {
        url: 'https://www.cms.gov/priority',
        source: 'priority_url',
        reason: 'priority',
        templateKey: '/priority',
        lastSuccessAt: null,
        lastModified: null
      }
    ];

    expect(deriveQueueComposition(entries, ['https://www.cms.gov/recent', 'https://www.cms.gov/priority'])).toEqual({
      recently_updated: 1,
      duckduckgo_seed: 0,
      priority_url: 1,
      stale_weekly_rescan: 0,
      sitemap_sample: 0
    });
  });
});