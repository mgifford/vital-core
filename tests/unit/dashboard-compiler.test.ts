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
  });
});
