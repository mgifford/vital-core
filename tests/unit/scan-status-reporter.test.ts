import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { ScanStatusReporter } from '../../src/engine/reporters/scan-status-reporter';
import { TargetScanResult } from '../../src/types/site-quality-spec';
import { UrlManifest } from '../../src/engine/url-manifest';

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

function makeResult(
  targetId: string,
  domain: string,
  statuses: string[]
): TargetScanResult {
  return {
    targetId,
    domain,
    scanDurationMs: 1000,
    pagesScanned: statuses.map((status, i) => ({
      url: `https://${domain}/page-${i}`,
      timestamp: '2026-01-01T00:00:00.000Z',
      status: status as 'COMPLETED' | 'SKIPPED_UNCHANGED' | 'TIMEOUT' | 'FAILED' | 'WAF_BLOCKED',
      errorMessage: null,
      technologyStack: [],
      liveAudits: null,
      offlineAudits: null,
      lighthouseMetrics: null,
      thirdPartyImpact: null
    }))
  };
}

function makeManifest(domain: string, numEntries: number): UrlManifest {
  const manifest: UrlManifest = {};
  for (let i = 0; i < numEntries; i++) {
    const url = `https://${domain}/page-${i}`;
    manifest[url] = {
      url,
      discoveredAt: '2026-01-01T00:00:00.000Z',
      lastAttemptedAt: null,
      lastSuccessAt: null,
      lastStatus: null,
      consecutiveFailures: 0,
      cooldownUntil: null,
      contentHash: null
    };
  }
  return manifest;
}

describe('ScanStatusReporter.buildScanStatus', () => {
  it('correctly counts completedThisRun, skippedUnchangedThisRun, timedOutThisRun, failedThisRun', () => {
    const result = makeResult('cms-gov', 'cms.gov', [
      'COMPLETED',
      'COMPLETED',
      'SKIPPED_UNCHANGED',
      'TIMEOUT',
      'FAILED',
      'WAF_BLOCKED'
    ]);
    const manifests = new Map([['cms-gov', makeManifest('cms.gov', 6)]]);

    const [status] = ScanStatusReporter.buildScanStatus([result], manifests);

    expect(status.completedThisRun).toBe(2);
    expect(status.skippedUnchangedThisRun).toBe(1);
    expect(status.timedOutThisRun).toBe(1);
    expect(status.failedThisRun).toBe(2); // FAILED + WAF_BLOCKED
    expect(status.scannedThisRun).toBe(6);
  });

  it('computes remainingDailyBudget when a budget is provided', () => {
    const result = makeResult('cms-gov', 'cms.gov', ['COMPLETED', 'COMPLETED', 'SKIPPED_UNCHANGED']);
    const manifests = new Map([['cms-gov', makeManifest('cms.gov', 3)]]);
    const dailyBudgets = new Map<string, number | null>([['cms-gov', 10]]);

    const [status] = ScanStatusReporter.buildScanStatus([result], manifests, { dailyBudgets });

    // 10 budget − (2 completed + 1 skipped_unchanged) = 7
    expect(status.remainingDailyBudget).toBe(7);
  });

  it('sets remainingDailyBudget to null when no budget is configured', () => {
    const result = makeResult('cms-gov', 'cms.gov', ['COMPLETED']);
    const manifests = new Map([['cms-gov', {}]]);

    const [status] = ScanStatusReporter.buildScanStatus([result], manifests);
    expect(status.remainingDailyBudget).toBeNull();
  });

  it('clamps remainingDailyBudget to 0 when consumption exceeds budget', () => {
    const result = makeResult('cms-gov', 'cms.gov', ['COMPLETED', 'COMPLETED', 'COMPLETED']);
    const manifests = new Map([['cms-gov', {}]]);
    const dailyBudgets = new Map<string, number | null>([['cms-gov', 1]]);

    const [status] = ScanStatusReporter.buildScanStatus([result], manifests, { dailyBudgets });
    expect(status.remainingDailyBudget).toBe(0);
  });

  it('uses cdnProvider from the options map', () => {
    const result = makeResult('cms-gov', 'cms.gov', ['COMPLETED']);
    const manifests = new Map([['cms-gov', {}]]);
    const cdnProviders = new Map<string, string | null>([['cms-gov', 'cloudflare']]);

    const [status] = ScanStatusReporter.buildScanStatus([result], manifests, { cdnProviders });
    expect(status.cdnProvider).toBe('cloudflare');
  });

  it('passes through queue composition counts from discovery', () => {
    const result = makeResult('cms-gov', 'cms.gov', ['COMPLETED']);
    const manifests = new Map([['cms-gov', {}]]);
    const queueCompositions = new Map<string, {
      recently_updated: number;
      duckduckgo_seed: number;
      priority_url: number;
      stale_weekly_rescan: number;
      sitemap_sample: number;
    }>([[
      'cms-gov',
      {
        recently_updated: 1,
        duckduckgo_seed: 2,
        priority_url: 3,
        stale_weekly_rescan: 4,
        sitemap_sample: 5
      }
    ]]);

    const [status] = ScanStatusReporter.buildScanStatus([result], manifests, { queueCompositions });
    expect(status.queueComposition).toEqual({
      recently_updated: 1,
      duckduckgo_seed: 2,
      priority_url: 3,
      stale_weekly_rescan: 4,
      sitemap_sample: 5
    });
  });

  it('defaults cdnProvider to null when not provided', () => {
    const result = makeResult('cms-gov', 'cms.gov', ['COMPLETED']);
    const [status] = ScanStatusReporter.buildScanStatus([result], new Map());
    expect(status.cdnProvider).toBeNull();
  });

  it('defaults throttleProfile to moderate when not provided', () => {
    const result = makeResult('cms-gov', 'cms.gov', ['COMPLETED']);
    const [status] = ScanStatusReporter.buildScanStatus([result], new Map());
    expect(status.throttleProfile).toBe('moderate');
  });

  it('reports totalKnownUrls from the manifest key count', () => {
    const result = makeResult('cms-gov', 'cms.gov', ['COMPLETED']);
    const manifests = new Map([['cms-gov', makeManifest('cms.gov', 42)]]);
    const [status] = ScanStatusReporter.buildScanStatus([result], manifests);
    expect(status.totalKnownUrls).toBe(42);
  });

  it('populates failedUrlDetails for TIMEOUT, FAILED, and WAF_BLOCKED pages', () => {
    const domain = 'cms.gov';
    const result = makeResult('cms-gov', domain, ['TIMEOUT', 'FAILED', 'COMPLETED']);
    const manifests = new Map([['cms-gov', {}]]);

    const [status] = ScanStatusReporter.buildScanStatus([result], manifests);
    expect(status.failedUrlDetails).toHaveLength(2);
    expect(status.failedUrlDetails.map(d => d.status).sort()).toEqual(['FAILED', 'TIMEOUT'].sort());
  });

  it('picks up consecutiveFailures from the manifest entry', () => {
    const domain = 'cms.gov';
    const url = `https://${domain}/page-0`;
    const result = makeResult('cms-gov', domain, ['TIMEOUT']);
    const manifest: UrlManifest = {
      [url]: {
        url,
        discoveredAt: '2026-01-01T00:00:00.000Z',
        lastAttemptedAt: '2026-01-01T12:00:00.000Z',
        lastSuccessAt: null,
        lastStatus: 'TIMEOUT',
        consecutiveFailures: 3,
        cooldownUntil: null,
        contentHash: null
      }
    };

    const [status] = ScanStatusReporter.buildScanStatus([result], new Map([['cms-gov', manifest]]));
    expect(status.failedUrlDetails[0].consecutiveFailures).toBe(3);
  });

  it('handles multiple targets independently', () => {
    const resultA = makeResult('target-a', 'a.gov', ['COMPLETED', 'COMPLETED']);
    const resultB = makeResult('target-b', 'b.gov', ['TIMEOUT', 'TIMEOUT', 'TIMEOUT']);
    const manifests = new Map<string, UrlManifest>([
      ['target-a', {}],
      ['target-b', {}]
    ]);

    const statuses = ScanStatusReporter.buildScanStatus([resultA, resultB], manifests);
    expect(statuses).toHaveLength(2);

    const a = statuses.find(s => s.targetId === 'target-a')!;
    const b = statuses.find(s => s.targetId === 'target-b')!;
    expect(a.completedThisRun).toBe(2);
    expect(b.timedOutThisRun).toBe(3);
  });

  it('returns empty array for empty results input', () => {
    const statuses = ScanStatusReporter.buildScanStatus([], new Map());
    expect(statuses).toEqual([]);
  });
});

describe('ScanStatusReporter.buildMarkdownReport', () => {
  it('includes a header and summary table', () => {
    const result = makeResult('cms-gov', 'cms.gov', ['COMPLETED']);
    const manifests = new Map([['cms-gov', {}]]);
    const [status] = ScanStatusReporter.buildScanStatus([result], manifests);

    const md = ScanStatusReporter.buildMarkdownReport([status]);
    expect(md).toContain('# Scan Status Report');
    expect(md).toContain('| Domain |');
    expect(md).toContain('cms.gov');
    expect(md).toContain('Queue Composition');
  });

  it('includes failed URL table only when there are failures', () => {
    const resultOk = makeResult('cms-gov', 'cms.gov', ['COMPLETED']);
    const resultFail = makeResult('bad-target', 'bad.gov', ['TIMEOUT']);
    const manifests = new Map<string, UrlManifest>([
      ['cms-gov', {}],
      ['bad-target', {}]
    ]);

    const statuses = ScanStatusReporter.buildScanStatus([resultOk, resultFail], manifests);
    const md = ScanStatusReporter.buildMarkdownReport(statuses);

    expect(md).toContain('bad.gov — Timeout / Failed URLs');
    expect(md).not.toContain('cms.gov — Timeout / Failed URLs');
  });

  it('includes CDN throttle guidance section', () => {
    const md = ScanStatusReporter.buildMarkdownReport([]);
    expect(md).toContain('Throttle & CDN Guidance');
    expect(md).toContain('conservative');
  });
});

describe('ScanStatusReporter.saveJson and save', () => {
  it('writes scan-status.json to dist/runs/', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-scan-status-'));
    process.chdir(tmpDir);

    const result = makeResult('cms-gov', 'cms.gov', ['COMPLETED']);
    const [status] = ScanStatusReporter.buildScanStatus([result], new Map());
    ScanStatusReporter.saveJson([status]);

    const jsonPath = path.join(tmpDir, 'dist/runs/scan-status.json');
    expect(fs.existsSync(jsonPath)).toBe(true);

    const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as { generatedAt: string; targets: unknown[] };
    expect(payload.targets).toHaveLength(1);
    expect(payload.generatedAt).toBeDefined();
  });

  it('writes both scan-status.json and scan-status.md via save()', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-scan-status-'));
    process.chdir(tmpDir);

    const result = makeResult('cms-gov', 'cms.gov', ['COMPLETED']);
    const [status] = ScanStatusReporter.buildScanStatus([result], new Map());
    ScanStatusReporter.save([status]);

    expect(fs.existsSync(path.join(tmpDir, 'dist/runs/scan-status.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'dist/runs/scan-status.md'))).toBe(true);
  });
});
