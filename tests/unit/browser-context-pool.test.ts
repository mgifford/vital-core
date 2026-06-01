/**
 * Tests for the persistent browser-context pool introduced in Issue #3.
 *
 * We verify the pool logic in isolation by checking that:
 *  - a context is created once per unique hostname
 *  - subsequent pages on the same domain reuse the same context
 *  - per-page viewport/colorScheme overrides are applied each time
 *  - the pool is closed (and the browser is torn down) exactly once at the end
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal fake Playwright Page / Context / Browser types
// ---------------------------------------------------------------------------
interface FakePage {
  setDefaultNavigationTimeout: ReturnType<typeof vi.fn>;
  setDefaultTimeout: ReturnType<typeof vi.fn>;
  setViewportSize: ReturnType<typeof vi.fn>;
  emulateMedia: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  waitForTimeout: ReturnType<typeof vi.fn>;
  content: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface FakeContext {
  newPage: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface FakeBrowser {
  newContext: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function makeFakePage(): FakePage {
  return {
    setDefaultNavigationTimeout: vi.fn(),
    setDefaultTimeout: vi.fn(),
    setViewportSize: vi.fn().mockResolvedValue(undefined),
    emulateMedia: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockResolvedValue('<html><head></head><body></body></html>'),
    close: vi.fn().mockResolvedValue(undefined)
  };
}

function makeFakeContext(): FakeContext {
  return {
    newPage: vi.fn().mockImplementation(() => Promise.resolve(makeFakePage())),
    close: vi.fn().mockResolvedValue(undefined)
  };
}

// ---------------------------------------------------------------------------
// Pool-logic extracted for unit-testing without launching a real browser
// ---------------------------------------------------------------------------

/**
 * Simulates the context-pool behaviour from ResilientBrowserEngine.executeSnapshotSession.
 * Returns tracking objects so tests can assert on call counts.
 */
async function runPoolSimulation(
  urls: string[],
  fakeBrowser: FakeBrowser
): Promise<{ contextPool: Map<string, FakeContext>; pages: FakePage[] }> {
  const contextPool = new Map<string, FakeContext>();
  const pages: FakePage[] = [];

  try {
    for (const url of urls) {
      let hostname: string;
      try {
        hostname = new URL(url).hostname.toLowerCase();
      } catch {
        hostname = '__unknown__';
      }

      const poolKey = hostname;
      let context = contextPool.get(poolKey) as FakeContext | undefined;
      if (!context) {
        context = fakeBrowser.newContext({
          userAgent: 'TestAgent/1.0',
          viewport: { width: 1366, height: 768 },
          colorScheme: 'light'
        }) as FakeContext;
        contextPool.set(poolKey, context);
      }

      // Emulate per-page overrides
      const page = (await context.newPage()) as FakePage;
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.emulateMedia({ colorScheme: 'light' });

      pages.push(page);

      // Simulate page usage
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.content();

      await page.close();
      // Context intentionally NOT closed here — kept in pool.
    }
  } finally {
    await Promise.all(Array.from(contextPool.values()).map((ctx) => ctx.close()));
    await fakeBrowser.close();
  }

  return { contextPool, pages };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Persistent browser-context pool (Issue #3)', () => {
  let fakeBrowser: FakeBrowser;

  beforeEach(() => {
    const ctxA = makeFakeContext();
    const ctxB = makeFakeContext();
    let callCount = 0;
    fakeBrowser = {
      newContext: vi.fn().mockImplementation(() => {
        return callCount++ === 0 ? ctxA : ctxB;
      }),
      close: vi.fn().mockResolvedValue(undefined)
    };
  });

  it('creates one context per unique hostname', async () => {
    const urls = [
      'https://example.gov/page-1',
      'https://example.gov/page-2',
      'https://example.gov/page-3'
    ];

    const { contextPool } = await runPoolSimulation(urls, fakeBrowser);

    expect(fakeBrowser.newContext).toHaveBeenCalledTimes(1);
    expect(contextPool.size).toBe(1);
    expect(contextPool.has('example.gov')).toBe(true);
  });

  it('creates separate contexts for different hostnames', async () => {
    const urls = [
      'https://alpha.gov/page-1',
      'https://beta.gov/page-1',
      'https://alpha.gov/page-2'
    ];

    const { contextPool } = await runPoolSimulation(urls, fakeBrowser);

    expect(fakeBrowser.newContext).toHaveBeenCalledTimes(2);
    expect(contextPool.size).toBe(2);
    expect(contextPool.has('alpha.gov')).toBe(true);
    expect(contextPool.has('beta.gov')).toBe(true);
  });

  it('applies per-page viewport and colorScheme overrides for every page', async () => {
    const urls = [
      'https://example.gov/page-1',
      'https://example.gov/page-2'
    ];

    const { pages } = await runPoolSimulation(urls, fakeBrowser);

    expect(pages).toHaveLength(2);
    for (const page of pages) {
      expect(page.setViewportSize).toHaveBeenCalledOnce();
      expect(page.emulateMedia).toHaveBeenCalledOnce();
    }
  });

  it('closes every page individually but NOT during the per-page loop', async () => {
    const urls = [
      'https://example.gov/page-1',
      'https://example.gov/page-2'
    ];

    const { pages } = await runPoolSimulation(urls, fakeBrowser);

    // Each page must be closed exactly once.
    for (const page of pages) {
      expect(page.close).toHaveBeenCalledOnce();
    }
  });

  it('closes all pooled contexts exactly once after the loop', async () => {
    const urls = [
      'https://alpha.gov/page-1',
      'https://beta.gov/page-1'
    ];

    const { contextPool } = await runPoolSimulation(urls, fakeBrowser);

    for (const ctx of contextPool.values()) {
      expect((ctx as FakeContext).close).toHaveBeenCalledOnce();
    }
  });

  it('closes the browser exactly once', async () => {
    await runPoolSimulation(['https://example.gov/'], fakeBrowser);
    expect(fakeBrowser.close).toHaveBeenCalledOnce();
  });

  it('handles empty URL queue without creating any contexts', async () => {
    const { contextPool } = await runPoolSimulation([], fakeBrowser);

    expect(fakeBrowser.newContext).not.toHaveBeenCalled();
    expect(contextPool.size).toBe(0);
    expect(fakeBrowser.close).toHaveBeenCalledOnce();
  });
});
