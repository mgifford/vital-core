import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getData } from '../../src/standards/getdata';

const CACHE_ROOT = path.resolve(process.cwd(), 'tools/submodules/standards/.cache/scangov');
const STANDARDS_URL = 'https://data.scangov.org/standards/audits.json';
const CACHE_FILE = path.join(CACHE_ROOT, 'standards/audits.json');

describe('ScanGov standards loader caching', () => {
  beforeEach(() => {
    fs.rmSync(CACHE_ROOT, { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(CACHE_ROOT, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('falls back from data.scangov.org to GitHub and caches the resolved JSON', async () => {
    const payload = { source: 'github fallback', standards: ['a11y'] };

    const firstFetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://data.scangov.org')) {
        return { ok: false, status: 503, json: async () => ({}) } as Response;
      }

      if (url.startsWith('https://github.com/ScanGov/data/raw/refs/heads/main')) {
        return {
          ok: true,
          status: 200,
          json: async () => payload,
        } as Response;
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal('fetch', firstFetchMock);

    const firstResult = await getData(STANDARDS_URL);

    expect(firstResult).toEqual(payload);
    expect(fs.existsSync(CACHE_FILE)).toBe(true);
    expect(firstFetchMock).toHaveBeenCalledTimes(2);

    const secondFetchMock = vi.fn(async () => {
      throw new Error('network unavailable');
    });

    vi.stubGlobal('fetch', secondFetchMock);

    const secondResult = await getData(STANDARDS_URL);

    expect(secondResult).toEqual(payload);
    expect(secondFetchMock).not.toHaveBeenCalled();
  });
});