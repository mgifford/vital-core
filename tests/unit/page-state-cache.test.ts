import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PageStateCache } from '../../src/engine/reporters/page-state-cache';

const originalCwd = process.cwd();

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vital-page-state-'));
}

afterEach(() => {
  process.chdir(originalCwd);
  delete process.env.VITAL_HISTORY_CACHE_DIR;
});

describe('PageStateCache.load', () => {
  it('returns empty object when state file does not exist', () => {
    const tmpDir = makeTmpDir();
    process.chdir(tmpDir);

    const state = PageStateCache.load();
    expect(state).toEqual({});
  });

  it('returns empty object when state file contains malformed JSON', () => {
    const tmpDir = makeTmpDir();
    process.chdir(tmpDir);

    const runsDir = path.join(tmpDir, 'dist/runs');
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, 'page-state.json'), '{ not-valid-json }', 'utf8');

    const state = PageStateCache.load();
    expect(state).toEqual({});
  });

  it('returns empty object when state file contains a non-object value', () => {
    const tmpDir = makeTmpDir();
    process.chdir(tmpDir);

    const runsDir = path.join(tmpDir, 'dist/runs');
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, 'page-state.json'), '"just-a-string"', 'utf8');

    const state = PageStateCache.load();
    expect(state).toEqual({});
  });

  it('parses a valid state file and coerces non-string fields to null', () => {
    const tmpDir = makeTmpDir();
    process.chdir(tmpDir);

    const runsDir = path.join(tmpDir, 'dist/runs');
    fs.mkdirSync(runsDir, { recursive: true });

    const raw = {
      'https://example.gov/page': {
        etag: '"abc123"',
        lastModified: 'Thu, 01 Jan 2026 00:00:00 GMT',
        contentHash: 'deadbeef',
        assetFingerprintHash: 'cafebabe',
        lastCheckedAt: '2026-01-01T00:00:00.000Z',
        lastScannedAt: '2026-01-01T00:00:00.000Z'
      },
      'https://example.gov/page-2': {
        etag: 123,
        lastModified: null,
        contentHash: null,
        assetFingerprintHash: null,
        lastCheckedAt: 99,
        lastScannedAt: false
      }
    };
    fs.writeFileSync(path.join(runsDir, 'page-state.json'), JSON.stringify(raw), 'utf8');

    const state = PageStateCache.load();

    expect(state['https://example.gov/page'].etag).toBe('"abc123"');
    expect(state['https://example.gov/page'].lastModified).toBe('Thu, 01 Jan 2026 00:00:00 GMT');
    expect(state['https://example.gov/page'].contentHash).toBe('deadbeef');
    expect(state['https://example.gov/page'].assetFingerprintHash).toBe('cafebabe');

    // Non-string fields are coerced to null / empty string
    expect(state['https://example.gov/page-2'].etag).toBeNull();
    expect(state['https://example.gov/page-2'].lastModified).toBeNull();
    expect(state['https://example.gov/page-2'].lastCheckedAt).toBe('');
    expect(state['https://example.gov/page-2'].lastScannedAt).toBe('');
  });

  it('skips entries whose value is not an object', () => {
    const tmpDir = makeTmpDir();
    process.chdir(tmpDir);

    const runsDir = path.join(tmpDir, 'dist/runs');
    fs.mkdirSync(runsDir, { recursive: true });

    const raw = {
      'https://example.gov/valid': {
        etag: '"v1"',
        lastModified: null,
        contentHash: null,
        assetFingerprintHash: null,
        lastCheckedAt: '2026-01-01T00:00:00.000Z',
        lastScannedAt: '2026-01-01T00:00:00.000Z'
      },
      'https://example.gov/bad': 'not-an-object'
    };
    fs.writeFileSync(path.join(runsDir, 'page-state.json'), JSON.stringify(raw), 'utf8');

    const state = PageStateCache.load();
    expect(Object.keys(state)).toEqual(['https://example.gov/valid']);
  });
});

describe('PageStateCache.save', () => {
  it('creates the runs directory and writes the state file', () => {
    const tmpDir = makeTmpDir();
    process.chdir(tmpDir);

    const entry = {
      etag: '"abc"',
      lastModified: null,
      contentHash: null,
      assetFingerprintHash: null,
      lastCheckedAt: '2026-01-01T00:00:00.000Z',
      lastScannedAt: '2026-01-01T00:00:00.000Z'
    };

    PageStateCache.save({ 'https://example.gov/': entry });

    const stateFile = path.join(tmpDir, 'dist/runs/page-state.json');
    expect(fs.existsSync(stateFile)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Record<string, unknown>;
    expect(parsed['https://example.gov/']).toBeDefined();
  });

  it('round-trips through save and load', () => {
    const tmpDir = makeTmpDir();
    process.chdir(tmpDir);

    const state = {
      'https://example.gov/a': {
        etag: '"v1"',
        lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT',
        contentHash: 'abc',
        assetFingerprintHash: '123',
        lastCheckedAt: '2026-01-01T00:00:00.000Z',
        lastScannedAt: '2026-01-01T00:00:00.000Z'
      }
    };

    PageStateCache.save(state);
    const loaded = PageStateCache.load();

    expect(loaded['https://example.gov/a'].etag).toBe('"v1"');
    expect(loaded['https://example.gov/a'].contentHash).toBe('abc');
  });
});

describe('PageStateCache cache restoration', () => {
  it('copies state file from cache dir when target does not exist', () => {
    const tmpDir = makeTmpDir();
    process.chdir(tmpDir);

    const cacheRunsDir = path.join(tmpDir, '.history-cache/runs');
    fs.mkdirSync(cacheRunsDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheRunsDir, 'page-state.json'),
      JSON.stringify({ 'https://example.gov/': { etag: '"cached"', lastModified: null, contentHash: null, assetFingerprintHash: null, lastCheckedAt: '', lastScannedAt: '' } }),
      'utf8'
    );

    process.env.VITAL_HISTORY_CACHE_DIR = '.history-cache';

    const state = PageStateCache.load();
    expect(state['https://example.gov/'].etag).toBe('"cached"');
  });

  it('does not overwrite an existing state file when cache dir is set', () => {
    const tmpDir = makeTmpDir();
    process.chdir(tmpDir);

    const cacheRunsDir = path.join(tmpDir, '.history-cache/runs');
    fs.mkdirSync(cacheRunsDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheRunsDir, 'page-state.json'),
      JSON.stringify({ 'https://example.gov/': { etag: '"from-cache"', lastModified: null, contentHash: null, assetFingerprintHash: null, lastCheckedAt: '', lastScannedAt: '' } }),
      'utf8'
    );

    const runsDir = path.join(tmpDir, 'dist/runs');
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(
      path.join(runsDir, 'page-state.json'),
      JSON.stringify({ 'https://example.gov/': { etag: '"from-dist"', lastModified: null, contentHash: null, assetFingerprintHash: null, lastCheckedAt: '', lastScannedAt: '' } }),
      'utf8'
    );

    process.env.VITAL_HISTORY_CACHE_DIR = '.history-cache';

    const state = PageStateCache.load();
    expect(state['https://example.gov/'].etag).toBe('"from-dist"');
  });

  it('returns empty object when cache dir is set but cache file is absent', () => {
    const tmpDir = makeTmpDir();
    process.chdir(tmpDir);

    process.env.VITAL_HISTORY_CACHE_DIR = '.history-cache-missing';

    const state = PageStateCache.load();
    expect(state).toEqual({});
  });
});
