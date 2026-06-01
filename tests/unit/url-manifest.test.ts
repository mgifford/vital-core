import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_QUARANTINE_CONFIG,
  UrlManifest,
  UrlManifestStore
} from '../../src/engine/url-manifest';

const originalCwd = process.cwd();

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vital-url-manifest-'));
}

afterEach(() => {
  process.chdir(originalCwd);
});

describe('UrlManifestStore.load', () => {
  it('returns empty object when manifest file does not exist', () => {
    const tmpDir = makeTmpDir();
    process.chdir(tmpDir);
    expect(UrlManifestStore.load('my-target')).toEqual({});
  });

  it('returns empty object when manifest file contains malformed JSON', () => {
    const tmpDir = makeTmpDir();
    process.chdir(tmpDir);
    const manifestDir = path.join(tmpDir, 'dist/runs/my-target');
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.writeFileSync(path.join(manifestDir, 'url-manifest.json'), '{ bad json }', 'utf8');
    expect(UrlManifestStore.load('my-target')).toEqual({});
  });

  it('returns empty object when manifest file contains an array', () => {
    const tmpDir = makeTmpDir();
    process.chdir(tmpDir);
    const manifestDir = path.join(tmpDir, 'dist/runs/my-target');
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.writeFileSync(path.join(manifestDir, 'url-manifest.json'), '[]', 'utf8');
    expect(UrlManifestStore.load('my-target')).toEqual({});
  });

  it('parses a valid manifest file with correct field types', () => {
    const tmpDir = makeTmpDir();
    process.chdir(tmpDir);
    const manifestDir = path.join(tmpDir, 'dist/runs/cms-gov');
    fs.mkdirSync(manifestDir, { recursive: true });

    const raw = {
      'https://example.gov/': {
        url: 'https://example.gov/',
        discoveredAt: '2026-01-01T00:00:00.000Z',
        lastAttemptedAt: '2026-01-02T00:00:00.000Z',
        lastSuccessAt: '2026-01-02T00:00:00.000Z',
        lastStatus: 'COMPLETED',
        consecutiveFailures: 0,
        cooldownUntil: null,
        contentHash: 'abc123'
      }
    };
    fs.writeFileSync(path.join(manifestDir, 'url-manifest.json'), JSON.stringify(raw), 'utf8');

    const manifest = UrlManifestStore.load('cms-gov');
    const entry = manifest['https://example.gov/'];
    expect(entry).toBeDefined();
    expect(entry.url).toBe('https://example.gov/');
    expect(entry.lastStatus).toBe('COMPLETED');
    expect(entry.consecutiveFailures).toBe(0);
    expect(entry.contentHash).toBe('abc123');
  });

  it('coerces invalid field types to safe defaults', () => {
    const tmpDir = makeTmpDir();
    process.chdir(tmpDir);
    const manifestDir = path.join(tmpDir, 'dist/runs/cms-gov');
    fs.mkdirSync(manifestDir, { recursive: true });

    const raw = {
      'https://example.gov/page': {
        url: 42,                    // should become the key string
        discoveredAt: null,         // should become now ISO string
        lastAttemptedAt: 99,        // should become null
        lastSuccessAt: false,       // should become null
        lastStatus: 'INVALID_STATUS', // should become null
        consecutiveFailures: -1,    // should become 0 (< 0 is floored to 0)
        cooldownUntil: 123,         // should become null
        contentHash: {}             // should become null
      }
    };
    fs.writeFileSync(path.join(manifestDir, 'url-manifest.json'), JSON.stringify(raw), 'utf8');

    const manifest = UrlManifestStore.load('cms-gov');
    const entry = manifest['https://example.gov/page'];
    expect(entry.url).toBe('https://example.gov/page');
    expect(entry.lastAttemptedAt).toBeNull();
    expect(entry.lastSuccessAt).toBeNull();
    expect(entry.lastStatus).toBeNull();
    expect(entry.consecutiveFailures).toBe(0);
    expect(entry.cooldownUntil).toBeNull();
    expect(entry.contentHash).toBeNull();
  });

  it('skips entries whose value is not an object', () => {
    const tmpDir = makeTmpDir();
    process.chdir(tmpDir);
    const manifestDir = path.join(tmpDir, 'dist/runs/cms-gov');
    fs.mkdirSync(manifestDir, { recursive: true });

    const raw = {
      'https://example.gov/valid': {
        url: 'https://example.gov/valid',
        discoveredAt: '2026-01-01T00:00:00.000Z',
        lastAttemptedAt: null,
        lastSuccessAt: null,
        lastStatus: null,
        consecutiveFailures: 0,
        cooldownUntil: null,
        contentHash: null
      },
      'https://example.gov/bad': 'not-an-object'
    };
    fs.writeFileSync(path.join(manifestDir, 'url-manifest.json'), JSON.stringify(raw), 'utf8');

    const manifest = UrlManifestStore.load('cms-gov');
    expect(Object.keys(manifest)).toEqual(['https://example.gov/valid']);
  });
});

describe('UrlManifestStore.save', () => {
  it('creates the target directory and writes the manifest file', () => {
    const tmpDir = makeTmpDir();
    process.chdir(tmpDir);

    const manifest: UrlManifest = {
      'https://example.gov/': {
        url: 'https://example.gov/',
        discoveredAt: '2026-01-01T00:00:00.000Z',
        lastAttemptedAt: null,
        lastSuccessAt: null,
        lastStatus: null,
        consecutiveFailures: 0,
        cooldownUntil: null,
        contentHash: null
      }
    };

    UrlManifestStore.save('cms-gov', manifest);

    const manifestPath = path.join(tmpDir, 'dist/runs/cms-gov/url-manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    expect(parsed['https://example.gov/']).toBeDefined();
  });

  it('round-trips through save and load', () => {
    const tmpDir = makeTmpDir();
    process.chdir(tmpDir);

    const manifest: UrlManifest = {
      'https://example.gov/page': {
        url: 'https://example.gov/page',
        discoveredAt: '2026-01-01T00:00:00.000Z',
        lastAttemptedAt: '2026-01-02T00:00:00.000Z',
        lastSuccessAt: '2026-01-02T00:00:00.000Z',
        lastStatus: 'COMPLETED',
        consecutiveFailures: 0,
        cooldownUntil: null,
        contentHash: 'hash123'
      }
    };

    UrlManifestStore.save('cms-gov', manifest);
    const loaded = UrlManifestStore.load('cms-gov');

    expect(loaded['https://example.gov/page'].lastStatus).toBe('COMPLETED');
    expect(loaded['https://example.gov/page'].contentHash).toBe('hash123');
  });
});

describe('UrlManifestStore.ensureEntries', () => {
  it('creates entries for new URLs with the provided timestamp', () => {
    const manifest: UrlManifest = {};
    const now = '2026-01-01T00:00:00.000Z';
    UrlManifestStore.ensureEntries(manifest, ['https://example.gov/', 'https://example.gov/page'], now);

    expect(Object.keys(manifest)).toHaveLength(2);
    expect(manifest['https://example.gov/'].discoveredAt).toBe(now);
    expect(manifest['https://example.gov/'].consecutiveFailures).toBe(0);
    expect(manifest['https://example.gov/'].lastStatus).toBeNull();
  });

  it('does not overwrite existing entries', () => {
    const now = '2026-01-01T00:00:00.000Z';
    const manifest: UrlManifest = {
      'https://example.gov/': {
        url: 'https://example.gov/',
        discoveredAt: '2025-12-01T00:00:00.000Z',
        lastAttemptedAt: '2025-12-10T00:00:00.000Z',
        lastSuccessAt: '2025-12-10T00:00:00.000Z',
        lastStatus: 'COMPLETED',
        consecutiveFailures: 0,
        cooldownUntil: null,
        contentHash: 'existing-hash'
      }
    };

    UrlManifestStore.ensureEntries(manifest, ['https://example.gov/'], now);
    // discoveredAt and lastStatus must remain unchanged
    expect(manifest['https://example.gov/'].discoveredAt).toBe('2025-12-01T00:00:00.000Z');
    expect(manifest['https://example.gov/'].lastStatus).toBe('COMPLETED');
  });
});

describe('UrlManifestStore.recordScanOutcome — success paths', () => {
  const now = '2026-01-01T12:00:00.000Z';

  it('sets lastSuccessAt and resets consecutiveFailures on COMPLETED', () => {
    const manifest: UrlManifest = {};
    UrlManifestStore.recordScanOutcome(manifest, 'https://example.gov/', 'COMPLETED', 'hash1', now);

    const entry = manifest['https://example.gov/'];
    expect(entry.lastSuccessAt).toBe(now);
    expect(entry.consecutiveFailures).toBe(0);
    expect(entry.cooldownUntil).toBeNull();
    expect(entry.contentHash).toBe('hash1');
  });

  it('sets lastSuccessAt on SKIPPED_UNCHANGED and preserves contentHash when null passed', () => {
    const manifest: UrlManifest = {
      'https://example.gov/': {
        url: 'https://example.gov/',
        discoveredAt: now,
        lastAttemptedAt: null,
        lastSuccessAt: null,
        lastStatus: null,
        consecutiveFailures: 1,
        cooldownUntil: null,
        contentHash: 'previous-hash'
      }
    };

    UrlManifestStore.recordScanOutcome(manifest, 'https://example.gov/', 'SKIPPED_UNCHANGED', null, now);

    const entry = manifest['https://example.gov/'];
    expect(entry.lastSuccessAt).toBe(now);
    expect(entry.consecutiveFailures).toBe(0);
    // contentHash must NOT be overwritten when null is passed
    expect(entry.contentHash).toBe('previous-hash');
  });

  it('clears cooldown on success after a previous failure', () => {
    const futureCooldown = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const manifest: UrlManifest = {
      'https://example.gov/': {
        url: 'https://example.gov/',
        discoveredAt: now,
        lastAttemptedAt: now,
        lastSuccessAt: null,
        lastStatus: 'TIMEOUT',
        consecutiveFailures: 2,
        cooldownUntil: futureCooldown,
        contentHash: null
      }
    };

    UrlManifestStore.recordScanOutcome(manifest, 'https://example.gov/', 'COMPLETED', null, now);

    expect(manifest['https://example.gov/'].cooldownUntil).toBeNull();
    expect(manifest['https://example.gov/'].consecutiveFailures).toBe(0);
  });
});

describe('UrlManifestStore.recordScanOutcome — failure paths', () => {
  const now = '2026-01-01T12:00:00.000Z';

  it('increments consecutiveFailures on TIMEOUT', () => {
    const manifest: UrlManifest = {};
    UrlManifestStore.recordScanOutcome(manifest, 'https://example.gov/', 'TIMEOUT', null, now);
    expect(manifest['https://example.gov/'].consecutiveFailures).toBe(1);
    expect(manifest['https://example.gov/'].lastSuccessAt).toBeNull();
  });

  it('does not set cooldown below the light threshold', () => {
    const manifest: UrlManifest = {};
    UrlManifestStore.recordScanOutcome(manifest, 'https://example.gov/', 'TIMEOUT', null, now);
    // 1 failure < lightThreshold (2), so no cooldown yet
    expect(manifest['https://example.gov/'].cooldownUntil).toBeNull();
  });

  it('sets light cooldown at the light threshold (2 failures)', () => {
    const manifest: UrlManifest = {};
    const config = DEFAULT_QUARANTINE_CONFIG; // light: 2 failures → 48h

    UrlManifestStore.recordScanOutcome(manifest, 'https://example.gov/', 'TIMEOUT', null, now, config);
    UrlManifestStore.recordScanOutcome(manifest, 'https://example.gov/', 'TIMEOUT', null, now, config);

    const entry = manifest['https://example.gov/'];
    expect(entry.consecutiveFailures).toBe(2);
    expect(entry.cooldownUntil).not.toBeNull();

    const cooldownMs = Date.parse(entry.cooldownUntil!);
    const nowMs = Date.parse(now);
    const hours = (cooldownMs - nowMs) / (60 * 60 * 1000);
    expect(hours).toBeCloseTo(48, 0);
  });

  it('escalates to hard cooldown at the hard threshold (4 failures)', () => {
    const manifest: UrlManifest = {};
    const config = DEFAULT_QUARANTINE_CONFIG; // hard: 4 failures → 168h

    for (let i = 0; i < 4; i++) {
      UrlManifestStore.recordScanOutcome(manifest, 'https://example.gov/', 'TIMEOUT', null, now, config);
    }

    const entry = manifest['https://example.gov/'];
    expect(entry.consecutiveFailures).toBe(4);

    const cooldownMs = Date.parse(entry.cooldownUntil!);
    const nowMs = Date.parse(now);
    const hours = (cooldownMs - nowMs) / (60 * 60 * 1000);
    expect(hours).toBeCloseTo(168, 0);
  });

  it('applies cooldown for FAILED and WAF_BLOCKED too', () => {
    const manifest: UrlManifest = {};

    UrlManifestStore.recordScanOutcome(manifest, 'https://a.gov/', 'FAILED', null, now);
    UrlManifestStore.recordScanOutcome(manifest, 'https://a.gov/', 'FAILED', null, now);
    expect(manifest['https://a.gov/'].cooldownUntil).not.toBeNull();

    UrlManifestStore.recordScanOutcome(manifest, 'https://b.gov/', 'WAF_BLOCKED', null, now);
    UrlManifestStore.recordScanOutcome(manifest, 'https://b.gov/', 'WAF_BLOCKED', null, now);
    expect(manifest['https://b.gov/'].cooldownUntil).not.toBeNull();
  });
});

describe('UrlManifestStore.isQuarantined', () => {
  it('returns false when cooldownUntil is null', () => {
    const entry = {
      url: 'https://example.gov/',
      discoveredAt: '2026-01-01T00:00:00.000Z',
      lastAttemptedAt: null,
      lastSuccessAt: null,
      lastStatus: null,
      consecutiveFailures: 0,
      cooldownUntil: null,
      contentHash: null
    };
    expect(UrlManifestStore.isQuarantined(entry)).toBe(false);
  });

  it('returns true when cooldown is in the future', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const entry = {
      url: 'https://example.gov/',
      discoveredAt: '2026-01-01T00:00:00.000Z',
      lastAttemptedAt: null,
      lastSuccessAt: null,
      lastStatus: null,
      consecutiveFailures: 3,
      cooldownUntil: future,
      contentHash: null
    };
    expect(UrlManifestStore.isQuarantined(entry)).toBe(true);
  });

  it('returns false when cooldown has already expired', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const entry = {
      url: 'https://example.gov/',
      discoveredAt: '2026-01-01T00:00:00.000Z',
      lastAttemptedAt: null,
      lastSuccessAt: null,
      lastStatus: null,
      consecutiveFailures: 2,
      cooldownUntil: past,
      contentHash: null
    };
    expect(UrlManifestStore.isQuarantined(entry)).toBe(false);
  });
});

describe('UrlManifestStore.partitionByQuarantine', () => {
  it('separates quarantined from active URLs', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const now = '2026-01-01T00:00:00.000Z';

    const manifest: UrlManifest = {
      'https://example.gov/a': {
        url: 'https://example.gov/a',
        discoveredAt: now,
        lastAttemptedAt: now,
        lastSuccessAt: null,
        lastStatus: 'TIMEOUT',
        consecutiveFailures: 3,
        cooldownUntil: future,
        contentHash: null
      },
      'https://example.gov/b': {
        url: 'https://example.gov/b',
        discoveredAt: now,
        lastAttemptedAt: now,
        lastSuccessAt: now,
        lastStatus: 'COMPLETED',
        consecutiveFailures: 0,
        cooldownUntil: null,
        contentHash: 'abc'
      }
    };

    const urls = ['https://example.gov/a', 'https://example.gov/b'];
    const { active, quarantined } = UrlManifestStore.partitionByQuarantine(manifest, urls);

    expect(active).toEqual(['https://example.gov/b']);
    expect(quarantined).toEqual(['https://example.gov/a']);
  });

  it('treats URLs not in the manifest as active', () => {
    const { active, quarantined } = UrlManifestStore.partitionByQuarantine(
      {},
      ['https://example.gov/new']
    );
    expect(active).toEqual(['https://example.gov/new']);
    expect(quarantined).toHaveLength(0);
  });
});

describe('UrlManifestStore.partitionByRecency', () => {
  it('puts URLs with no lastSuccessAt into needsScan', () => {
    const manifest: UrlManifest = {
      'https://example.gov/': {
        url: 'https://example.gov/',
        discoveredAt: '2026-01-01T00:00:00.000Z',
        lastAttemptedAt: null,
        lastSuccessAt: null,
        lastStatus: null,
        consecutiveFailures: 0,
        cooldownUntil: null,
        contentHash: null
      }
    };

    const { needsScan, recentlySucceeded } = UrlManifestStore.partitionByRecency(
      manifest,
      ['https://example.gov/'],
      7
    );
    expect(needsScan).toContain('https://example.gov/');
    expect(recentlySucceeded).toHaveLength(0);
  });

  it('puts recently succeeded URLs into recentlySucceeded', () => {
    const recentSuccess = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min ago
    const manifest: UrlManifest = {
      'https://example.gov/': {
        url: 'https://example.gov/',
        discoveredAt: '2026-01-01T00:00:00.000Z',
        lastAttemptedAt: recentSuccess,
        lastSuccessAt: recentSuccess,
        lastStatus: 'COMPLETED',
        consecutiveFailures: 0,
        cooldownUntil: null,
        contentHash: 'abc'
      }
    };

    const { needsScan, recentlySucceeded } = UrlManifestStore.partitionByRecency(
      manifest,
      ['https://example.gov/'],
      7
    );
    expect(recentlySucceeded).toContain('https://example.gov/');
    expect(needsScan).toHaveLength(0);
  });

  it('puts URLs with a success older than windowDays into needsScan', () => {
    const oldSuccess = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago
    const manifest: UrlManifest = {
      'https://example.gov/': {
        url: 'https://example.gov/',
        discoveredAt: '2025-01-01T00:00:00.000Z',
        lastAttemptedAt: oldSuccess,
        lastSuccessAt: oldSuccess,
        lastStatus: 'COMPLETED',
        consecutiveFailures: 0,
        cooldownUntil: null,
        contentHash: 'abc'
      }
    };

    const { needsScan, recentlySucceeded } = UrlManifestStore.partitionByRecency(
      manifest,
      ['https://example.gov/'],
      7
    );
    expect(needsScan).toContain('https://example.gov/');
    expect(recentlySucceeded).toHaveLength(0);
  });

  it('treats a windowDays of 0 as no recency filter (all go to needsScan)', () => {
    const recentSuccess = new Date(Date.now() - 60 * 1000).toISOString();
    const manifest: UrlManifest = {
      'https://example.gov/': {
        url: 'https://example.gov/',
        discoveredAt: '2026-01-01T00:00:00.000Z',
        lastAttemptedAt: recentSuccess,
        lastSuccessAt: recentSuccess,
        lastStatus: 'COMPLETED',
        consecutiveFailures: 0,
        cooldownUntil: null,
        contentHash: 'abc'
      }
    };

    const { needsScan } = UrlManifestStore.partitionByRecency(
      manifest,
      ['https://example.gov/'],
      0
    );
    expect(needsScan).toContain('https://example.gov/');
  });
});

describe('UrlManifestStore.countQuarantined', () => {
  it('returns 0 for an empty manifest', () => {
    expect(UrlManifestStore.countQuarantined({})).toBe(0);
  });

  it('counts only URLs with an active future cooldown', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 1000).toISOString();
    const now = '2026-01-01T00:00:00.000Z';

    const manifest: UrlManifest = {
      'https://example.gov/a': {
        url: 'https://example.gov/a',
        discoveredAt: now,
        lastAttemptedAt: now,
        lastSuccessAt: null,
        lastStatus: 'TIMEOUT',
        consecutiveFailures: 3,
        cooldownUntil: future,
        contentHash: null
      },
      'https://example.gov/b': {
        url: 'https://example.gov/b',
        discoveredAt: now,
        lastAttemptedAt: now,
        lastSuccessAt: null,
        lastStatus: 'TIMEOUT',
        consecutiveFailures: 2,
        cooldownUntil: past,
        contentHash: null
      },
      'https://example.gov/c': {
        url: 'https://example.gov/c',
        discoveredAt: now,
        lastAttemptedAt: now,
        lastSuccessAt: now,
        lastStatus: 'COMPLETED',
        consecutiveFailures: 0,
        cooldownUntil: null,
        contentHash: 'hash'
      }
    };

    expect(UrlManifestStore.countQuarantined(manifest)).toBe(1);
  });
});
