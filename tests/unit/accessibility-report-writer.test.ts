import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { WeeklyAccessibilityReportWriter } from '../../src/engine/reporters/accessibility-report-writer';
import { SqlitePersister } from '../../src/engine/reporters/sqlite-persister';
import type { TargetScanResult } from '../../src/types/site-quality-spec';

const originalCwd = process.cwd();

function makeResult(): TargetScanResult {
  return {
    targetId: 'weekly-a11y',
    domain: 'https://weekly.example.org',
    scanDurationMs: 4500,
    pagesScanned: [
      {
        url: 'https://weekly.example.org/home',
        timestamp: '2026-06-09T17:00:00.000Z',
        status: 'COMPLETED',
        errorMessage: null,
        pageTitle: 'Weekly Home',
        scanContext: {
          browserFamily: 'chrome',
          viewportLabel: 'desktop-standard',
          viewport: { width: 1366, height: 768 },
          colorScheme: 'light'
        },
        technologyStack: [],
        liveAudits: {
          lighthouse: null,
          accessibilityViolations: [
            {
              id: 'color-contrast',
              severity: 'serious',
              description: 'Text needs contrast',
              helpUrl: 'https://example.org/help/color-contrast',
              impactedCriteria: ['wcag2aa'],
              sourceEngine: 'axe',
              instances: [
                {
                  html: '<p class="low-contrast">Weekly text</p>',
                  target: ['p.low-contrast'],
                  failureSummary: 'Increase contrast'
                }
              ]
            },
            {
              id: 'sia-r1',
              severity: 'moderate',
              description: 'Title should be present',
              helpUrl: 'https://example.org/help/title',
              impactedCriteria: ['wcag2a'],
              sourceEngine: 'alfa',
              instances: [
                {
                  html: '<title></title>',
                  target: ['head > title'],
                  failureSummary: 'Add a page title'
                }
              ]
            }
          ]
        },
        offlineAudits: null
      }
    ]
  };
}

function makeMultiPageResult(pageCount: number): TargetScanResult {
  const pages = Array.from({ length: pageCount }, (_, index) => {
    const pageNumber = index + 1;
    const ts = `2026-06-09T17:${String(pageNumber).padStart(2, '0')}:00.000Z`;
    const url = `https://weekly.example.org/page-${pageNumber}`;

    return {
      url,
      timestamp: ts,
      status: 'COMPLETED' as const,
      errorMessage: null,
      pageTitle: `Weekly Page ${pageNumber}`,
      scanContext: {
        browserFamily: 'chrome' as const,
        viewportLabel: 'desktop-standard',
        viewport: { width: 1366, height: 768 },
        colorScheme: 'light' as const
      },
      technologyStack: [],
      liveAudits: {
        lighthouse: null,
        accessibilityViolations: [
          {
            id: 'color-contrast',
            severity: 'serious' as const,
            description: `Text needs contrast on page ${pageNumber}`,
            helpUrl: 'https://example.org/help/color-contrast',
            impactedCriteria: ['wcag2aa'],
            sourceEngine: 'axe',
            instances: [
              {
                html: `<p class="low-contrast-${pageNumber}">Weekly text ${pageNumber}</p>`,
                target: [`p.low-contrast-${pageNumber}`],
                failureSummary: 'Increase contrast'
              }
            ]
          }
        ]
      },
      offlineAudits: null
    };
  });

  return {
    targetId: 'weekly-a11y-fallback',
    domain: 'https://weekly.example.org',
    scanDurationMs: 7500,
    pagesScanned: pages
  };
}

afterEach(() => {
  process.chdir(originalCwd);
});

describe('WeeklyAccessibilityReportWriter', () => {
  it('writes the weekly accessibility report pages from SQLite-backed scan data', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-accessibility-report-'));
    process.chdir(tmpDir);

    const result = makeResult();
    SqlitePersister.appendRun([result], {
      runId: 'weekly-accessibility-run',
      generatedAt: '2026-06-09T17:05:00.000Z',
      profilePath: 'profiles/us-health.yml',
      scanDurationMs: result.scanDurationMs,
      targetsScanned: 1,
      pagesScanned: 1,
      totalViolations: 2,
      qualityIndexScore: 84,
      qualityGateStatus: 'WARNING',
      consensusFailure: 0,
      alfaOnlyFailure: 0,
      axeOnlyFailure: 0
    });

    WeeklyAccessibilityReportWriter.writeWeeklyAccessibilityReports([result]);

    const domainDir = path.resolve(tmpDir, 'dist/domains/weekly-a11y');
    const indexHtml = fs.readFileSync(path.join(domainDir, 'index.html'), 'utf8');
    const accessibilityHtml = fs.readFileSync(path.join(domainDir, 'accessibility.html'), 'utf8');
    const reportHtml = fs.readFileSync(path.join(domainDir, 'report.html'), 'utf8');
    const lastRunHtml = fs.readFileSync(path.join(domainDir, 'last-run.html'), 'utf8');
    const runHistoryHtml = fs.readFileSync(path.join(domainDir, 'run-history.html'), 'utf8');

    expect(fs.existsSync(domainDir)).toBe(true);
    expect(indexHtml).toContain('Domain Reports');
    expect(indexHtml).toContain('Detailed accessibility report');
    expect(accessibilityHtml).toContain('Weekly Accessibility Summary');
    expect(accessibilityHtml).toContain('data-filter-tool="axe"');
    expect(accessibilityHtml).toContain('data-sources="axe"');
    expect(accessibilityHtml).toContain('Top Pages');
    expect(accessibilityHtml).toContain('color-contrast');
    expect(reportHtml).toContain('Weekly Accessibility Report');
    expect(reportHtml).toContain('Pages With Most Errors');
    expect(reportHtml).toContain('Common Issues');
    expect(reportHtml).toContain('Issue Details');
    expect(reportHtml).toContain('Show page instances');
    expect(reportHtml).toContain('color-contrast');
    expect(lastRunHtml).toContain('Latest Run Report');
    expect(lastRunHtml).toContain('Total violations');
    expect(runHistoryHtml).toContain('Run History');

    const db = new DatabaseSync(path.resolve(tmpDir, 'dist/vital.db'), { readOnly: true });
    const rows = db.prepare('SELECT COUNT(*) AS count FROM violations').get() as { count: number };
    db.close();

    expect(rows.count).toBe(2);
  });

  it('renders all latest scanned pages in accessibility summary fallback mode', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-accessibility-report-fallback-'));
    process.chdir(tmpDir);

    const result = makeMultiPageResult(5);

    // Intentionally skip SqlitePersister.appendRun to exercise fallback mode.
    WeeklyAccessibilityReportWriter.writeWeeklyAccessibilityReports([result]);

    const domainDir = path.resolve(tmpDir, 'dist/domains/weekly-a11y-fallback');
    const accessibilityHtml = fs.readFileSync(path.join(domainDir, 'accessibility.html'), 'utf8');
    const lastRunHtml = fs.readFileSync(path.join(domainDir, 'last-run.html'), 'utf8');

    expect(accessibilityHtml).toContain('Weekly Accessibility Summary');
    expect(accessibilityHtml).toMatch(/<dt>Pages<\/dt><dd>5<\/dd>/);
    expect(lastRunHtml).toContain('<div><dt>Pages scanned</dt><dd>5</dd></div>');

    for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) {
      expect(accessibilityHtml).toContain(`https://weekly.example.org/page-${pageNumber}`);
    }
  });
});
