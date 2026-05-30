import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { BugExporter } from '../../src/engine/reporters/bug-exporter';
import { TargetScanResult } from '../../src/types/site-quality-spec';

describe('BugExporter', () => {
  it('writes markdown and csv issue reports for a target', () => {
    const payload: TargetScanResult = {
      targetId: 'sample-target',
      domain: 'https://example.org',
      scanDurationMs: 1234,
      pagesScanned: [
        {
          url: 'https://example.org/page',
          timestamp: new Date().toISOString(),
          status: 'COMPLETED',
          errorMessage: null,
          technologyStack: [],
          liveAudits: {
            lighthouse: null,
            accessibilityViolations: [
              {
                id: 'image-alt',
                severity: 'serious',
                description: 'Images must have alternate text',
                helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
                impactedCriteria: ['wcag2a'],
                instances: [
                  {
                    html: '<img src="hero.png">',
                    target: ['.hero img'],
                    failureSummary: 'Add a meaningful alt attribute.'
                  }
                ]
              }
            ]
          },
          offlineAudits: {
            overlayDetected: { found: false, provider: null, evidence: null },
            designSystem: { usesUSWDS: false, versionDetected: null },
            contentMetrics: {
              readabilityScore: 45,
              suspiciousAltTextCount: 0,
              suspiciousAltInstances: []
            },
            linkHealth: {
              totalChecked: 0,
              brokenCount: 0,
              brokenLinks: []
            }
          }
        }
      ]
    };

    const markdownFile = BugExporter.exportMarkdownReport(payload);
    const csvFile = markdownFile.replace('.md', '.csv');

    const markdownPath = path.resolve(process.cwd(), 'dist/reports', markdownFile);
    const csvPath = path.resolve(process.cwd(), 'dist/reports', csvFile);

    expect(fs.existsSync(markdownPath)).toBe(true);
    expect(fs.existsSync(csvPath)).toBe(true);

    const csvText = fs.readFileSync(csvPath, 'utf8');
    expect(csvText).toContain('target_id,page_url,status,error_message,severity,rule_id');
    expect(csvText).toContain('sample-target,https://example.org/page,COMPLETED,,serious,image-alt');
  });
});
