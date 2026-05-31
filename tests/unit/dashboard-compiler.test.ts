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
        scanDurationMs: 3133490,
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

    DashboardCompiler.compileStaticDashboard(payload, {
      nonHtmlDiscoveryExclusions: [
        {
          targetId: 'cms-gov',
          url: 'https://example.org/files/guide.pdf',
          reason: 'Excluded non-HTML extension from sitemap URL',
          source: 'sitemap',
          excludedAt: new Date().toISOString()
        }
      ]
    });

    const outputPath = path.resolve(process.cwd(), 'dist/index.html');
    const jsPath = path.resolve(process.cwd(), 'dist/assets/dashboard.js');
    const cssPath = path.resolve(process.cwd(), 'dist/assets/dashboard.css');
    const domainOverviewPath = path.resolve(process.cwd(), 'dist/domains/cms-gov/index.html');
    const domainA11yPath = path.resolve(process.cwd(), 'dist/domains/cms-gov/accessibility.html');
    const domainPerformancePath = path.resolve(process.cwd(), 'dist/domains/cms-gov/performance.html');
    const domainContentPath = path.resolve(process.cwd(), 'dist/domains/cms-gov/content.html');
    const domainThirdPartyPath = path.resolve(process.cwd(), 'dist/domains/cms-gov/third-party.html');
    const failuresPath = path.resolve(process.cwd(), 'dist/failures/index.html');
    const html = fs.readFileSync(outputPath, 'utf8');
    const js = fs.readFileSync(jsPath, 'utf8');
    const css = fs.readFileSync(cssPath, 'utf8');
    const domainOverviewHtml = fs.readFileSync(domainOverviewPath, 'utf8');
    const domainA11yHtml = fs.readFileSync(domainA11yPath, 'utf8');
    const failuresHtml = fs.readFileSync(failuresPath, 'utf8');

    expect(html).toContain('\\u003cscript\\u003ealert(1)\\u003c/script\\u003e');
    expect(html).not.toContain('\"><script>alert(1)</script>');
    expect(html).toContain('assets/dashboard.css');
    expect(html).toContain('assets/dashboard.js');
    expect(html).toContain('vital-dashboard-data');
    expect(html).toContain('vital-dashboard-target-quality');
    expect(html).toContain('href="#run-history"');
    expect(html).toContain('In-page section navigation');
    expect(html).toContain('href="#pages-scanned-latest-run"');
    expect(html).toContain('id="pages-scanned-latest-run"');
    expect(html).toContain('id="run-history-heading"');
    expect(html).toContain('id="blocked-system-issues"');
    expect(html).toContain('Jump to domain page');
    expect(html).toContain('id="domain-page-select"');
    expect(html).toContain('api/index.json');
    expect(html).toContain('failures/index.html');
    expect(html).toContain('github.com/mgifford/vital-core');
    expect(html).toContain('independent open source project');
    expect(html).toContain('not affiliated with, endorsed by, or operated by');
    expect(js).toContain('Federal Quality Index');
    expect(html).toContain('Domains Leaderboard');
    expect(html).toContain('Pages / Estimated Size');
    expect(html).toContain('Recommendations');
    expect(js).toContain('Unique Pages Scanned (All Time)');
    expect(js).toContain('Unique Pages Scanned (This Week)');
    expect(js).toContain('const thisWeek = new Set(currentRunUniquePages);');
    expect(js).toContain('Top Third-Party Providers');
    expect(js).toContain('Consensus Failures');
    expect(js).toContain('Alfa-only Failures');
    expect(js).toContain('Axe-only Failures');
    expect(js).toContain('URL Freshness');
    expect(js).toContain('function formatDateTimeForViewer(value)');
    expect(js).toContain('formatDateTimeForViewer(page.timestamp)');
    expect(js).toContain('formatDateTimeForViewer(run.generatedAt)');
    expect(html).not.toContain('<th>Targets</th>');
    expect(js).not.toContain('targetsCell.textContent = String(run.targetsScanned || 0);');
    expect(js).toContain('Runs Recorded Today');
    expect(js).toContain('Pages Scanned Today');
    expect(js).toContain('Pages Scanned (Retained History)');
    expect(js).toContain('Array.isArray(artifact.results)');
    expect(js).toContain('emptyCell.colSpan = 5;');
    expect(js).toContain('errorCell.colSpan = 5;');
    expect(html).toContain('Pages Scanned (Latest Run)');
    expect(html).toContain('id="pages-status-summary"');
    expect(html).toContain('id="pages-status-guide"');
    expect(html).toContain('SKIPPED_UNCHANGED');
    expect(html).toContain('Show page-level results table');
    expect(html).toContain('id="pages-table"');
    expect(html).toContain('Latest run page-level scan results by domain, URL, and status.');
    expect(html).toContain('Blocked System Issues (Latest Run)');
    expect(html).toContain('id="blocked-issues-table"');
    expect(html).toContain('Open failures and skips view');
    expect(js).toContain('function renderBlockedIssues()');
    expect(js).toContain('function renderPagesStatusSummary(latestPages)');
    expect(js).toContain('Latest run summary: ');
    expect(js).toContain('renderPagesStatusSummary(latestPages);');
    expect(js).toContain('No blocked, timeout, or failed pages in the latest run.');
    expect(js).toContain('Total Accessibility Violations');
    expect(html).toContain('Detected Software (Latest Run)');
    expect(html).toContain('id="software-table"');
    expect(html).toContain('Detected On URLs');
    expect(html).toContain('Domain Ongoing Reports');
    expect(html).toContain('Pages Needing Most Improvement');
    expect(js).toContain('runs/domain-ongoing.json');
    expect(js).toContain('runs/top-task-seeds.json');
    expect(js).toContain('Estimated size: ~');
    expect(js).toContain('estimateDomainCompletion');
    expect(js).toContain('THROTTLED_WEEKLY_SCAN_HOURS');
    expect(js).toContain('formatEtaHours');
    expect(js).toContain('Coverage: ');
    expect(js).toContain('data-progress-fill-target-id');
    expect(js).toContain('data-progress-meta-target-id');
    expect(js).toContain('function toDomainIdSegment(targetId)');
    expect(js).toContain("link.href = 'domains/' + domainIdSegment + '/' + item[1]");
    expect(js).toContain('function populateDomainSelectMenu(targets)');
    expect(js).toContain("domainPageSelectEl.addEventListener('change'");
    expect(js).toContain("window.location.href = selected");
    expect(js).toContain('function renderSoftwareDetections()');
    expect(js).toContain('softwareDetectedByName');
    expect(js).toContain('existing.urls.add(pageUrl)');
    expect(js).toContain("link.target = '_blank'");
    expect(js).toContain("link.rel = 'noopener noreferrer'");
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
    expect(domainOverviewHtml).toContain('Domain Reports');
    expect(domainOverviewHtml).toContain('Domain overview');
    expect(domainOverviewHtml).toContain('independent open source project');
    expect(domainOverviewHtml).toContain('Scan duration (latest run):</strong> 52m 14s');
    expect(js).toContain('durationCell.textContent = Number.isFinite(durationMs) ? formatDuration(durationMs) : \'n/a\';');
    expect(domainA11yHtml).toContain('Accessibility Findings');
    expect(failuresHtml).toContain('Failures, Timeouts, and Skipped Pages');
    expect(failuresHtml).toContain('Failed/WAF/Timeout');
    expect(failuresHtml).toContain('PDF/DOCX URLs Seen');
    expect(failuresHtml).toContain('Excluded at Discovery (Non-HTML)');
    expect(failuresHtml).toContain('EXCLUDED_AT_DISCOVERY');
    expect(failuresHtml).toContain('Back to main dashboard');
    expect(fs.existsSync(domainPerformancePath)).toBe(true);
    expect(fs.existsSync(domainContentPath)).toBe(true);
    expect(fs.existsSync(domainThirdPartyPath)).toBe(true);
    expect(fs.existsSync(failuresPath)).toBe(true);
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
