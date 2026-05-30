import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { DashboardCompiler } from '../../src/engine/reporters/dashboard-compiler';
import { TargetScanResult } from '../../src/types/site-quality-spec';

describe('DashboardCompiler', () => {
  it('escapes embedded payload data before writing dashboard script data', () => {
    const payload: TargetScanResult[] = [
      {
        targetId: 'cms-gov',
        domain: 'https://example.org\"><script>alert(1)</script>',
        scanDurationMs: 1000,
        pagesScanned: [
          {
            url: 'https://example.org',
            timestamp: new Date().toISOString(),
            status: 'COMPLETED',
            errorMessage: null,
            technologyStack: [],
            liveAudits: { lighthouse: null, accessibilityViolations: [] },
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
      }
    ];

    DashboardCompiler.compileStaticDashboard(payload);

    const outputPath = path.resolve(process.cwd(), 'dist/index.html');
    const jsPath = path.resolve(process.cwd(), 'dist/assets/dashboard.js');
    const cssPath = path.resolve(process.cwd(), 'dist/assets/dashboard.css');
    const html = fs.readFileSync(outputPath, 'utf8');
    const js = fs.readFileSync(jsPath, 'utf8');
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(html).toContain('\\u003cscript\\u003ealert(1)\\u003c/script\\u003e');
    expect(html).not.toContain('\"><script>alert(1)</script>');
    expect(html).toContain('assets/dashboard.css');
    expect(html).toContain('assets/dashboard.js');
    expect(html).toContain('vital-dashboard-data');
    expect(html).toContain('vital-dashboard-target-quality');
    expect(js).toContain('Federal Quality Index');
    expect(html).toContain('Domains Leaderboard');
    expect(html).toContain('Pages / Estimated Size');
    expect(html).toContain('Recommendations');
    expect(js).toContain('Unique Pages Scanned (All Time)');
    expect(js).toContain('Unique Pages Scanned (This Week)');
    expect(js).toContain('Top Third-Party Providers');
    expect(js).toContain('URL Freshness');
    expect(html).toContain('Domain Ongoing Reports');
    expect(html).toContain('Pages Needing Most Improvement');
    expect(js).toContain('runs/domain-ongoing.json');
    expect(js).toContain('runs/top-task-seeds.json');
    expect(js).toContain('Estimated size: ~');
    expect(js).toContain('estimateDomainCompletion');
    expect(js).toContain('formatEtaHours');
    expect(js).toContain('Coverage: ');
    expect(js).toContain('data-progress-fill-target-id');
    expect(js).toContain('data-progress-meta-target-id');
    expect(css).toContain('.progress-track');
    expect(css).toContain('.progress-fill');
    expect(js).toContain("lighthouseLabel.textContent = 'Lighthouse: '");
    expect(js).toContain("{ label: 'Perf', key: 'performance'");
    expect(js).toContain('fetchJsonWithRetry');
    expect(js).toContain('api.github.com/repos/');
    expect(html).toContain('Lighthouse thresholds used for color cues');
    expect(html).toContain('Perf (green ≥ 90, amber 70-89, red &lt; 70)');
    expect(html).toContain('SI (green ≤ 3400ms, amber 3401-5800ms, red &gt; 5800ms)');
    expect(html).toContain('Requirement Compliance Over Time');
    expect(html).toContain('compliance-chart');
    expect(js).toContain('requirementComplianceOverTime');
    expect(html).toContain('Live Scan Ticker');
    expect(css).toContain('.compliance-chart');
  });

  it('renders Lighthouse threshold legend in both leaderboard and ongoing sections', () => {
    const payload: TargetScanResult[] = [
      {
        targetId: 'legend-check',
        domain: 'https://example.gov',
        scanDurationMs: 2000,
        pagesScanned: [
          {
            url: 'https://example.gov/page',
            timestamp: new Date().toISOString(),
            status: 'COMPLETED',
            errorMessage: null,
            technologyStack: [],
            liveAudits: {
              lighthouse: {
                performanceScore: 92,
                energyEstimateKwh: null,
                firstContentfulPaintMs: 1300,
                largestContentfulPaintMs: 2200,
                speedIndexMs: 2900
              },
              accessibilityViolations: []
            },
            offlineAudits: {
              overlayDetected: { found: false, provider: null, evidence: null },
              designSystem: { usesUSWDS: true, versionDetected: '3.x' },
              contentMetrics: {
                readabilityScore: 65,
                suspiciousAltTextCount: 0,
                suspiciousAltInstances: []
              },
              linkHealth: { totalChecked: 0, brokenCount: 0, brokenLinks: [] }
            }
          }
        ]
      }
    ];

    DashboardCompiler.compileStaticDashboard(payload);

    const outputPath = path.resolve(process.cwd(), 'dist/index.html');
    const html = fs.readFileSync(outputPath, 'utf8');

    expect(html).toContain('Lighthouse thresholds used for color cues');
    expect(html).toContain('FCP (green ≤ 1800ms, amber 1801-3000ms, red &gt; 3000ms)');
    expect(html).toContain('LCP (green ≤ 2500ms, amber 2501-4000ms, red &gt; 4000ms)');

    const legendMatches = html.match(/Lighthouse thresholds used for color cues/g) || [];
    expect(legendMatches.length).toBe(2);
  });
});
