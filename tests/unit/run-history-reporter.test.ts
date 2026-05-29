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
    const artifactPath = path.resolve(tmpDir, 'dist', entry.artifactPath);

    expect(fs.existsSync(latestPath)).toBe(true);
    expect(fs.existsSync(indexPath)).toBe(true);
    expect(fs.existsSync(trendsPath)).toBe(true);
    expect(fs.existsSync(artifactPath)).toBe(true);

    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as { runs: Array<{ runId: string; totalViolations: number; pagesScanned: number }> };

    expect(index.runs.length).toBe(2);
    expect(index.runs[0].runId).toBeTruthy();

    const trends = JSON.parse(fs.readFileSync(trendsPath, 'utf8')) as {
      latest: { totalViolations: number };
      deltaFromPrevious: { totalViolations: number } | null;
      rollingAverage: { violationsPerPage: number };
      windowSize: number;
    };

    expect(trends.latest.totalViolations).toBe(5);
    expect(trends.deltaFromPrevious).not.toBeNull();
    expect(trends.deltaFromPrevious?.totalViolations).toBe(2);
    expect(trends.rollingAverage.violationsPerPage).toBeGreaterThan(0);
    expect(trends.windowSize).toBe(2);
  });
});
