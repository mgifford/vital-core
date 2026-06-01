import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TargetDiscoveryEngine } from '../../src/engine/discovery';
import { PrioritySeedStore } from '../../src/engine/priority-seeds';
import { TargetConfig } from '../../src/types/profile';
import { PageStateMap } from '../../src/engine/reporters/page-state-cache';
import { UrlManifest } from '../../src/engine/url-manifest';

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
    TargetDiscoveryEngine.resetNonHtmlExclusionsForTesting();
    delete process.env.VITAL_SAMPLING_SEED;
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
        include_subdomains: false,
        sitemap_template_sample_cap: 3,
        sitemap_sample_stochastic: true,
        unique_page_focus: false,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    const { urls: queue } = await TargetDiscoveryEngine.discoverUrls(target);

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
        include_subdomains: false,
        sitemap_template_sample_cap: 3,
        sitemap_sample_stochastic: true,
        unique_page_focus: false,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    const { urls: queue } = await TargetDiscoveryEngine.discoverUrls(target);

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
          estimatedIndexedPages: 1200,
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
        include_subdomains: false,
        sitemap_template_sample_cap: 3,
        sitemap_sample_stochastic: true,
        unique_page_focus: false,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    const { urls: queue } = await TargetDiscoveryEngine.discoverUrls(target);
    expect(queue.slice(0, 3)).toEqual([
      'https://www.cms.gov/medicare',
      'https://www.cms.gov/about-cms',
      'https://www.cms.gov/contact-us'
    ]);
  });

  it('filters out off-host and non-html sitemap entries, including .pdf and .docx', async () => {
    fetchMock.mockResolvedValue({
      sites: [
        'https://www.cms.gov/about-cms',
        'https://data.cms.gov/',
        'https://www.cms.gov/files/document/manual.pdf',
        'https://www.cms.gov/files/document/notice.docx',
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
        include_subdomains: false,
        sitemap_template_sample_cap: 3,
        sitemap_sample_stochastic: true,
        unique_page_focus: false,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    const { urls: queue } = await TargetDiscoveryEngine.discoverUrls(target);
    expect(queue).toEqual(['https://www.cms.gov/about-cms', 'https://www.cms.gov/medicare']);
  });

  it('records non-html exclusions discovered during sitemap filtering', async () => {
    fetchMock.mockResolvedValue({
      sites: [
        'https://www.cms.gov/about-cms',
        'https://www.cms.gov/files/document/manual.pdf',
        'https://www.cms.gov/files/document/notice.docx',
        'https://www.cms.gov/feed'
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
        include_subdomains: false,
        sitemap_template_sample_cap: 3,
        sitemap_sample_stochastic: true,
        unique_page_focus: false,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    const { } = await TargetDiscoveryEngine.discoverUrls(target);
    const exclusions = TargetDiscoveryEngine.consumeNonHtmlExclusions();

    expect(exclusions.length).toBe(3);
    expect(exclusions.some(entry => entry.url.endsWith('.pdf'))).toBe(true);
    expect(exclusions.some(entry => entry.url.endsWith('.docx'))).toBe(true);
    expect(exclusions.some(entry => entry.url.includes('/feed'))).toBe(true);
  });

  it('limits over-represented template patterns while keeping priority URLs first', async () => {
    fetchMock.mockResolvedValue({
      sites: [
        'https://www.cms.gov/newsroom/press-releases/2026-01-01/update-a',
        'https://www.cms.gov/newsroom/press-releases/2026-01-02/update-b',
        'https://www.cms.gov/newsroom/press-releases/2026-01-03/update-c',
        'https://www.cms.gov/newsroom/press-releases/2026-01-04/update-d',
        'https://www.cms.gov/medicare/index.html',
        'https://www.cms.gov/medicaid/index.html',
        'https://www.cms.gov/about-cms'
      ]
    });

    const target: TargetConfig = {
      id: 'cms-gov',
      name: 'CMS',
      base_url: 'https://www.cms.gov',
      sitemap_url: 'https://www.cms.gov/sitemap.xml',
      include_paths: ['/**'],
      priority_urls: ['https://www.cms.gov/contact-us'],
      settings: {
        postLoadDelay: 2000,
        max_pages: 6,
        maxTimeoutMs: 120000,
        include_subdomains: false,
        sitemap_template_sample_cap: 2,
        sitemap_sample_stochastic: true,
        unique_page_focus: false,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    const { urls: queue } = await TargetDiscoveryEngine.discoverUrls(target);
    expect(queue[0]).toBe('https://www.cms.gov/contact-us');
    expect(queue.length).toBe(6);

    const pressReleaseUrls = queue.filter(url => url.includes('/newsroom/press-releases/'));
    expect(pressReleaseUrls.length).toBeLessThanOrEqual(2);
  });

  it('rotates sampled sitemap groups when VITAL_SAMPLING_SEED changes', async () => {
    fetchMock.mockResolvedValue({
      sites: [
        'https://www.cms.gov/group-a/page-1',
        'https://www.cms.gov/group-b/page-1',
        'https://www.cms.gov/group-c/page-1',
        'https://www.cms.gov/group-d/page-1',
        'https://www.cms.gov/group-e/page-1',
        'https://www.cms.gov/group-f/page-1'
      ]
    });

    const target: TargetConfig = {
      id: 'cms-gov',
      name: 'CMS',
      base_url: 'https://www.cms.gov',
      sitemap_url: 'https://www.cms.gov/sitemap.xml',
      include_paths: ['/**'],
      priority_urls: [],
      settings: {
        postLoadDelay: 2000,
        max_pages: 3,
        maxTimeoutMs: 120000,
        include_subdomains: false,
        sitemap_template_sample_cap: 1,
        sitemap_sample_stochastic: true,
        unique_page_focus: false,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    process.env.VITAL_SAMPLING_SEED = 'seed-one';
    const { urls: queueOne } = await TargetDiscoveryEngine.discoverUrls(target);

    process.env.VITAL_SAMPLING_SEED = 'seed-two';
    const { urls: queueTwo } = await TargetDiscoveryEngine.discoverUrls(target);

    expect(queueOne).toHaveLength(3);
    expect(queueTwo).toHaveLength(3);
    expect(queueOne).not.toEqual(queueTwo);
  });

  it('supports unique-page focus by selecting one URL per template group first', async () => {
    fetchMock.mockResolvedValue({
      sites: [
        'https://www.cms.gov/newsroom/press-releases/2026-01-01/update-a',
        'https://www.cms.gov/newsroom/press-releases/2026-01-02/update-b',
        'https://www.cms.gov/newsroom/press-releases/2026-01-03/update-c',
        'https://www.cms.gov/medicare/coverage/page-1',
        'https://www.cms.gov/medicare/coverage/page-2',
        'https://www.cms.gov/about-cms',
        'https://www.cms.gov/contact-us'
      ]
    });

    const target: TargetConfig = {
      id: 'cms-gov',
      name: 'CMS',
      base_url: 'https://www.cms.gov',
      sitemap_url: 'https://www.cms.gov/sitemap.xml',
      include_paths: ['/**'],
      priority_urls: [],
      settings: {
        postLoadDelay: 2000,
        max_pages: 6,
        maxTimeoutMs: 120000,
        include_subdomains: false,
        sitemap_template_sample_cap: null,
        sitemap_sample_stochastic: false,
        unique_page_focus: true,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    const { urls: queue } = await TargetDiscoveryEngine.discoverUrls(target);
    const pressReleaseUrls = queue.filter(url => url.includes('/newsroom/press-releases/'));
    const coverageUrls = queue.filter(url => url.includes('/medicare/coverage/'));

    expect(pressReleaseUrls).toHaveLength(1);
    expect(coverageUrls).toHaveLength(1);
    expect(queue).toContain('https://www.cms.gov/about-cms');
    expect(queue).toContain('https://www.cms.gov/contact-us');
  });

  it('prioritizes URLs not previously scanned when filling sitemap sample slots', async () => {
    fetchMock.mockResolvedValue({
      sites: [
        'https://www.cms.gov/a/page-1',
        'https://www.cms.gov/a/page-2',
        'https://www.cms.gov/b/page-1',
        'https://www.cms.gov/b/page-2'
      ]
    });

    const target: TargetConfig = {
      id: 'cms-gov',
      name: 'CMS',
      base_url: 'https://www.cms.gov',
      sitemap_url: 'https://www.cms.gov/sitemap.xml',
      include_paths: ['/**'],
      priority_urls: [],
      settings: {
        postLoadDelay: 2000,
        max_pages: 2,
        maxTimeoutMs: 120000,
        include_subdomains: false,
        sitemap_template_sample_cap: 1,
        sitemap_sample_stochastic: false,
        unique_page_focus: false,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    const recentSuccess = new Date(Date.now() - 60 * 1000).toISOString();
    const urlManifest: UrlManifest = {
      'https://www.cms.gov/a/page-1': {
        url: 'https://www.cms.gov/a/page-1',
        discoveredAt: recentSuccess,
        lastAttemptedAt: recentSuccess,
        lastSuccessAt: recentSuccess,
        lastStatus: 'COMPLETED',
        consecutiveFailures: 0,
        cooldownUntil: null,
        contentHash: null
      },
      'https://www.cms.gov/b/page-1': {
        url: 'https://www.cms.gov/b/page-1',
        discoveredAt: recentSuccess,
        lastAttemptedAt: recentSuccess,
        lastSuccessAt: recentSuccess,
        lastStatus: 'COMPLETED',
        consecutiveFailures: 0,
        cooldownUntil: null,
        contentHash: null
      }
    };

    const { urls: queue } = await TargetDiscoveryEngine.discoverUrls(target, {
      previouslyScannedUrls: new Set([
        'https://www.cms.gov/a/page-1',
        'https://www.cms.gov/b/page-1'
      ]),
      urlManifest
    });

    expect(queue).toEqual([
      'https://www.cms.gov/a/page-2',
      'https://www.cms.gov/b/page-2'
    ]);
  });

  it('always includes priority URLs even when previously scanned', async () => {
    fetchMock.mockResolvedValue({
      sites: [
        'https://www.cms.gov/news/new-page',
        'https://www.cms.gov/news/old-page'
      ]
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
          estimatedIndexedPages: 500,
          topUrls: ['https://www.cms.gov/news/old-page']
        }
      ]
    });

    const target: TargetConfig = {
      id: 'cms-gov',
      name: 'CMS',
      base_url: 'https://www.cms.gov',
      sitemap_url: 'https://www.cms.gov/sitemap.xml',
      include_paths: ['/**'],
      priority_urls: ['https://www.cms.gov/news/old-page'],
      settings: {
        postLoadDelay: 2000,
        max_pages: 10,
        maxTimeoutMs: 120000,
        include_subdomains: false,
        sitemap_template_sample_cap: 3,
        sitemap_sample_stochastic: false,
        unique_page_focus: false,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    const { urls: queue } = await TargetDiscoveryEngine.discoverUrls(target, {
      pageState: {
        'https://www.cms.gov/news/old-page': {
          etag: null,
          lastModified: null,
          contentHash: null,
          assetFingerprintHash: null,
          lastCheckedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
          lastScannedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
        }
      }
    });

    expect(queue).toEqual([
      'https://www.cms.gov/news/old-page',
      'https://www.cms.gov/news/new-page'
    ]);
  });

  it('does not cap pages when max_pages and sitemap_template_sample_cap are null', async () => {
    fetchMock.mockResolvedValue({
      sites: [
        'https://www.cms.gov/a/page-1',
        'https://www.cms.gov/a/page-2',
        'https://www.cms.gov/b/page-1',
        'https://www.cms.gov/b/page-2',
        'https://www.cms.gov/c/page-1'
      ]
    });

    const target: TargetConfig = {
      id: 'cms-gov',
      name: 'CMS',
      base_url: 'https://www.cms.gov',
      sitemap_url: 'https://www.cms.gov/sitemap.xml',
      include_paths: ['/**'],
      priority_urls: [],
      settings: {
        postLoadDelay: 2000,
        max_pages: null,
        maxTimeoutMs: 120000,
        include_subdomains: false,
        sitemap_template_sample_cap: null,
        sitemap_sample_stochastic: false,
        unique_page_focus: false,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    const { urls: queue } = await TargetDiscoveryEngine.discoverUrls(target);
    expect(queue).toHaveLength(5);
  });

  it('always re-queues pages in pageState that were never successfully scanned', async () => {
    fetchMock.mockResolvedValue({
      sites: [
        'https://www.cms.gov/failed-page',
        'https://www.cms.gov/new-page'
      ]
    });

    const target: TargetConfig = {
      id: 'cms-gov',
      name: 'CMS',
      base_url: 'https://www.cms.gov',
      sitemap_url: 'https://www.cms.gov/sitemap.xml',
      include_paths: ['/**'],
      priority_urls: [],
      settings: {
        postLoadDelay: 2000,
        max_pages: null,
        maxTimeoutMs: 120000,
        include_subdomains: false,
        sitemap_template_sample_cap: null,
        sitemap_sample_stochastic: false,
        unique_page_focus: false,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    const now = Date.now();
    const pageState: PageStateMap = {
      'https://www.cms.gov/failed-page': {
        etag: null,
        lastModified: null,
        contentHash: null,
        assetFingerprintHash: null,
        lastCheckedAt: new Date(now - 30 * 60 * 1000).toISOString(),
        lastScannedAt: ''
      }
    };

    const { urls: queue } = await TargetDiscoveryEngine.discoverUrls(target, {
      pageState,
      skipPreviouslyScanned: true,
      revalidateAfterDays: 7
    });

    expect(queue).toContain('https://www.cms.gov/failed-page');
    expect(queue).toContain('https://www.cms.gov/new-page');
  });

  it('revalidates cached pages older than configured threshold', async () => {
    fetchMock.mockResolvedValue({
      sites: [
        'https://www.cms.gov/stale-page',
        'https://www.cms.gov/fresh-page'
      ]
    });

    const target: TargetConfig = {
      id: 'cms-gov',
      name: 'CMS',
      base_url: 'https://www.cms.gov',
      sitemap_url: 'https://www.cms.gov/sitemap.xml',
      include_paths: ['/**'],
      priority_urls: [],
      settings: {
        postLoadDelay: 2000,
        max_pages: null,
        maxTimeoutMs: 120000,
        include_subdomains: false,
        sitemap_template_sample_cap: null,
        sitemap_sample_stochastic: false,
        unique_page_focus: false,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    const now = Date.now();
    const pageState: PageStateMap = {
      'https://www.cms.gov/stale-page': {
        etag: null,
        lastModified: null,
        contentHash: null,
        assetFingerprintHash: null,
        lastCheckedAt: new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString(),
        lastScannedAt: new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString()
      },
      'https://www.cms.gov/fresh-page': {
        etag: null,
        lastModified: null,
        contentHash: null,
        assetFingerprintHash: null,
        lastCheckedAt: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),
        lastScannedAt: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString()
      }
    };

    const { urls: queue } = await TargetDiscoveryEngine.discoverUrls(target, {
      pageState,
      revalidateAfterDays: 7,
      skipPreviouslyScanned: true
    });

    expect(queue).toEqual(['https://www.cms.gov/stale-page']);
  });

  it('prioritizes pages updated in the last week before top seed URLs', async () => {
    fetchMock.mockResolvedValue({
      sites: [
        'https://www.cms.gov/updated-recently',
        'https://www.cms.gov/other-page'
      ]
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
          estimatedIndexedPages: 100,
          topUrls: ['https://www.cms.gov/top-task-seed']
        }
      ]
    });

    const target: TargetConfig = {
      id: 'cms-gov',
      name: 'CMS',
      base_url: 'https://www.cms.gov',
      sitemap_url: 'https://www.cms.gov/sitemap.xml',
      include_paths: ['/**'],
      priority_urls: [],
      settings: {
        postLoadDelay: 2000,
        max_pages: null,
        maxTimeoutMs: 120000,
        include_subdomains: false,
        sitemap_template_sample_cap: null,
        sitemap_sample_stochastic: false,
        unique_page_focus: false,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    const pageState: PageStateMap = {
      'https://www.cms.gov/updated-recently': {
        etag: null,
        lastModified: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        contentHash: null,
        assetFingerprintHash: null,
        lastCheckedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        lastScannedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
      }
    };

    const { urls: queue } = await TargetDiscoveryEngine.discoverUrls(target, {
      pageState,
      skipPreviouslyScanned: false,
      updatedWithinDays: 7
    });

    expect(queue[0]).toBe('https://www.cms.gov/updated-recently');
    expect(queue[1]).toBe('https://www.cms.gov/top-task-seed');
  });

  it('includes recently updated cached pages even when revalidation age is not met', async () => {
    fetchMock.mockResolvedValue({
      sites: [
        'https://www.cms.gov/updated-recently',
        'https://www.cms.gov/fresh-but-not-updated'
      ]
    });

    const target: TargetConfig = {
      id: 'cms-gov',
      name: 'CMS',
      base_url: 'https://www.cms.gov',
      sitemap_url: 'https://www.cms.gov/sitemap.xml',
      include_paths: ['/**'],
      priority_urls: [],
      settings: {
        postLoadDelay: 2000,
        max_pages: null,
        maxTimeoutMs: 120000,
        include_subdomains: false,
        sitemap_template_sample_cap: null,
        sitemap_sample_stochastic: false,
        unique_page_focus: false,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    const now = Date.now();
    const pageState: PageStateMap = {
      'https://www.cms.gov/updated-recently': {
        etag: null,
        lastModified: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        contentHash: null,
        assetFingerprintHash: null,
        lastCheckedAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        lastScannedAt: new Date(now - 24 * 60 * 60 * 1000).toISOString()
      },
      'https://www.cms.gov/fresh-but-not-updated': {
        etag: null,
        lastModified: new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString(),
        contentHash: null,
        assetFingerprintHash: null,
        lastCheckedAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        lastScannedAt: new Date(now - 24 * 60 * 60 * 1000).toISOString()
      }
    };

    const { urls: queue } = await TargetDiscoveryEngine.discoverUrls(target, {
      pageState,
      skipPreviouslyScanned: true,
      revalidateAfterDays: 7,
      updatedWithinDays: 7
    });

    expect(queue).toContain('https://www.cms.gov/updated-recently');
    expect(queue).not.toContain('https://www.cms.gov/fresh-but-not-updated');
  });

  it('does not requeue a page whose lastCheckedAt is stale but lastScannedAt is recent', async () => {
    fetchMock.mockResolvedValue({
      sites: [
        'https://www.cms.gov/recently-scanned',
        'https://www.cms.gov/truly-stale'
      ]
    });

    const target: TargetConfig = {
      id: 'cms-gov',
      name: 'CMS',
      base_url: 'https://www.cms.gov',
      sitemap_url: 'https://www.cms.gov/sitemap.xml',
      include_paths: ['/**'],
      priority_urls: [],
      settings: {
        postLoadDelay: 2000,
        max_pages: null,
        maxTimeoutMs: 120000,
        include_subdomains: false,
        sitemap_template_sample_cap: null,
        sitemap_sample_stochastic: false,
        unique_page_focus: false,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    const now = Date.now();
    const pageState: PageStateMap = {
      // lastCheckedAt is stale (9 days), but lastScannedAt is very recent (1 day).
      // The page should NOT be re-queued because it was scanned recently.
      'https://www.cms.gov/recently-scanned': {
        etag: '"abc"',
        lastModified: null,
        contentHash: null,
        assetFingerprintHash: null,
        lastCheckedAt: new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString(),
        lastScannedAt: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString()
      },
      // Both dates are 9 days old — genuinely due for revalidation.
      'https://www.cms.gov/truly-stale': {
        etag: null,
        lastModified: null,
        contentHash: null,
        assetFingerprintHash: null,
        lastCheckedAt: new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString(),
        lastScannedAt: new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString()
      }
    };

    const { urls: queue } = await TargetDiscoveryEngine.discoverUrls(target, {
      pageState,
      skipPreviouslyScanned: true,
      revalidateAfterDays: 7
    });

    expect(queue).not.toContain('https://www.cms.gov/recently-scanned');
    expect(queue).toContain('https://www.cms.gov/truly-stale');
  });

  it('does not repeatedly requeue recently updated pages before cooldown elapses', async () => {
    fetchMock.mockResolvedValue({
      sites: [
        'https://www.cms.gov/updated-recently',
        'https://www.cms.gov/new-never-scanned'
      ]
    });

    const target: TargetConfig = {
      id: 'cms-gov',
      name: 'CMS',
      base_url: 'https://www.cms.gov',
      sitemap_url: 'https://www.cms.gov/sitemap.xml',
      include_paths: ['/**'],
      priority_urls: [],
      settings: {
        postLoadDelay: 2000,
        max_pages: null,
        maxTimeoutMs: 120000,
        include_subdomains: false,
        sitemap_template_sample_cap: null,
        sitemap_sample_stochastic: false,
        unique_page_focus: false,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    const now = Date.now();
    const pageState: PageStateMap = {
      'https://www.cms.gov/updated-recently': {
        etag: null,
        lastModified: new Date(now - 6 * 60 * 60 * 1000).toISOString(),
        contentHash: null,
        assetFingerprintHash: null,
        lastCheckedAt: new Date(now - 30 * 60 * 1000).toISOString(),
        lastScannedAt: new Date(now - 30 * 60 * 1000).toISOString()
      }
    };

    const { urls: queue } = await TargetDiscoveryEngine.discoverUrls(target, {
      pageState,
      skipPreviouslyScanned: true,
      revalidateAfterDays: 7,
      updatedWithinDays: 7,
      updatedRecheckHours: 8
    });

    expect(queue).toContain('https://www.cms.gov/new-never-scanned');
    expect(queue).not.toContain('https://www.cms.gov/updated-recently');
  });

  it('orders never-scanned URLs (no manifest entry) before null-lastSuccessAt before oldest-success URLs', async () => {
    fetchMock.mockResolvedValue({
      sites: [
        'https://www.cms.gov/a/1',
        'https://www.cms.gov/a/2',
        'https://www.cms.gov/a/3'
      ]
    });

    const target: TargetConfig = {
      id: 'cms-gov',
      name: 'CMS',
      base_url: 'https://www.cms.gov',
      sitemap_url: 'https://www.cms.gov/sitemap.xml',
      include_paths: ['/**'],
      priority_urls: [],
      settings: {
        postLoadDelay: 2000,
        max_pages: null,
        maxTimeoutMs: 120000,
        include_subdomains: false,
        sitemap_template_sample_cap: null,
        sitemap_sample_stochastic: false,
        unique_page_focus: false,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    const recentTs = new Date(Date.now() - 60 * 1000).toISOString();
    // /a/1 has a recent success (tier d), /a/2 has null lastSuccessAt (tier b),
    // /a/3 has no manifest entry (tier a) → expected order: /a/3, /a/2, /a/1
    const urlManifest: UrlManifest = {
      'https://www.cms.gov/a/1': {
        url: 'https://www.cms.gov/a/1',
        discoveredAt: recentTs,
        lastAttemptedAt: recentTs,
        lastSuccessAt: recentTs,
        lastStatus: 'COMPLETED',
        consecutiveFailures: 0,
        cooldownUntil: null,
        contentHash: null
      },
      'https://www.cms.gov/a/2': {
        url: 'https://www.cms.gov/a/2',
        discoveredAt: recentTs,
        lastAttemptedAt: recentTs,
        lastSuccessAt: null,
        lastStatus: 'FAILED',
        consecutiveFailures: 1,
        cooldownUntil: null,
        contentHash: null
      }
      // /a/3 intentionally absent from manifest (tier a)
    };

    const { urls: queue } = await TargetDiscoveryEngine.discoverUrls(target, {
      urlManifest,
      skipPreviouslyScanned: false
    });

    const noEntryIdx = queue.indexOf('https://www.cms.gov/a/3');
    const nullSuccessIdx = queue.indexOf('https://www.cms.gov/a/2');
    const hasSuccessIdx = queue.indexOf('https://www.cms.gov/a/1');

    expect(noEntryIdx).toBeGreaterThanOrEqual(0);
    expect(nullSuccessIdx).toBeGreaterThanOrEqual(0);
    expect(hasSuccessIdx).toBeGreaterThanOrEqual(0);
    expect(noEntryIdx).toBeLessThan(nullSuccessIdx);
    expect(nullSuccessIdx).toBeLessThan(hasSuccessIdx);
  });

  it('orders oldest-succeeded URLs before most-recently-succeeded within the same template group', async () => {
    fetchMock.mockResolvedValue({
      sites: [
        'https://www.cms.gov/a/1',
        'https://www.cms.gov/a/2'
      ]
    });

    const target: TargetConfig = {
      id: 'cms-gov',
      name: 'CMS',
      base_url: 'https://www.cms.gov',
      sitemap_url: 'https://www.cms.gov/sitemap.xml',
      include_paths: ['/**'],
      priority_urls: [],
      settings: {
        postLoadDelay: 2000,
        max_pages: null,
        maxTimeoutMs: 120000,
        include_subdomains: false,
        sitemap_template_sample_cap: null,
        sitemap_sample_stochastic: false,
        unique_page_focus: false,
        throttle_profile: null,
        daily_page_budget: null
      }
    };

    const oldSuccess = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const recentSuccess = new Date(Date.now() - 60 * 1000).toISOString();
    // /a/1 succeeded recently, /a/2 succeeded long ago → expected order: /a/2, /a/1
    const urlManifest: UrlManifest = {
      'https://www.cms.gov/a/1': {
        url: 'https://www.cms.gov/a/1',
        discoveredAt: recentSuccess,
        lastAttemptedAt: recentSuccess,
        lastSuccessAt: recentSuccess,
        lastStatus: 'COMPLETED',
        consecutiveFailures: 0,
        cooldownUntil: null,
        contentHash: null
      },
      'https://www.cms.gov/a/2': {
        url: 'https://www.cms.gov/a/2',
        discoveredAt: oldSuccess,
        lastAttemptedAt: oldSuccess,
        lastSuccessAt: oldSuccess,
        lastStatus: 'COMPLETED',
        consecutiveFailures: 0,
        cooldownUntil: null,
        contentHash: null
      }
    };

    const { urls: queue } = await TargetDiscoveryEngine.discoverUrls(target, {
      urlManifest,
      skipPreviouslyScanned: false
    });

    expect(queue.indexOf('https://www.cms.gov/a/2')).toBeLessThan(
      queue.indexOf('https://www.cms.gov/a/1')
    );
  });
});
