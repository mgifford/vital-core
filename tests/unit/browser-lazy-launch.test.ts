import { describe, expect, it, vi, afterEach } from 'vitest';
import { ResilientBrowserEngine } from '../../src/engine/browser';

const STUB_TARGET = {
  id: 'test-target',
  name: 'Test Target',
  base_url: 'https://example.gov',
  include_paths: [],
  priority_urls: [],
  settings: {
    postLoadDelay: 0,
    max_pages: null,
    maxTimeoutMs: 30000,
    include_subdomains: false,
    sitemap_template_sample_cap: null,
    sitemap_sample_stochastic: true,
    unique_page_focus: false,
    throttle_profile: null,
    daily_page_budget: null
  }
};

describe('ResilientBrowserEngine lazy browser launch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not launch a browser when all queued URLs are unchanged', async () => {
    // Prevent real Chrome process from being spawned during the test
    const { LighthouseWorker } = await import('../../src/engine/workers/lighthouse-worker');
    vi.spyOn(LighthouseWorker, 'launchChrome').mockResolvedValue(undefined);
    vi.spyOn(LighthouseWorker, 'killChrome').mockResolvedValue(undefined);

    // Stub probePageChange to report all pages unchanged
    vi.spyOn(ResilientBrowserEngine as any, 'probePageChange').mockResolvedValue({
      unchanged: true,
      reason: 'Skipped unchanged page based on matching ETag.',
      etag: '"abc123"',
      lastModified: null,
      contentHash: null,
      assetFingerprintHash: null
    });

    const launchSpy = vi.spyOn(ResilientBrowserEngine as any, 'launchBrowser');

    const pageState = {
      'https://example.gov/page-1': {
        etag: '"abc123"',
        lastModified: null,
        contentHash: null,
        assetFingerprintHash: null,
        lastCheckedAt: new Date().toISOString(),
        lastScannedAt: new Date().toISOString()
      },
      'https://example.gov/page-2': {
        etag: '"abc123"',
        lastModified: null,
        contentHash: null,
        assetFingerprintHash: null,
        lastCheckedAt: new Date().toISOString(),
        lastScannedAt: new Date().toISOString()
      }
    };

    const { reports: results } = await ResilientBrowserEngine.executeSnapshotSession(
      STUB_TARGET,
      ['https://example.gov/page-1', 'https://example.gov/page-2'],
      { pageState }
    );

    expect(launchSpy).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
    expect(results.every(r => r.status === 'SKIPPED_UNCHANGED')).toBe(true);
  });

  it('launches a browser only once when at least one URL needs scanning', async () => {
    // First page unchanged, second page needs scanning
    vi.spyOn(ResilientBrowserEngine as any, 'probePageChange')
      .mockResolvedValueOnce({
        unchanged: true,
        reason: 'Skipped unchanged page based on matching ETag.',
        etag: '"abc123"',
        lastModified: null,
        contentHash: null,
        assetFingerprintHash: null
      })
      .mockResolvedValueOnce({
        unchanged: false,
        reason: 'Page appears changed or no prior state available.',
        etag: '"newetag"',
        lastModified: null,
        contentHash: null,
        assetFingerprintHash: null
      });

    const mockPage = {
      setDefaultNavigationTimeout: vi.fn(),
      setDefaultTimeout: vi.fn(),
      setViewportSize: vi.fn().mockResolvedValue(undefined),
      emulateMedia: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue('<html><body>Hello</body></html>'),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const mockContext = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      close: vi.fn().mockResolvedValue(undefined)
    };
    const mockBrowser = {
      newContext: vi.fn().mockResolvedValue(mockContext),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const launchSpy = vi.spyOn(ResilientBrowserEngine as any, 'launchBrowser')
      .mockResolvedValue(mockBrowser);

    // Stub out the worker methods that require real browser/network connections
    vi.spyOn(ResilientBrowserEngine as any, 'runWithTimeout').mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (fn: () => Promise<unknown>) => fn()) as any
    );

    const { LiveWorker } = await import('../../src/engine/workers/live-worker');
    vi.spyOn(LiveWorker, 'runLiveAudits').mockResolvedValue({
      lighthouse: null,
      accessibilityViolations: []
    });

    const { AlfaWorker } = await import('../../src/engine/workers/alfa-worker');
    vi.spyOn(AlfaWorker, 'runAlfaAudits').mockResolvedValue({
      executed: false,
      findingsCount: null,
      rawResults: null,
      errorMessage: 'skipped in test'
    });

    const { TechnologyWorker } = await import('../../src/engine/workers/technology-worker');
    vi.spyOn(TechnologyWorker, 'detectTechnologyStack').mockResolvedValue([]);

    const { OfflineWorker } = await import('../../src/engine/workers/offline-worker');
    vi.spyOn(OfflineWorker, 'processSnapshot').mockReturnValue({
      overlayDetected: { found: false, provider: null, evidence: null },
      designSystem: { usesUSWDS: false, versionDetected: null },
      contentMetrics: { readabilityScore: 100, suspiciousAltTextCount: 0, suspiciousAltInstances: [] },
      linkHealth: { totalChecked: 0, brokenCount: 0, brokenLinks: [] }
    });

    const { ThirdPartyImpactWorker } = await import('../../src/engine/workers/third-party-impact-worker');
    vi.spyOn(ThirdPartyImpactWorker, 'evaluate').mockResolvedValue(null as any);

    const { LighthouseWorker } = await import('../../src/engine/workers/lighthouse-worker');
    vi.spyOn(LighthouseWorker, 'auditLiveUrl').mockResolvedValue(null as any);
    vi.spyOn(LighthouseWorker, 'launchChrome').mockResolvedValue(undefined);
    vi.spyOn(LighthouseWorker, 'killChrome').mockResolvedValue(undefined);

    const pageState = {
      'https://example.gov/page-1': {
        etag: '"abc123"',
        lastModified: null,
        contentHash: null,
        assetFingerprintHash: null,
        lastCheckedAt: new Date().toISOString(),
        lastScannedAt: new Date().toISOString()
      }
    };

    const { reports: results } = await ResilientBrowserEngine.executeSnapshotSession(
      STUB_TARGET,
      ['https://example.gov/page-1', 'https://example.gov/page-2'],
      { pageState }
    );

    // Browser is launched exactly once (not before the first unchanged page)
    expect(launchSpy).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('SKIPPED_UNCHANGED');
    expect(results[1].status).toBe('COMPLETED');
    // Browser is closed after the session
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it('does not attempt to close browser when none was launched', async () => {
    const { LighthouseWorker } = await import('../../src/engine/workers/lighthouse-worker');
    vi.spyOn(LighthouseWorker, 'launchChrome').mockResolvedValue(undefined);
    vi.spyOn(LighthouseWorker, 'killChrome').mockResolvedValue(undefined);

    vi.spyOn(ResilientBrowserEngine as any, 'probePageChange').mockResolvedValue({
      unchanged: true,
      reason: 'Skipped unchanged page based on matching ETag.',
      etag: '"abc123"',
      lastModified: null,
      contentHash: null,
      assetFingerprintHash: null
    });

    // If launchBrowser were called, it would throw and cause the test to fail
    const launchSpy = vi.spyOn(ResilientBrowserEngine as any, 'launchBrowser')
      .mockRejectedValue(new Error('launchBrowser should not have been called'));

    const pageState = {
      'https://example.gov/': {
        etag: '"abc123"',
        lastModified: null,
        contentHash: null,
        assetFingerprintHash: null,
        lastCheckedAt: new Date().toISOString(),
        lastScannedAt: new Date().toISOString()
      }
    };

    await expect(
      ResilientBrowserEngine.executeSnapshotSession(
        STUB_TARGET,
        ['https://example.gov/'],
        { pageState }
      )
    ).resolves.not.toThrow();

    expect(launchSpy).not.toHaveBeenCalled();
  });

  it('applies timeout backoff before the first request when a timeout streak is carried into the batch', async () => {
    const { LighthouseWorker } = await import('../../src/engine/workers/lighthouse-worker');
    vi.spyOn(LighthouseWorker, 'launchChrome').mockResolvedValue(undefined);
    vi.spyOn(LighthouseWorker, 'killChrome').mockResolvedValue(undefined);

    vi.spyOn(ResilientBrowserEngine as any, 'probePageChange').mockResolvedValue({
      unchanged: true,
      reason: 'Skipped unchanged page based on matching ETag.',
      etag: '"abc123"',
      lastModified: null,
      contentHash: null,
      assetFingerprintHash: null
    });

    const sleepSpy = vi.spyOn(ResilientBrowserEngine as any, 'sleep').mockResolvedValue(undefined);

    const { reports: results } = await ResilientBrowserEngine.executeSnapshotSession(
      STUB_TARGET,
      ['https://example.gov/page-1'],
      { initialTimeoutStreak: 2 }
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('SKIPPED_UNCHANGED');
    expect(sleepSpy).toHaveBeenCalledTimes(1);
    expect(sleepSpy).toHaveBeenCalledWith(10000);
  });
});

describe('ResilientBrowserEngine.runWithTimeout', () => {
  const callRunWithTimeout = (operation: () => Promise<unknown>, timeoutMs: number) =>
    (ResilientBrowserEngine as any).runWithTimeout(operation, timeoutMs);

  it('resolves with the operation result when it completes before the timeout', async () => {
    const result = await callRunWithTimeout(() => Promise.resolve(42), 5000);
    expect(result).toBe(42);
  });

  it('rejects with a timeout error when the operation exceeds the limit', async () => {
    const neverResolves = new Promise(() => {/* intentionally pending */});
    await expect(callRunWithTimeout(() => neverResolves, 50)).rejects.toThrow('timeout after 50ms');
  });

  it('does not produce an unhandled rejection when an abandoned operation rejects late', async () => {
    // Track any unhandledRejection events emitted during this test.
    const unhandled: unknown[] = [];
    const handler = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', handler);

    let rejectLate!: (err: Error) => void;
    const slowOp = new Promise<never>((_, reject) => {
      rejectLate = reject;
    });

    // runWithTimeout fires first (tiny limit); the slow operation is abandoned.
    await expect(callRunWithTimeout(() => slowOp, 20)).rejects.toThrow('timeout after 20ms');

    // Now reject the abandoned promise (simulates Lighthouse's checkForQuiet
    // failing after Chrome is killed).
    rejectLate(new Error('Protocol error: Session closed'));

    // Wait a tick so any unhandled-rejection bookkeeping can run.
    await new Promise(resolve => setTimeout(resolve, 10));

    process.removeListener('unhandledRejection', handler);
    expect(unhandled).toHaveLength(0);
  });
});
