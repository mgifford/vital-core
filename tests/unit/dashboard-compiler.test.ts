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
    const html = fs.readFileSync(outputPath, 'utf8');

    expect(html).toContain('\\u003cscript\\u003ealert(1)\\u003c/script\\u003e');
    expect(html).not.toContain('\"><script>alert(1)</script>');
    expect(html).toContain('Federal Quality Index');
    expect(html).toContain('Domains Leaderboard');
    expect(html).toContain('Pages (recent pages)');
    expect(html).toContain('Recommendations');
    expect(html).toContain('Top Third-Party Providers');
    expect(html).toContain('Domain Ongoing Reports');
    expect(html).toContain('Pages Needing Most Improvement');
    expect(html).toContain('runs/domain-ongoing.json');
    expect(html).toContain('Requirement Compliance Over Time');
    expect(html).toContain('compliance-chart');
    expect(html).toContain('requirementComplianceOverTime');
    expect(html).toContain('Live Scan Ticker');
    expect(html).toContain('api.github.com/repos/');
  });
});
