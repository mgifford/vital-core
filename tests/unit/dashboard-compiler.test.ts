import * as fs from 'fs';
import * as os from 'os';
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
    const domainRunHistoryPath = path.resolve(process.cwd(), 'dist/domains/cms-gov/run-history.html');
    const failuresPath = path.resolve(process.cwd(), 'dist/failures/index.html');
    const html = fs.readFileSync(outputPath, 'utf8');
    const js = fs.readFileSync(jsPath, 'utf8');
    const css = fs.readFileSync(cssPath, 'utf8');
    const domainOverviewHtml = fs.readFileSync(domainOverviewPath, 'utf8');
    const domainA11yHtml = fs.readFileSync(domainA11yPath, 'utf8');
    const domainRunHistoryHtml = fs.readFileSync(domainRunHistoryPath, 'utf8');
    const failuresHtml = fs.readFileSync(failuresPath, 'utf8');

    expect(html).not.toContain('\"><script>alert(1)</script>');
    expect(html).toContain('assets/dashboard.css');
    expect(html).toContain('assets/dashboard.js');
    expect(html).not.toContain('vital-dashboard-data');
    expect(html).not.toContain('vital-dashboard-target-quality');
    expect(domainOverviewHtml).not.toContain('\"><script>alert(1)</script>');
    expect(domainOverviewHtml).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(domainOverviewHtml).toContain('<a href="index.html">Domain overview</a> |');
    expect(domainOverviewHtml).toContain('<a href="accessibility.html">Accessibility</a> |');
    expect(domainOverviewHtml).toContain('<a href="performance.html">Performance</a> |');
    expect(domainOverviewHtml).toContain('<a href="content.html">Content</a> |');
    expect(domainOverviewHtml).toContain('<a href="third-party.html">Third-party impact</a>');
    expect(domainOverviewHtml).not.toContain('Main dashboard');
    expect(domainOverviewHtml).not.toContain('accessibility.html#run-history');
    expect(domainOverviewHtml).toContain('run-history.html');
    expect(domainA11yHtml).not.toContain('id="run-history"');
    expect(domainRunHistoryHtml).toContain('<h2>Run History</h2>');
    expect(html).toContain('href="#run-history"');
    expect(html).toContain('In-page section navigation');
    expect(html).toContain('href="#pages-scanned-latest-run"');
    expect(html).toContain('href="#detected-software-latest-run"');
    expect(html).toContain('id="pages-scanned-latest-run"');
    expect(html).toContain('id="run-history-heading"');
    expect(html).toContain('id="blocked_system_issues"');
    expect(html).toContain('Jump to domain page');
    expect(html).toContain('id="domain-page-select"');
    expect(html).toContain('api/index.json');
    expect(html).toContain('runs/software-by-domain.json');
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
    expect(html).toContain('id="blocked_issues_table"');
    expect(html).toContain('id="blocked-issues-summary"');
    expect(html).toContain('id="blocked-issues-breakdown"');
    expect(html).toContain('How to triage blocked issue statuses');
    expect(html).toContain('Open failures and skips view');
    expect(js).toContain('function renderBlockedIssues()');
    expect(js).toContain('function renderPagesStatusSummary(latestPages)');
    expect(js).toContain('blocked system issue(s) were recorded in the latest run');
    expect(js).toContain('Review blocked issue details and reasons');
    expect(js).toContain('Open page-level scan details');
    expect(js).toContain('Latest run summary: ');
    expect(js).toContain('renderPagesStatusSummary(latestPages);');
    expect(js).toContain('No blocked, timeout, or failed pages in the latest run.');
    expect(js).toContain('Total Accessibility Violations');
    expect(html).toContain('Detected Software (Latest Run)');
    expect(html).toContain('id="software-table"');
    expect(html).toContain('Technology detected in the latest run, aggregated by domain.');
    expect(html).toContain('Technologies Detected');
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
    expect(js).toContain('softwareByDomain');
    expect(js).toContain('function formatLimitedList(values, maxItems)');
    expect(js).toContain("String(item.targetId || 'n/a').toUpperCase()");
    expect(css).toContain('.progress-track');
    expect(css).toContain('.progress-fill');
    expect(js).toContain("lighthouseLabel.textContent = 'Lighthouse: '");
    expect(js).toContain("{ label: 'Perf', key: 'performance'");
    expect(js).toContain('fetchJsonWithRetry');
    expect(js).toContain('runs/latest-summary.json');
    expect(js).not.toContain('readEmbeddedJson');
    expect(js).toContain('api.github.com/repos/');
    expect(fs.existsSync(path.resolve(process.cwd(), 'dist/runs/latest-summary.json'))).toBe(true);
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
    expect(domainA11yHtml).toContain('Accessibility Scan Report');
    expect(domainA11yHtml).toContain('Summary');
    expect(domainA11yHtml).toContain('api/issues-last-week/targets/cms-gov.json');
    expect(domainA11yHtml).toContain('api/issues-last-week/index.json');
    expect(domainA11yHtml).toContain('data-filter-sev="all"');
    expect(domainA11yHtml).toContain('data-filter-tool="all"');
    expect(domainA11yHtml).toContain('data-filter-tool="axe"');
    expect(domainA11yHtml).toContain('data-filter-tool="alfa"');
    expect(domainA11yHtml).toContain('data-filter-wcag="all"');
    expect(domainA11yHtml).toContain('data-filter-wcag="2.0"');
    expect(domainA11yHtml).toContain('data-filter-wcag="2.1"');
    expect(domainA11yHtml).toContain('data-filter-wcag="2.2"');
    expect(domainA11yHtml).toContain('data-filter-sev');
    expect(domainA11yHtml).toContain('applyFilters');
    expect(failuresHtml).toContain('Failures, Timeouts, and Skipped Pages');
    expect(failuresHtml).toContain('Failed/WAF/Timeout');
    expect(failuresHtml).toContain('PDF/DOCX URLs Seen');
    expect(failuresHtml).toContain('Excluded at Discovery (Non-HTML)');
    expect(failuresHtml).toContain('EXCLUDED_AT_DISCOVERY');
    expect(failuresHtml).toContain('Back to main dashboard');
    expect(fs.existsSync(domainPerformancePath)).toBe(true);
    expect(fs.existsSync(domainContentPath)).toBe(true);
    expect(fs.existsSync(domainThirdPartyPath)).toBe(true);
    expect(fs.existsSync(domainRunHistoryPath)).toBe(true);
    expect(fs.existsSync(failuresPath)).toBe(true);
  });

  it('stores page-level axe and alfa overlap counts in the latest summary artifact', () => {
    const payload: TargetScanResult[] = [
      {
        targetId: 'cms-gov',
        domain: 'https://example.gov',
        scanDurationMs: 1234,
        pagesScanned: [
          {
            url: 'https://example.gov/page',
            timestamp: new Date().toISOString(),
            status: 'COMPLETED',
            errorMessage: null,
            technologyStack: [],
            liveAudits: {
              lighthouse: null,
              accessibilityViolations: [
                {
                  id: 'document-title',
                  severity: 'serious',
                  description: 'Documents must have titles',
                  helpUrl: 'https://example.org/help/document-title',
                  impactedCriteria: ['wcag2a'],
                  sourceEngine: 'axe',
                  instances: [{ html: '<html>', target: ['html'], failureSummary: 'Missing title' }]
                },
                {
                  id: 'color-contrast',
                  severity: 'serious',
                  description: 'Text needs contrast',
                  helpUrl: 'https://example.org/help/color-contrast',
                  impactedCriteria: ['wcag2aa'],
                  sourceEngine: 'axe',
                  instances: [{ html: '<p>', target: ['p'], failureSummary: 'Low contrast' }]
                },
                {
                  id: 'sia-r1',
                  severity: 'serious',
                  description: 'Documents should have a title',
                  helpUrl: 'https://alfa.siteimprove.com/rules/sia-r1',
                  impactedCriteria: ['wcag2a'],
                  sourceEngine: 'alfa',
                  instances: [{ html: '<html>', target: ['html'], failureSummary: 'Missing title' }]
                },
                {
                  id: 'sia-r6',
                  severity: 'moderate',
                  description: 'Decorative image should be ignored',
                  helpUrl: 'https://alfa.siteimprove.com/rules/sia-r6',
                  impactedCriteria: ['wcag2a'],
                  sourceEngine: 'alfa',
                  instances: [{ html: '<img>', target: ['img'], failureSummary: 'Decorative image issue' }]
                }
              ]
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
      }
    ];

    DashboardCompiler.compileStaticDashboard(payload);

    const latestSummaryPath = path.resolve(process.cwd(), 'dist/runs/latest-summary.json');
    const latestSummary = JSON.parse(fs.readFileSync(latestSummaryPath, 'utf8'));
    const latestPage = latestSummary.targets[0].pagesScanned[0];

    expect(latestPage.consensusSummary).toEqual({
      consensusFailure: 1,
      alfaOnlyFailure: 1,
      axeOnlyFailure: 1,
      totalCorrelatedFindings: 3
    });

    const jsPath = path.resolve(process.cwd(), 'dist/assets/dashboard.js');
    const js = fs.readFileSync(jsPath, 'utf8');
    expect(js).toContain('unique patterns •');
    expect(js).toContain('axe-only');
    expect(js).toContain('alfa-only');
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

  it('renders all Lighthouse metrics (Perf, Accessibility, SEO, Best Practices, Agentic) on performance page', () => {
    const payload: TargetScanResult[] = [
      {
        targetId: 'metrics-test',
        domain: 'https://metrics-example.gov',
        scanDurationMs: 1500,
        pagesScanned: [
          {
            url: 'https://metrics-example.gov/page1',
            timestamp: new Date().toISOString(),
            status: 'COMPLETED',
            errorMessage: null,
            technologyStack: [],
            liveAudits: {
              lighthouse: {
                performanceScore: 85,
                energyEstimateKwh: null,
                firstContentfulPaintMs: 1500,
                largestContentfulPaintMs: 2800,
                speedIndexMs: 3100,
                accessibilityScore: 92,
                seoScore: 88,
                bestPracticesScore: 79,
                agenticScore: 75
              },
              accessibilityViolations: []
            },
            offlineAudits: {
              overlayDetected: { found: false, provider: null, evidence: null },
              designSystem: { usesUSWDS: true, versionDetected: '3.x' },
              contentMetrics: {
                readabilityScore: 70,
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

    const performancePath = path.resolve(process.cwd(), 'dist/domains/metrics-test/performance.html');
    const performanceHtml = fs.readFileSync(performancePath, 'utf8');

    // Verify all metric column headers are present
    expect(performanceHtml).toContain('Perf (0-100)');
    expect(performanceHtml).toContain('Accessibility (0-100)');
    expect(performanceHtml).toContain('SEO (0-100)');
    expect(performanceHtml).toContain('Best Practices (0-100)');
    expect(performanceHtml).toContain('Agentic (0-100)');
    expect(performanceHtml).toContain('FCP (ms)');
    expect(performanceHtml).toContain('LCP (ms)');
    expect(performanceHtml).toContain('Speed Index (ms)');

    // Verify the actual metric values are rendered
    expect(performanceHtml).toContain('85');  // Performance score
    expect(performanceHtml).toContain('92');  // Accessibility score
    expect(performanceHtml).toContain('88');  // SEO score
    expect(performanceHtml).toContain('79');  // Best Practices score
    expect(performanceHtml).toContain('75');  // Agentic score
  });

  it('renders source engine badges and multi-filter bars on the accessibility page', () => {
    const payload: TargetScanResult[] = [
      {
        targetId: 'engine-badge-test',
        domain: 'https://engine-test.gov',
        scanDurationMs: 1000,
        pagesScanned: [
          {
            url: 'https://engine-test.gov/page',
            timestamp: new Date().toISOString(),
            status: 'COMPLETED',
            errorMessage: null,
            technologyStack: [],
            liveAudits: {
              lighthouse: null,
              accessibilityViolations: [
                {
                  id: 'color-contrast',
                  severity: 'serious',
                  description: 'Elements must meet minimum color contrast ratio thresholds',
                  helpUrl: 'https://dequeuniversity.com/rules/axe/4.6/color-contrast',
                  impactedCriteria: ['wcag2aa', 'wcag21aa'],
                  wcagVersion: '2.0',
                  sourceEngine: 'axe',
                  instances: [{ html: '<a href="#">link</a>', target: ['a'], failureSummary: 'Fix contrast' }]
                },
                {
                  id: 'sia-r69',
                  severity: 'serious',
                  description: 'Element has sufficient color contrast',
                  helpUrl: 'https://alfa.siteimprove.com/rules/sia-r69',
                  impactedCriteria: ['wcag2aa'],
                  wcagVersion: '2.0',
                  sourceEngine: 'alfa',
                  instances: [{ html: '<p>low contrast</p>', target: ['p'], failureSummary: 'Fix contrast' }]
                },
                {
                  id: 'sia-r42',
                  severity: 'critical',
                  description: 'Image has name',
                  helpUrl: 'https://alfa.siteimprove.com/rules/sia-r42',
                  impactedCriteria: ['wcag2aa'],
                  wcagVersion: '2.1',
                  sourceEngine: 'alfa',
                  instances: [{ html: '<img src="x.png">', target: ['img'], failureSummary: 'Add alt' }]
                }
              ]
            },
            offlineAudits: null
          }
        ]
      }
    ];

    DashboardCompiler.compileStaticDashboard(payload);

    const a11yPath = path.resolve(process.cwd(), 'dist/domains/engine-badge-test/accessibility.html');
    const a11yHtml = fs.readFileSync(a11yPath, 'utf8');

    // Filter bars for tool and WCAG version must be present
    expect(a11yHtml).toContain('data-filter-tool="axe"');
    expect(a11yHtml).toContain('data-filter-tool="alfa"');
    expect(a11yHtml).toContain('data-filter-wcag="2.0"');
    expect(a11yHtml).toContain('data-filter-wcag="2.1"');

    // Rule cards must have data-sources and data-wcag attributes
    expect(a11yHtml).toContain('data-sources="axe"');
    expect(a11yHtml).toContain('data-sources="alfa"');

    // Source engine badges must be present
    expect(a11yHtml).toContain('source-axe');
    expect(a11yHtml).toContain('source-alfa');

    // Multi-filter JS must be present
    expect(a11yHtml).toContain('applyFilters');
    expect(a11yHtml).toContain('data-filter-sev');
  });

  it('reports top pages by total instances and shows top rules', () => {
    const payload: TargetScanResult[] = [
      {
        targetId: 'top-pages-test',
        domain: 'https://example.gov',
        scanDurationMs: 1000,
        pagesScanned: [
          {
            url: 'https://example.gov/page-a',
            timestamp: new Date().toISOString(),
            status: 'COMPLETED',
            errorMessage: null,
            technologyStack: [],
            liveAudits: {
              lighthouse: null,
              accessibilityViolations: [
                {
                  id: 'rule-a',
                  severity: 'serious',
                  description: 'Rule A',
                  helpUrl: 'https://example.gov/rule-a',
                  impactedCriteria: ['wcag2aa'],
                  wcagVersion: '2.0',
                  sourceEngine: 'axe',
                  instances: [
                    { html: '<a></a>', target: ['a:nth-child(1)'], failureSummary: 'Fix A1' },
                    { html: '<a></a>', target: ['a:nth-child(2)'], failureSummary: 'Fix A2' },
                    { html: '<a></a>', target: ['a:nth-child(3)'], failureSummary: 'Fix A3' }
                  ]
                },
                {
                  id: 'rule-b',
                  severity: 'moderate',
                  description: 'Rule B',
                  helpUrl: 'https://example.gov/rule-b',
                  impactedCriteria: ['best-practice'],
                  wcagVersion: 'best-practice',
                  sourceEngine: 'alfa',
                  instances: [
                    { html: '<button></button>', target: ['button'], failureSummary: 'Fix B1' },
                    { html: '<button></button>', target: ['button.icon'], failureSummary: 'Fix B2' }
                  ]
                }
              ]
            },
            offlineAudits: null
          },
          {
            url: 'https://example.gov/page-b',
            timestamp: new Date().toISOString(),
            status: 'COMPLETED',
            errorMessage: null,
            technologyStack: [],
            liveAudits: {
              lighthouse: null,
              accessibilityViolations: [
                {
                  id: 'rule-c',
                  severity: 'serious',
                  description: 'Rule C',
                  helpUrl: 'https://example.gov/rule-c',
                  impactedCriteria: ['wcag2aa'],
                  wcagVersion: '2.0',
                  sourceEngine: 'axe',
                  instances: [
                    { html: '<img>', target: ['img'], failureSummary: 'Fix C1' }
                  ]
                }
              ]
            },
            offlineAudits: null
          }
        ]
      }
    ];

    DashboardCompiler.compileStaticDashboard(payload);

    const a11yPath = path.resolve(process.cwd(), 'dist/domains/top-pages-test/accessibility.html');
    const a11yHtml = fs.readFileSync(a11yPath, 'utf8');

    expect(a11yHtml).toContain('<th>Instances</th>');
    expect(a11yHtml).toContain('<th>Top rules</th>');
    expect(a11yHtml).toContain('https://example.gov/page-a');
    expect(a11yHtml).toContain('<td>5</td>');
    expect(a11yHtml).toContain('<code>rule-a</code> (3)');
    expect(a11yHtml).toContain('<code>rule-b</code> (2)');
  });

  it('back-fills lighthouse/content/third-party data from history for SKIPPED_UNCHANGED pages', () => {
    const historyCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-history-'));
    fs.mkdirSync(path.join(historyCacheDir, 'runs'), { recursive: true });

    const historicalRun = {
      results: [
        {
          targetId: 'perf-backfill',
          domain: 'https://backfill.gov',
          scanDurationMs: 1000,
          pagesScanned: [
            {
              url: 'https://backfill.gov/page',
              timestamp: '2024-01-01T00:00:00.000Z',
              status: 'COMPLETED',
              errorMessage: null,
              technologyStack: [],
              liveAudits: {
                lighthouse: {
                  performanceScore: 88,
                  energyEstimateKwh: null,
                  firstContentfulPaintMs: 1500,
                  largestContentfulPaintMs: 2400,
                  speedIndexMs: 3000
                },
                accessibilityViolations: []
              },
              offlineAudits: {
                overlayDetected: { found: false, provider: null, evidence: null },
                designSystem: { usesUSWDS: false, versionDetected: null },
                contentMetrics: {
                  readabilityScore: 70,
                  fleschKincaidGrade: 9.5,
                  averageSentenceLength: 18,
                  ambiguousLinkTextCount: 2,
                  suspiciousAltTextCount: 1,
                  suspiciousAltInstances: []
                },
                linkHealth: { totalChecked: 0, brokenCount: 0, brokenLinks: [] }
              },
              thirdPartyImpact: {
                evaluated: true,
                triggeredBy: ['Tag manager'],
                regressionDetected: false,
                baselineViolationCount: 0,
                jsDisabledViolationCount: 0,
                addedByJavaScriptCount: 0,
                removedByJavaScriptCount: 0,
                highRiskRules: [],
                providerAttribution: [],
                likelyIntroducedByProviders: ['Google Tag Manager'],
                ruleToLikelyProviders: [],
                ruleToProviderAttribution: []
              }
            }
          ]
        }
      ]
    };
    // Write via index + artifact (the format produced by fetch-history.mjs).
    const runId = '2024-01-01T00-00-00-000Z';
    const artifactPath = `runs/${runId}.json`;
    fs.writeFileSync(path.join(historyCacheDir, 'runs', `${runId}.json`), JSON.stringify(historicalRun), 'utf8');
    fs.writeFileSync(
      path.join(historyCacheDir, 'runs', 'index.json'),
      JSON.stringify({ updatedAt: '2024-01-01T00:00:00.000Z', latestRunId: runId, runs: [{ runId, artifactPath }] }),
      'utf8'
    );

    const originalEnv = process.env.VITAL_HISTORY_CACHE_DIR;
    try {
      process.env.VITAL_HISTORY_CACHE_DIR = historyCacheDir;

      const payload: TargetScanResult[] = [
        {
          targetId: 'perf-backfill',
          domain: 'https://backfill.gov',
          scanDurationMs: 500,
          pagesScanned: [
            {
              url: 'https://backfill.gov/page',
              timestamp: new Date().toISOString(),
              status: 'SKIPPED_UNCHANGED',
              errorMessage: 'Content unchanged since last scan.',
              technologyStack: [],
              liveAudits: null,
              offlineAudits: null
            }
          ]
        }
      ];

      DashboardCompiler.compileStaticDashboard(payload);

      const perfHtml = fs.readFileSync(
        path.resolve(process.cwd(), 'dist/domains/perf-backfill/performance.html'),
        'utf8'
      );
      const contentHtml = fs.readFileSync(
        path.resolve(process.cwd(), 'dist/domains/perf-backfill/content.html'),
        'utf8'
      );
      const thirdPartyHtml = fs.readFileSync(
        path.resolve(process.cwd(), 'dist/domains/perf-backfill/third-party.html'),
        'utf8'
      );

      expect(perfHtml).toContain('88');
      expect(perfHtml).toContain('1500');
      expect(perfHtml).not.toContain('No performance data available');
      expect(contentHtml).toContain('9.5');
      expect(contentHtml).not.toContain('No content metrics available');
      expect(thirdPartyHtml).toContain('Google Tag Manager');
      expect(thirdPartyHtml).not.toContain('No third-party impact data available');
    } finally {
      process.env.VITAL_HISTORY_CACHE_DIR = originalEnv;
      fs.rmSync(historyCacheDir, { recursive: true, force: true });
    }
  });

  it('back-fills lighthouse/content/third-party data from history for accessibility-only run pages', () => {
    const historyCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-history-a11y-'));
    fs.mkdirSync(path.join(historyCacheDir, 'runs'), { recursive: true });

    const historicalRun = {
      results: [
        {
          targetId: 'a11y-only-domain',
          domain: 'https://a11y-only.gov',
          scanDurationMs: 1000,
          pagesScanned: [
            {
              url: 'https://a11y-only.gov/page',
              timestamp: '2024-01-01T00:00:00.000Z',
              status: 'COMPLETED',
              errorMessage: null,
              technologyStack: [],
              liveAudits: {
                lighthouse: {
                  performanceScore: 75,
                  energyEstimateKwh: null,
                  firstContentfulPaintMs: 2100,
                  largestContentfulPaintMs: 3200,
                  speedIndexMs: 4100
                },
                accessibilityViolations: []
              },
              offlineAudits: {
                overlayDetected: { found: false, provider: null, evidence: null },
                designSystem: { usesUSWDS: false, versionDetected: null },
                contentMetrics: {
                  readabilityScore: 55,
                  fleschKincaidGrade: 12.3,
                  averageSentenceLength: 22,
                  ambiguousLinkTextCount: 5,
                  suspiciousAltTextCount: 0,
                  suspiciousAltInstances: []
                },
                linkHealth: { totalChecked: 0, brokenCount: 0, brokenLinks: [] }
              },
              thirdPartyImpact: {
                evaluated: false,
                triggeredBy: [],
                regressionDetected: false,
                baselineViolationCount: 0,
                jsDisabledViolationCount: 0,
                addedByJavaScriptCount: 0,
                removedByJavaScriptCount: 0,
                highRiskRules: [],
                providerAttribution: [],
                likelyIntroducedByProviders: [],
                ruleToLikelyProviders: [],
                ruleToProviderAttribution: []
              }
            }
          ]
        }
      ]
    };
    // Write via index + artifact (the format produced by fetch-history.mjs).
    const runId = '2024-01-01T00-00-00-000Z';
    const artifactPath = `runs/${runId}.json`;
    fs.writeFileSync(path.join(historyCacheDir, 'runs', `${runId}.json`), JSON.stringify(historicalRun), 'utf8');
    fs.writeFileSync(
      path.join(historyCacheDir, 'runs', 'index.json'),
      JSON.stringify({ updatedAt: '2024-01-01T00:00:00.000Z', latestRunId: runId, runs: [{ runId, artifactPath }] }),
      'utf8'
    );

    const originalEnv = process.env.VITAL_HISTORY_CACHE_DIR;
    try {
      process.env.VITAL_HISTORY_CACHE_DIR = historyCacheDir;

      // Simulate an accessibility-only COMPLETED page: liveAudits is set (axe ran)
      // but lighthouse is null, offlineAudits is null, thirdPartyImpact is null.
      const payload: TargetScanResult[] = [
        {
          targetId: 'a11y-only-domain',
          domain: 'https://a11y-only.gov',
          scanDurationMs: 600,
          pagesScanned: [
            {
              url: 'https://a11y-only.gov/page',
              timestamp: new Date().toISOString(),
              status: 'COMPLETED',
              errorMessage: null,
              technologyStack: [],
              liveAudits: { lighthouse: null, accessibilityViolations: [] },
              offlineAudits: null
            }
          ]
        }
      ];

      DashboardCompiler.compileStaticDashboard(payload);

      const perfHtml = fs.readFileSync(
        path.resolve(process.cwd(), 'dist/domains/a11y-only-domain/performance.html'),
        'utf8'
      );
      const contentHtml = fs.readFileSync(
        path.resolve(process.cwd(), 'dist/domains/a11y-only-domain/content.html'),
        'utf8'
      );

      expect(perfHtml).toContain('75');
      expect(perfHtml).toContain('2100');
      expect(perfHtml).not.toContain('No performance data available');
      expect(contentHtml).toContain('12.3');
      expect(contentHtml).not.toContain('No content metrics available');
    } finally {
      process.env.VITAL_HISTORY_CACHE_DIR = originalEnv;
      fs.rmSync(historyCacheDir, { recursive: true, force: true });
    }
  });

  it('falls back to latest.json when no index.json is present in the history cache', () => {
    const historyCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-history-legacy-'));
    fs.mkdirSync(path.join(historyCacheDir, 'runs'), { recursive: true });

    const historicalRun = {
      results: [
        {
          targetId: 'legacy-domain',
          domain: 'https://legacy.gov',
          scanDurationMs: 1000,
          pagesScanned: [
            {
              url: 'https://legacy.gov/page',
              timestamp: '2024-01-01T00:00:00.000Z',
              status: 'COMPLETED',
              errorMessage: null,
              technologyStack: [],
              liveAudits: {
                lighthouse: { performanceScore: 60, energyEstimateKwh: null, firstContentfulPaintMs: 1800, largestContentfulPaintMs: 2900, speedIndexMs: 3500 },
                accessibilityViolations: []
              },
              offlineAudits: null
            }
          ]
        }
      ]
    };
    // Write ONLY latest.json (legacy format – no index.json).
    fs.writeFileSync(path.join(historyCacheDir, 'runs', 'latest.json'), JSON.stringify(historicalRun), 'utf8');

    const originalEnv = process.env.VITAL_HISTORY_CACHE_DIR;
    try {
      process.env.VITAL_HISTORY_CACHE_DIR = historyCacheDir;

      const payload: TargetScanResult[] = [
        {
          targetId: 'legacy-domain',
          domain: 'https://legacy.gov',
          scanDurationMs: 500,
          pagesScanned: [
            {
              url: 'https://legacy.gov/page',
              timestamp: new Date().toISOString(),
              status: 'SKIPPED_UNCHANGED',
              errorMessage: 'Content unchanged since last scan.',
              technologyStack: [],
              liveAudits: null,
              offlineAudits: null
            }
          ]
        }
      ];

      DashboardCompiler.compileStaticDashboard(payload);

      const perfHtml = fs.readFileSync(
        path.resolve(process.cwd(), 'dist/domains/legacy-domain/performance.html'),
        'utf8'
      );
      expect(perfHtml).toContain('60');
      expect(perfHtml).not.toContain('No performance data available');
    } finally {
      process.env.VITAL_HISTORY_CACHE_DIR = originalEnv;
      fs.rmSync(historyCacheDir, { recursive: true, force: true });
    }
  });

  it('shows data from older runs when recent runs had all timeouts (multi-run lookback)', () => {
    const historyCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-history-multirun-'));
    fs.mkdirSync(path.join(historyCacheDir, 'runs'), { recursive: true });

    // Older run (runId1) has good full data.
    const runId1 = '2024-01-01T00-00-00-000Z';
    const olderRun = {
      results: [
        {
          targetId: 'timeout-domain',
          domain: 'https://timeout.gov',
          scanDurationMs: 1000,
          pagesScanned: [
            {
              url: 'https://timeout.gov/page',
              timestamp: '2024-01-01T00:00:00.000Z',
              status: 'COMPLETED',
              errorMessage: null,
              technologyStack: [],
              liveAudits: {
                lighthouse: { performanceScore: 77, energyEstimateKwh: null, firstContentfulPaintMs: 1200, largestContentfulPaintMs: 2100, speedIndexMs: 2800 },
                accessibilityViolations: [
                  {
                    id: 'color-contrast',
                    severity: 'serious',
                    description: 'Ensures the contrast between foreground and background colors meets WCAG AA ratio thresholds',
                    helpUrl: 'https://dequeuniversity.com/rules/axe/4.9/color-contrast',
                    impactedCriteria: ['wcag2aa'],
                    wcagVersion: '2.0',
                    instances: [{ html: '<p class="low-contrast">text</p>', target: ['.low-contrast'], failureSummary: 'Fix contrast' }]
                  }
                ]
              },
              offlineAudits: null,
              thirdPartyImpact: {
                evaluated: true,
                triggeredBy: [],
                regressionDetected: true,
                baselineViolationCount: 0,
                jsDisabledViolationCount: 0,
                addedByJavaScriptCount: 1,
                removedByJavaScriptCount: 0,
                highRiskRules: [],
                providerAttribution: [],
                likelyIntroducedByProviders: ['Adobe Analytics'],
                ruleToLikelyProviders: [],
                ruleToProviderAttribution: []
              }
            }
          ]
        }
      ]
    };

    // Recent run (runId2) has all timeouts – liveAudits is null for every page.
    const runId2 = '2024-01-02T00-00-00-000Z';
    const recentTimeoutRun = {
      results: [
        {
          targetId: 'timeout-domain',
          domain: 'https://timeout.gov',
          scanDurationMs: 500,
          pagesScanned: [
            {
              url: 'https://timeout.gov/page',
              timestamp: '2024-01-02T00:00:00.000Z',
              status: 'TIMEOUT',
              errorMessage: 'Navigation timeout exceeded.',
              technologyStack: [],
              liveAudits: null,
              offlineAudits: null
            }
          ]
        }
      ]
    };

    fs.writeFileSync(path.join(historyCacheDir, 'runs', `${runId1}.json`), JSON.stringify(olderRun), 'utf8');
    fs.writeFileSync(path.join(historyCacheDir, 'runs', `${runId2}.json`), JSON.stringify(recentTimeoutRun), 'utf8');
    // Index lists runs newest-first.
    fs.writeFileSync(
      path.join(historyCacheDir, 'runs', 'index.json'),
      JSON.stringify({
        updatedAt: '2024-01-02T00:00:00.000Z',
        latestRunId: runId2,
        runs: [
          { runId: runId2, artifactPath: `runs/${runId2}.json` },
          { runId: runId1, artifactPath: `runs/${runId1}.json` }
        ]
      }),
      'utf8'
    );

    const originalEnv = process.env.VITAL_HISTORY_CACHE_DIR;
    try {
      process.env.VITAL_HISTORY_CACHE_DIR = historyCacheDir;

      // Current run also has all timeouts.
      const payload: TargetScanResult[] = [
        {
          targetId: 'timeout-domain',
          domain: 'https://timeout.gov',
          scanDurationMs: 400,
          pagesScanned: [
            {
              url: 'https://timeout.gov/page',
              timestamp: new Date().toISOString(),
              status: 'TIMEOUT',
              errorMessage: 'Navigation timeout exceeded.',
              technologyStack: [],
              liveAudits: null,
              offlineAudits: null
            }
          ]
        }
      ];

      DashboardCompiler.compileStaticDashboard(payload);

      const perfHtml = fs.readFileSync(
        path.resolve(process.cwd(), 'dist/domains/timeout-domain/performance.html'),
        'utf8'
      );
      const a11yHtml = fs.readFileSync(
        path.resolve(process.cwd(), 'dist/domains/timeout-domain/accessibility.html'),
        'utf8'
      );
      const thirdPartyHtml = fs.readFileSync(
        path.resolve(process.cwd(), 'dist/domains/timeout-domain/third-party.html'),
        'utf8'
      );

      // Data from the older full run should appear even though recent runs had timeouts.
      expect(perfHtml).toContain('77');
      expect(perfHtml).toContain('1200');
      expect(perfHtml).not.toContain('No performance data available');
      expect(a11yHtml).toContain('color-contrast');
      expect(a11yHtml).not.toContain('No accessibility violations found');
      expect(thirdPartyHtml).toContain('Adobe Analytics');
      expect(thirdPartyHtml).not.toContain('No third-party impact data available');
    } finally {
      process.env.VITAL_HISTORY_CACHE_DIR = originalEnv;
      fs.rmSync(historyCacheDir, { recursive: true, force: true });
    }
  });

  it('back-fills lighthouse from an older run when recent run is accessibility-only (multi-run sub-field fill)', () => {
    const historyCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-history-subfield-'));
    fs.mkdirSync(path.join(historyCacheDir, 'runs'), { recursive: true });

    // Older run has lighthouse data.
    const runId1 = '2024-01-01T00-00-00-000Z';
    const olderFullRun = {
      results: [
        {
          targetId: 'subfield-domain',
          domain: 'https://subfield.gov',
          scanDurationMs: 1000,
          pagesScanned: [
            {
              url: 'https://subfield.gov/page',
              timestamp: '2024-01-01T00:00:00.000Z',
              status: 'COMPLETED',
              errorMessage: null,
              technologyStack: [],
              liveAudits: {
                lighthouse: { performanceScore: 91, energyEstimateKwh: null, firstContentfulPaintMs: 900, largestContentfulPaintMs: 1800, speedIndexMs: 2000 },
                accessibilityViolations: []
              },
              offlineAudits: null
            }
          ]
        }
      ]
    };

    // Newer run is accessibility-only (lighthouse: null).
    const runId2 = '2024-01-02T00-00-00-000Z';
    const newerA11yOnlyRun = {
      results: [
        {
          targetId: 'subfield-domain',
          domain: 'https://subfield.gov',
          scanDurationMs: 500,
          pagesScanned: [
            {
              url: 'https://subfield.gov/page',
              timestamp: '2024-01-02T00:00:00.000Z',
              status: 'COMPLETED',
              errorMessage: null,
              technologyStack: [],
              liveAudits: { lighthouse: null, accessibilityViolations: [] },
              offlineAudits: null
            }
          ]
        }
      ]
    };

    fs.writeFileSync(path.join(historyCacheDir, 'runs', `${runId1}.json`), JSON.stringify(olderFullRun), 'utf8');
    fs.writeFileSync(path.join(historyCacheDir, 'runs', `${runId2}.json`), JSON.stringify(newerA11yOnlyRun), 'utf8');
    fs.writeFileSync(
      path.join(historyCacheDir, 'runs', 'index.json'),
      JSON.stringify({
        updatedAt: '2024-01-02T00:00:00.000Z',
        latestRunId: runId2,
        runs: [
          { runId: runId2, artifactPath: `runs/${runId2}.json` },
          { runId: runId1, artifactPath: `runs/${runId1}.json` }
        ]
      }),
      'utf8'
    );

    const originalEnv = process.env.VITAL_HISTORY_CACHE_DIR;
    try {
      process.env.VITAL_HISTORY_CACHE_DIR = historyCacheDir;

      // Current run is also accessibility-only for this page.
      const payload: TargetScanResult[] = [
        {
          targetId: 'subfield-domain',
          domain: 'https://subfield.gov',
          scanDurationMs: 400,
          pagesScanned: [
            {
              url: 'https://subfield.gov/page',
              timestamp: new Date().toISOString(),
              status: 'COMPLETED',
              errorMessage: null,
              technologyStack: [],
              liveAudits: { lighthouse: null, accessibilityViolations: [] },
              offlineAudits: null
            }
          ]
        }
      ];

      DashboardCompiler.compileStaticDashboard(payload);

      const perfHtml = fs.readFileSync(
        path.resolve(process.cwd(), 'dist/domains/subfield-domain/performance.html'),
        'utf8'
      );
      // Lighthouse data from the older full run should be back-filled.
      expect(perfHtml).toContain('91');
      expect(perfHtml).toContain('900');
      expect(perfHtml).not.toContain('No performance data available');
    } finally {
      process.env.VITAL_HISTORY_CACHE_DIR = originalEnv;
      fs.rmSync(historyCacheDir, { recursive: true, force: true });
    }
  });

  it('renders a dedicated run-history.html page when multiple run artifacts are present', () => {
    const historyCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-history-runhist-'));
    fs.mkdirSync(path.join(historyCacheDir, 'runs'), { recursive: true });

    const makeRun = (runId: string, violations: number) => ({
      results: [
        {
          targetId: 'runhist-domain',
          domain: 'https://runhist.gov',
          scanDurationMs: 1000,
          pagesScanned: [
            {
              url: 'https://runhist.gov/page1',
              timestamp: runId,
              status: 'COMPLETED',
              errorMessage: null,
              technologyStack: [],
              liveAudits: {
                lighthouse: null,
                accessibilityViolations: Array.from({ length: violations }, (_, i) => ({
                  id: `rule-${i}`, impact: 'serious', description: '', help: '', helpUrl: '',
                  nodes: [], wcagLevel: 'AA', wcagTags: []
                }))
              },
              offlineAudits: null
            }
          ]
        }
      ]
    });

    const runId1 = '2024-03-01T00-00-00-000Z';
    const runId2 = '2024-03-01T00-10-00-000Z';
    const runId3 = '2024-03-01T00-20-00-000Z';

    fs.writeFileSync(path.join(historyCacheDir, 'runs', `${runId1}.json`), JSON.stringify(makeRun(runId1, 3)), 'utf8');
    fs.writeFileSync(path.join(historyCacheDir, 'runs', `${runId2}.json`), JSON.stringify(makeRun(runId2, 5)), 'utf8');
    fs.writeFileSync(path.join(historyCacheDir, 'runs', `${runId3}.json`), JSON.stringify(makeRun(runId3, 2)), 'utf8');

    fs.writeFileSync(
      path.join(historyCacheDir, 'runs', 'index.json'),
      JSON.stringify({
        updatedAt: '2024-03-01T00:20:00.000Z',
        latestRunId: runId3,
        runs: [
          { runId: runId3, generatedAt: '2024-03-01T00:20:00.000Z', artifactPath: `runs/${runId3}.json` },
          { runId: runId2, generatedAt: '2024-03-01T00:10:00.000Z', artifactPath: `runs/${runId2}.json` },
          { runId: runId1, generatedAt: '2024-03-01T00:00:00.000Z', artifactPath: `runs/${runId1}.json` }
        ]
      }),
      'utf8'
    );

    const originalEnv = process.env.VITAL_HISTORY_CACHE_DIR;
    try {
      process.env.VITAL_HISTORY_CACHE_DIR = historyCacheDir;

      const payload: TargetScanResult[] = [
        {
          targetId: 'runhist-domain',
          domain: 'https://runhist.gov',
          scanDurationMs: 500,
          pagesScanned: [
            {
              url: 'https://runhist.gov/page1',
              timestamp: new Date().toISOString(),
              status: 'COMPLETED',
              errorMessage: null,
              technologyStack: [],
              liveAudits: { lighthouse: null, accessibilityViolations: [] },
              offlineAudits: null
            }
          ]
        }
      ];

      DashboardCompiler.compileStaticDashboard(payload);

      const runHistoryHtml = fs.readFileSync(
        path.resolve(process.cwd(), 'dist/domains/runhist-domain/run-history.html'),
        'utf8'
      );

      // Run History section heading must be present.
      expect(runHistoryHtml).toContain('Run History');

      // Summary line should mention 3 runs.
      expect(runHistoryHtml).toContain('3 runs');

      // Violation counts from the historical runs should appear.
      expect(runHistoryHtml).toContain('>3<');  // run 1 violations
      expect(runHistoryHtml).toContain('>5<');  // run 2 violations
      expect(runHistoryHtml).toContain('>2<');  // run 3 violations
    } finally {
      process.env.VITAL_HISTORY_CACHE_DIR = originalEnv;
      fs.rmSync(historyCacheDir, { recursive: true, force: true });
    }
  });

  it('does not crash when no SQLite data exists for writePerRunDetailPages', () => {
    // With no SQLite DB present, writePerRunDetailPages should silently skip.
    const payload: TargetScanResult[] = [
      {
        targetId: 'per-run-test',
        domain: 'https://perrun.example.gov',
        scanDurationMs: 100,
        pagesScanned: [
          {
            url: 'https://perrun.example.gov/',
            timestamp: new Date().toISOString(),
            status: 'COMPLETED',
            errorMessage: null,
            technologyStack: [],
            liveAudits: { lighthouse: null, accessibilityViolations: [] },
            offlineAudits: null
          }
        ]
      }
    ];

    // Should not throw.
    expect(() => DashboardCompiler.compileStaticDashboard(payload)).not.toThrow();

    // Main dashboard must still be written.
    expect(fs.existsSync(path.resolve(process.cwd(), 'dist/index.html'))).toBe(true);
  });

  it('dashboard.js contains per-run detail link code in appendHistoryRow', () => {
    const payload: TargetScanResult[] = [
      {
        targetId: 'detail-link-check',
        domain: 'https://detail.example.gov',
        scanDurationMs: 100,
        pagesScanned: [
          {
            url: 'https://detail.example.gov/',
            timestamp: new Date().toISOString(),
            status: 'COMPLETED',
            errorMessage: null,
            technologyStack: [],
            liveAudits: { lighthouse: null, accessibilityViolations: [] },
            offlineAudits: null
          }
        ]
      }
    ];

    DashboardCompiler.compileStaticDashboard(payload);
    const js = fs.readFileSync(path.resolve(process.cwd(), 'dist/assets/dashboard.js'), 'utf8');

    // appendHistoryRow should include a Details link pointing to runs/{runId}/index.html
    expect(js).toContain("detailLink.href = 'runs/' + String(run.runId) + '/index.html'");
    expect(js).toContain("detailLink.textContent = 'Details'");
  });
});
