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

    await LighthouseWorker.launchChrome();
    await LighthouseWorker.launchChrome();

    expect(launchSpy).toHaveBeenCalledTimes(1);
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
});
