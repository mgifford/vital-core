import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ResilientBrowserEngine } from '../../src/engine/browser';
import type { PageStateEntry } from '../../src/engine/reporters/page-state-cache';

// Access private static methods via type-cast for unit testing purposes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const engine = ResilientBrowserEngine as any;

const SAMPLE_HTML = '<html><body><h1>Hello</h1></body></html>';
const CHANGED_HTML = '<html><body><h1>Goodbye</h1></body></html>';

function makeState(overrides: Partial<PageStateEntry> = {}): PageStateEntry {
  return {
    etag: null,
    lastModified: null,
    contentHash: engine.hashContent(SAMPLE_HTML),
    assetFingerprintHash: engine.computeAssetFingerprint(SAMPLE_HTML, 'https://example.gov/'),
    lastCheckedAt: '2024-01-01T00:00:00.000Z',
    lastScannedAt: '2024-01-01T00:00:00.000Z',
    ...overrides
  };
}

function makeFetchMock(options: {
  headEtag?: string | null;
  headLastModified?: string | null;
  headStatus?: number;
  getBody?: string;
  getStatus?: number;
  failGet?: boolean;
}) {
  return vi.fn().mockImplementation(async (url: string, init: { method: string }) => {
    const method = (init?.method || 'GET').toUpperCase();

    if (method === 'HEAD') {
      if (options.headStatus && options.headStatus >= 400) {
        const resp = { ok: false, status: options.headStatus, headers: new Headers() };
        return resp;
      }
      const headers = new Headers();
      if (options.headEtag) headers.set('etag', options.headEtag);
      if (options.headLastModified) headers.set('last-modified', options.headLastModified);
      return { ok: true, status: 200, headers };
    }

    // GET
    if (options.failGet) {
      throw new Error('Network error on GET');
    }
    const body = options.getBody ?? SAMPLE_HTML;
    const headers = new Headers();
    return {
      ok: true,
      status: options.getStatus ?? 200,
      headers,
      text: async () => body
    };
  });
}

describe('ResilientBrowserEngine.probePageChange — fetchedHtml field', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('populates fetchedHtml when a GET detects a changed page (no ETag/Last-Modified)', async () => {
    // Arrange: previous state has the old hash; server now returns new HTML.
    const previousState = makeState();
    global.fetch = makeFetchMock({ getBody: CHANGED_HTML });

    // Act
    const result = await engine.probePageChange(
      'https://example.gov/',
      previousState,
      15000
    );

    // Assert: page is detected as changed and fetchedHtml carries the GET body.
    expect(result.unchanged).toBe(false);
    expect(result.fetchedHtml).toBe(CHANGED_HTML);
    expect(result.contentHash).toBe(engine.hashContent(CHANGED_HTML));
    expect(result.assetFingerprintHash).toBe(
      engine.computeAssetFingerprint(CHANGED_HTML, 'https://example.gov/')
    );
  });

  it('sets fetchedHtml to null when page is unchanged via GET hash comparison', async () => {
    // Arrange: HTML body has NOT changed since last scan.
    const previousState = makeState();
    global.fetch = makeFetchMock({ getBody: SAMPLE_HTML });

    const result = await engine.probePageChange(
      'https://example.gov/',
      previousState,
      15000
    );

    expect(result.unchanged).toBe(true);
    expect(result.fetchedHtml).toBeNull();
    expect(result.reason).toContain('HTML + asset fingerprint hash');
  });

  it('sets fetchedHtml to null when ETag matches (no GET performed)', async () => {
    const previousState = makeState({ etag: '"abc123"' });
    global.fetch = makeFetchMock({ headEtag: '"abc123"' });

    const result = await engine.probePageChange(
      'https://example.gov/',
      previousState,
      15000
    );

    expect(result.unchanged).toBe(true);
    expect(result.fetchedHtml).toBeNull();
    expect(result.reason).toContain('ETag');
  });

  it('sets fetchedHtml to null when Last-Modified matches (no GET performed)', async () => {
    const previousState = makeState({ lastModified: 'Mon, 01 Jan 2024 00:00:00 GMT' });
    global.fetch = makeFetchMock({ headLastModified: 'Mon, 01 Jan 2024 00:00:00 GMT' });

    const result = await engine.probePageChange(
      'https://example.gov/',
      previousState,
      15000
    );

    expect(result.unchanged).toBe(true);
    expect(result.fetchedHtml).toBeNull();
    expect(result.reason).toContain('Last-Modified');
  });

  it('sets fetchedHtml to null when HEAD probe fails entirely', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network unreachable'));

    const result = await engine.probePageChange(
      'https://example.gov/',
      undefined,
      15000
    );

    expect(result.unchanged).toBe(false);
    expect(result.fetchedHtml).toBeNull();
    expect(result.reason).toContain('probe failed');
  });

  it('sets fetchedHtml to null when GET fails during hash comparison', async () => {
    const previousState = makeState();
    global.fetch = makeFetchMock({ failGet: true });

    const result = await engine.probePageChange(
      'https://example.gov/',
      previousState,
      15000
    );

    // Falls through to the "changed/no prior state" fallback.
    expect(result.unchanged).toBe(false);
    expect(result.fetchedHtml).toBeNull();
  });

  it('sets fetchedHtml to null when there is no previous state (first scan)', async () => {
    // Without a prior contentHash there is no GET to perform.
    global.fetch = makeFetchMock({});

    const result = await engine.probePageChange(
      'https://example.gov/',
      undefined,
      15000
    );

    expect(result.unchanged).toBe(false);
    expect(result.fetchedHtml).toBeNull();
  });
});
