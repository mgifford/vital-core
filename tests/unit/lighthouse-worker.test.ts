import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { LighthouseWorker } from '../../src/engine/workers/lighthouse-worker';

// Helpers to build a minimal fake ChromeHandle
const makeFakeChrome = (port = 9222) => ({
  port,
  kill: vi.fn().mockResolvedValue(undefined)
});

describe('LighthouseWorker – persistent Chrome lifecycle', () => {
  let fakeChrome: ReturnType<typeof makeFakeChrome>;
  let mockLaunch: ReturnType<typeof vi.fn>;
  let mockLighthouse: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Reset persistent state between tests by killing any leftover instance
    await LighthouseWorker.killChrome();

    fakeChrome = makeFakeChrome();
    mockLaunch = vi.fn().mockResolvedValue(fakeChrome);
    mockLighthouse = vi.fn().mockResolvedValue({ lhr: { categories: {}, audits: {} } });

    vi.doMock('chrome-launcher', () => ({ launch: mockLaunch }));
    vi.doMock('lighthouse', () => ({ default: mockLighthouse }));
  });

  afterEach(async () => {
    await LighthouseWorker.killChrome();
    vi.restoreAllMocks();
  });

  it('launchChrome starts a Chrome instance and caches it', async () => {
    // Replace the dynamic import path used by LighthouseWorker
    const chromeLauncherModule = await import('chrome-launcher');
    vi.spyOn(chromeLauncherModule, 'launch').mockResolvedValue(fakeChrome as any);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await LighthouseWorker.launchChrome();

    expect(chromeLauncherModule.launch).toHaveBeenCalledWith({
      chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox']
    });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Persistent Lighthouse Chrome launched'));
  });

  it('launchChrome is idempotent – calling it twice does not launch a second Chrome', async () => {
    const chromeLauncherModule = await import('chrome-launcher');
    const launchSpy = vi.spyOn(chromeLauncherModule, 'launch').mockResolvedValue(fakeChrome as any);

    // Stub fetch so the liveness check reports Chrome as alive on the second call.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    await LighthouseWorker.launchChrome();
    await LighthouseWorker.launchChrome();

    expect(launchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockRestore();
  });

  it('killChrome kills the cached instance and resets state', async () => {
    const chromeLauncherModule = await import('chrome-launcher');
    vi.spyOn(chromeLauncherModule, 'launch').mockResolvedValue(fakeChrome as any);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await LighthouseWorker.launchChrome();
    await LighthouseWorker.killChrome();

    expect(fakeChrome.kill).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Persistent Lighthouse Chrome terminated'));
  });

  it('killChrome is a no-op when no Chrome is running', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    // No Chrome launched – should not throw
    await expect(LighthouseWorker.killChrome()).resolves.toBeUndefined();
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('terminated'));
  });

  it('auditLiveUrl uses the persistent Chrome and does not kill it afterwards', async () => {
    const chromeLauncherModule = await import('chrome-launcher');
    const launchSpy = vi.spyOn(chromeLauncherModule, 'launch').mockResolvedValue(fakeChrome as any);

    const lighthouseModule = await import('lighthouse');
    vi.spyOn(lighthouseModule, 'default').mockResolvedValue({ lhr: { categories: {}, audits: {} } } as any);

    // Pre-launch the persistent Chrome
    await LighthouseWorker.launchChrome();
    const launchCountAfterPreLaunch = launchSpy.mock.calls.length;

    await LighthouseWorker.auditLiveUrl('https://example.com', 30000);

    // No additional Chrome should have been launched
    expect(launchSpy.mock.calls.length).toBe(launchCountAfterPreLaunch);
    // The persistent Chrome must NOT have been killed by auditLiveUrl
    expect(fakeChrome.kill).not.toHaveBeenCalled();
  });

  it('auditLiveUrl launches a temporary Chrome when no persistent instance exists', async () => {
    const chromeLauncherModule = await import('chrome-launcher');
    const launchSpy = vi.spyOn(chromeLauncherModule, 'launch').mockResolvedValue(fakeChrome as any);

    const lighthouseModule = await import('lighthouse');
    vi.spyOn(lighthouseModule, 'default').mockResolvedValue({ lhr: { categories: {}, audits: {} } } as any);

    // No pre-launch
    await LighthouseWorker.auditLiveUrl('https://example.com', 30000);

    // A temporary Chrome should have been launched …
    expect(launchSpy).toHaveBeenCalledTimes(1);
    // … and then killed at the end of the call
    expect(fakeChrome.kill).toHaveBeenCalledTimes(1);
    expect(mockLighthouse).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo']
      })
    );
  });

  it('auditLiveUrl can opt into agentic browsing when explicitly enabled', async () => {
    const chromeLauncherModule = await import('chrome-launcher');
    vi.spyOn(chromeLauncherModule, 'launch').mockResolvedValue(fakeChrome as any);

    const lighthouseModule = await import('lighthouse');
    vi.spyOn(lighthouseModule, 'default').mockResolvedValue({ lhr: { categories: {}, audits: {} } } as any);

    const originalFlag = process.env.VITAL_ENABLE_AGENTIC_BROWSING;
    process.env.VITAL_ENABLE_AGENTIC_BROWSING = 'true';

    try {
      await LighthouseWorker.auditLiveUrl('https://example.com', 30000);

      expect(mockLighthouse).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo', 'agentic-browsing']
        })
      );
    } finally {
      process.env.VITAL_ENABLE_AGENTIC_BROWSING = originalFlag;
    }
  });

  it('auditLiveUrl returns null scores on failure without crashing', async () => {
    const lighthouseModule = await import('lighthouse');
    vi.spyOn(lighthouseModule, 'default').mockRejectedValue(new Error('Lighthouse exploded'));

    const chromeLauncherModule = await import('chrome-launcher');
    vi.spyOn(chromeLauncherModule, 'launch').mockResolvedValue(fakeChrome as any);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await LighthouseWorker.auditLiveUrl('https://example.com', 30000);

    expect(result.performanceScore).toBeNull();
    expect(result.accessibilityScore).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Lighthouse audit failed'));
  });

  it('launchChrome relaunches when the cached Chrome is unresponsive', async () => {
    const chromeLauncherModule = await import('chrome-launcher');
    const launchSpy = vi.spyOn(chromeLauncherModule, 'launch').mockResolvedValue(fakeChrome as any);

    // Stub fetch so the liveness check reports the first Chrome as dead
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Manually seed a stale handle so persistentChrome is non-null
    await LighthouseWorker.launchChrome();
    const firstLaunchCount = launchSpy.mock.calls.length;

    // Second call: liveness check fails → should discard the old handle and relaunch
    await LighthouseWorker.launchChrome();

    expect(launchSpy.mock.calls.length).toBeGreaterThan(firstLaunchCount);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unresponsive'));

    fetchSpy.mockRestore();
  });

  it('launchChrome does not relaunch when the cached Chrome is responsive', async () => {
    const chromeLauncherModule = await import('chrome-launcher');
    const launchSpy = vi.spyOn(chromeLauncherModule, 'launch').mockResolvedValue(fakeChrome as any);

    // Stub fetch so the liveness check reports Chrome as alive
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    await LighthouseWorker.launchChrome();
    const countAfterFirst = launchSpy.mock.calls.length;

    // Second call: liveness check succeeds → should be a no-op
    await LighthouseWorker.launchChrome();

    expect(launchSpy.mock.calls.length).toBe(countAfterFirst);

    fetchSpy.mockRestore();
  });
});
