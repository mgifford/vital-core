import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TargetDiscoveryEngine } from '../../src/engine/discovery';
import { PrioritySeedStore } from '../../src/engine/priority-seeds';
import { TargetConfig } from '../../src/types/profile';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn()
}));

vi.mock('sitemapper', () => ({
  default: vi.fn().mockImplementation(function MockSitemapper() {
    return {
      fetch: fetchMock
    };
  })
}));

describe('TargetDiscoveryEngine', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    PrioritySeedStore.setActiveSnapshotForTesting(null);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('matches include path globs against URL pathnames and keeps priority URLs first', async () => {
    fetchMock.mockResolvedValue({
      sites: [
        'https://www.cms.gov/medicare/advantage-quality-improvement-program',
        'https://www.cms.gov/about-cms',
        'https://www.cms.gov/contact-us'
      ]
    });

    const target: TargetConfig = {
      id: 'cms-gov',
      name: 'CMS',
      base_url: 'https://www.cms.gov',
      sitemap_url: 'https://www.cms.gov/sitemap.xml',
      include_paths: ['/medicare/*'],
      priority_urls: [
        'https://www.cms.gov/about-cms',
        'https://www.cms.gov/medicare/advantage-quality-improvement-program'
      ],
      settings: {
        postLoadDelay: 2000,
        max_pages: 10,
        maxTimeoutMs: 120000,
        include_subdomains: false
      }
    };

    const queue = await TargetDiscoveryEngine.discoverUrls(target);

    expect(queue).toEqual([
      'https://www.cms.gov/about-cms',
      'https://www.cms.gov/medicare/advantage-quality-improvement-program'
    ]);
  });

  it('falls back to priority URLs if sitemap retrieval fails', async () => {
    fetchMock.mockRejectedValue(new Error('network error'));

    const target: TargetConfig = {
      id: 'cms-gov',
      name: 'CMS',
      base_url: 'https://www.cms.gov',
      sitemap_url: 'https://www.cms.gov/sitemap.xml',
      include_paths: ['/medicare/*'],
      priority_urls: ['https://www.cms.gov/about-cms'],
      settings: {
        postLoadDelay: 2000,
        max_pages: 10,
        maxTimeoutMs: 120000,
        include_subdomains: false
      }
    };

    const queue = await TargetDiscoveryEngine.discoverUrls(target);

    expect(queue).toEqual(['https://www.cms.gov/about-cms']);
  });

  it('prepends monthly priority seed URLs from DuckDuckGo cache', async () => {
    fetchMock.mockResolvedValue({
      sites: ['https://www.cms.gov/contact-us']
    });

    PrioritySeedStore.setActiveSnapshotForTesting({
      generatedAt: new Date().toISOString(),
      strategy: 'duckduckgo-site-query',
      targets: [
        {
          targetId: 'cms-gov',
          host: 'cms.gov',
          domain: 'https://www.cms.gov',
          fetchedAt: new Date().toISOString(),
          source: 'duckduckgo',
          topUrls: ['https://www.cms.gov/medicare']
        }
      ]
    });

    const target: TargetConfig = {
      id: 'cms-gov',
      name: 'CMS',
      base_url: 'https://www.cms.gov',
      sitemap_url: 'https://www.cms.gov/sitemap.xml',
      include_paths: ['/*'],
      priority_urls: ['https://www.cms.gov/about-cms'],
      settings: {
        postLoadDelay: 2000,
        max_pages: 10,
        maxTimeoutMs: 120000,
        include_subdomains: false
      }
    };

    const queue = await TargetDiscoveryEngine.discoverUrls(target);
    expect(queue.slice(0, 3)).toEqual([
      'https://www.cms.gov/medicare',
      'https://www.cms.gov/about-cms',
      'https://www.cms.gov/contact-us'
    ]);
  });

  it('filters out off-host and non-html sitemap entries', async () => {
    fetchMock.mockResolvedValue({
      sites: [
        'https://www.cms.gov/about-cms',
        'https://data.cms.gov/',
        'https://www.cms.gov/files/document/manual.pdf',
        'https://www.cms.gov/feed',
        'https://www.cms.gov/medicare'
      ]
    });

    const target: TargetConfig = {
      id: 'cms-gov',
      name: 'CMS',
      base_url: 'https://www.cms.gov',
      sitemap_url: 'https://www.cms.gov/sitemap.xml',
      include_paths: ['/*'],
      priority_urls: [],
      settings: {
        postLoadDelay: 2000,
        max_pages: 10,
        maxTimeoutMs: 120000,
        include_subdomains: false
      }
    };

    const queue = await TargetDiscoveryEngine.discoverUrls(target);
    expect(queue).toEqual(['https://www.cms.gov/about-cms', 'https://www.cms.gov/medicare']);
  });
});
