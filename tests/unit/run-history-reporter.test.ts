import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { RunHistoryReporter } from '../../src/engine/reporters/run-history';
import { TargetScanResult } from '../../src/types/site-quality-spec';

const originalCwd = process.cwd();

function makeResult(targetId: string, violations: number): TargetScanResult {
  return {
    targetId,
    domain: 'https://example.org',
    scanDurationMs: 1000,
    pagesScanned: [
      {
        url: 'https://example.org/page',
        timestamp: new Date().toISOString(),
        status: 'COMPLETED',
        errorMessage: null,
        technologyStack: [],
        liveAudits: {
          lighthouse: null,
          accessibilityViolations: Array.from({ length: violations }).map((_, i) => ({
            id: `rule-${i}`,
            severity: 'serious' as const,
            description: 'desc',
            helpUrl: 'https://example.org/help',
            impactedCriteria: ['wcag2aa'],
            instances: [
              {
                html: '<div></div>',
                target: ['div'],
                failureSummary: 'summary'
              }
            ]
          }))
        },
        offlineAudits: {
          overlayDetected: { found: false, provider: null, evidence: null },
          designSystem: { usesUSWDS: false, versionDetected: null },
          contentMetrics: {
            readabilityScore: 60,
            suspiciousAltTextCount: 0,
            suspiciousAltInstances: []
          },
          linkHealth: { totalChecked: 0, brokenCount: 0, brokenLinks: [] }
        }
      }
    ]
  };
}

afterEach(() => {
  process.chdir(originalCwd);
  delete process.env.VITAL_HISTORY_CACHE_DIR;
});

describe('RunHistoryReporter', () => {
  it('writes latest payload and appends to historical index', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-history-test-'));
    process.chdir(tmpDir);

    const results = [makeResult('alpha', 2), makeResult('beta', 1)];
    const entry = RunHistoryReporter.persistRunHistory(results, 'profiles/us-health.yml', 2200);
    RunHistoryReporter.persistRunHistory([makeResult('alpha', 5)], 'profiles/us-health.yml', 1200);

    const latestPath = path.resolve(tmpDir, 'dist/runs/latest.json');
    const indexPath = path.resolve(tmpDir, 'dist/runs/index.json');
    const trendsPath = path.resolve(tmpDir, 'dist/runs/trends.json');
    const ongoingPath = path.resolve(tmpDir, 'dist/runs/domain-ongoing.json');
    const artifactPath = path.resolve(tmpDir, 'dist', entry.artifactPath);

    expect(fs.existsSync(latestPath)).toBe(true);
    expect(fs.existsSync(indexPath)).toBe(true);
    expect(fs.existsSync(trendsPath)).toBe(true);
    expect(fs.existsSync(ongoingPath)).toBe(true);
    expect(fs.existsSync(artifactPath)).toBe(true);

    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as { runs: Array<{ runId: string; totalViolations: number; pagesScanned: number }> };

    expect(index.runs.length).toBe(2);
    expect(index.runs[0].runId).toBeTruthy();

    const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8')) as {
      qualityIndex: { score: number; gateStatus: string };
      targetQuality: Array<{ targetId: string; score: number; gateStatus: string }>;
      providerAttributionTop: Array<{ provider: string; high: number; medium: number; low: number; score: number }>;
    };

    expect(latest.qualityIndex.score).toBeGreaterThanOrEqual(0);
    expect(['PASS', 'WARNING', 'BLOCKED']).toContain(latest.qualityIndex.gateStatus);
    expect(Array.isArray(latest.targetQuality)).toBe(true);
    expect(latest.targetQuality.length).toBeGreaterThan(0);
    expect(latest.targetQuality[0].targetId).toBeTruthy();
    expect(Array.isArray(latest.providerAttributionTop)).toBe(true);

    const trends = JSON.parse(fs.readFileSync(trendsPath, 'utf8')) as {
      latest: {
        totalViolations: number;
        providerAttributionTop: Array<{ provider: string }>;
        urlFreshness: {
          newUrls: number;
          carriedOverUrls: number;
          newUrlPercent: number;
        };
      };
      deltaFromPrevious: { totalViolations: number } | null;
      rollingAverage: { violationsPerPage: number };
      windowSize: number;
      requirementComplianceOverTime: Array<{
        runId: string;
        compliancePercentages: {
          accessibilityNoViolations: number;
          performanceThreshold: number;
          plainLanguageGrade: number;
          plainLanguageLinks: number;
          completedStatus: number;
        };
      }>;
    };
    const ongoing = JSON.parse(fs.readFileSync(ongoingPath, 'utf8')) as {
      reports: Array<{ targetId: string; suggestions: string[]; pagesNeedingMostImprovement: Array<{ url: string }> }>;
      windowSize: number;
    };

    expect(trends.latest.totalViolations).toBe(5);
    expect(trends.deltaFromPrevious).not.toBeNull();
    expect(trends.deltaFromPrevious?.totalViolations).toBe(2);
    expect(trends.rollingAverage.violationsPerPage).toBeGreaterThan(0);
    expect(trends.windowSize).toBe(2);
    expect(Array.isArray(trends.latest.providerAttributionTop)).toBe(true);
    expect(trends.latest.urlFreshness.newUrls).toBeGreaterThanOrEqual(0);
    expect(trends.latest.urlFreshness.carriedOverUrls).toBeGreaterThanOrEqual(0);
    expect(trends.latest.urlFreshness.newUrlPercent).toBeGreaterThanOrEqual(0);
    expect(trends.latest.urlFreshness.newUrlPercent).toBeLessThanOrEqual(100);
    expect(Array.isArray(trends.requirementComplianceOverTime)).toBe(true);
    expect(trends.requirementComplianceOverTime.length).toBeGreaterThan(0);
    expect(trends.requirementComplianceOverTime[0].runId).toBeTruthy();
    expect(typeof trends.requirementComplianceOverTime[0].compliancePercentages.completedStatus).toBe('number');
    expect(ongoing.windowSize).toBeGreaterThan(0);
    expect(Array.isArray(ongoing.reports)).toBe(true);
    expect(ongoing.reports.length).toBeGreaterThan(0);
    expect(ongoing.reports[0].targetId).toBeTruthy();
    expect(Array.isArray(ongoing.reports[0].suggestions)).toBe(true);
  });

  it('recovers from malformed index.json content', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-history-invalid-json-'));
    process.chdir(tmpDir);

    const runsDir = path.resolve(tmpDir, 'dist/runs');
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(path.join(runsDir, 'index.json'), '{ not-valid-json', 'utf8');

    const entry = RunHistoryReporter.persistRunHistory([makeResult('alpha', 1)], 'profiles/us-health.yml', 900);
    const index = JSON.parse(fs.readFileSync(path.join(runsDir, 'index.json'), 'utf8')) as {
      latestRunId: string;
      runs: Array<{ runId: string }>;
    };

    expect(index.latestRunId).toBe(entry.runId);
    expect(index.runs.length).toBe(1);
  });

  it('ignores malformed historical entries and computes zero-page trends safely', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-history-filter-'));
    process.chdir(tmpDir);

    const runsDir = path.resolve(tmpDir, 'dist/runs');
    fs.mkdirSync(runsDir, { recursive: true });

    const seedIndex = {
      updatedAt: new Date().toISOString(),
      latestRunId: 'seed-run',
      runs: [
        {
          runId: 'seed-run',
          generatedAt: new Date().toISOString(),
          profilePath: 'profiles/us-health.yml',
          scanDurationMs: 100,
          targetsScanned: 1,
          pagesScanned: 0,
          totalViolations: 0,
          artifactPath: 'runs/seed-run.json'
        },
        {
          runId: 123,
          generatedAt: null,
          profilePath: {},
          scanDurationMs: 'oops'
        }
      ]
    };

    fs.writeFileSync(path.join(runsDir, 'index.json'), JSON.stringify(seedIndex, null, 2), 'utf8');

    RunHistoryReporter.persistRunHistory([makeResult('alpha', 2)], 'profiles/us-health.yml', 1100);

    const index = JSON.parse(fs.readFileSync(path.join(runsDir, 'index.json'), 'utf8')) as {
      runs: Array<{ runId: string }>;
    };
    const trends = JSON.parse(fs.readFileSync(path.join(runsDir, 'trends.json'), 'utf8')) as {
      latest: { violationsPerPage: number };
      deltaFromPrevious: { violationsPerPage: number } | null;
      rollingAverage: { violationsPerPage: number };
    };

    expect(index.runs.some(r => r.runId === 'seed-run')).toBe(true);
    expect(index.runs.some(r => r.runId === '123')).toBe(false);
    expect(trends.latest.violationsPerPage).toBeGreaterThanOrEqual(0);
    expect(trends.deltaFromPrevious).not.toBeNull();
    expect(trends.deltaFromPrevious?.violationsPerPage).toBeGreaterThanOrEqual(0);
    expect(trends.rollingAverage.violationsPerPage).toBeGreaterThanOrEqual(0);
  });

  it('restores cached history files without clobbering existing run artifacts', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-history-cache-'));
    process.chdir(tmpDir);

    const cacheRunsDir = path.resolve(tmpDir, '.history-cache/runs');
    fs.mkdirSync(cacheRunsDir, { recursive: true });
    fs.writeFileSync(path.join(cacheRunsDir, 'cached-only.json'), JSON.stringify({ from: 'cache' }), 'utf8');
    fs.writeFileSync(path.join(cacheRunsDir, 'shared.json'), JSON.stringify({ from: 'cache' }), 'utf8');
    fs.writeFileSync(path.join(cacheRunsDir, 'ignore.txt'), 'not-json', 'utf8');

    const distRunsDir = path.resolve(tmpDir, 'dist/runs');
    fs.mkdirSync(distRunsDir, { recursive: true });
    fs.writeFileSync(path.join(distRunsDir, 'shared.json'), JSON.stringify({ from: 'dist' }), 'utf8');

    process.env.VITAL_HISTORY_CACHE_DIR = '.history-cache';

    RunHistoryReporter.persistRunHistory([makeResult('alpha', 1)], 'profiles/us-health.yml', 800);

    const cachedOnlyPath = path.join(distRunsDir, 'cached-only.json');
    const sharedPath = path.join(distRunsDir, 'shared.json');
    const ignoredPath = path.join(distRunsDir, 'ignore.txt');

    expect(fs.existsSync(cachedOnlyPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(cachedOnlyPath, 'utf8')).from).toBe('cache');
    expect(JSON.parse(fs.readFileSync(sharedPath, 'utf8')).from).toBe('dist');
    expect(fs.existsSync(ignoredPath)).toBe(false);
  });
});
