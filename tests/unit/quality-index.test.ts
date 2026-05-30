import { describe, expect, it } from 'vitest';
import { QualityIndexReporter } from '../../src/engine/reporters/quality-index';
import { TargetScanResult } from '../../src/types/site-quality-spec';

function makeResult(severity: 'critical' | 'serious' | 'moderate' | 'minor', status: 'COMPLETED' | 'FAILED' = 'COMPLETED'): TargetScanResult {
  return {
    targetId: 'cms-gov',
    domain: 'https://www.cms.gov',
    scanDurationMs: 1000,
    pagesScanned: [
      {
        url: 'https://www.cms.gov/page',
        timestamp: new Date().toISOString(),
        status,
        errorMessage: status === 'FAILED' ? 'failure' : null,
        technologyStack: [],
        liveAudits: {
          lighthouse: null,
          accessibilityViolations: [
            {
              id: 'rule-1',
              severity,
              description: 'desc',
              helpUrl: 'https://example.org/help',
              impactedCriteria: ['wcag2aa'],
              instances: [
                {
                  html: '<main></main>',
                  target: ['main'],
                  failureSummary: 'summary'
                }
              ]
            }
          ]
        },
        offlineAudits: {
          overlayDetected: { found: false, provider: null, evidence: null },
          designSystem: { usesUSWDS: true, versionDetected: '3' },
          contentMetrics: {
            readabilityScore: 70,
            suspiciousAltTextCount: 1,
            suspiciousAltInstances: [
              {
                imgHtml: '<img alt="image">',
                invalidValue: 'image'
              }
            ]
          },
          linkHealth: {
            totalChecked: 10,
            brokenCount: 1,
            brokenLinks: [
              {
                sourceUrl: 'https://www.cms.gov/page',
                targetUrl: 'https://broken.example.org',
                statusCode: 404
              }
            ]
          }
        }
      }
    ]
  };
}

describe('QualityIndexReporter', () => {
  it('blocks quality gate when critical violations are present', () => {
    const result = QualityIndexReporter.buildQualityIndex([makeResult('critical')]);

    expect(result.evidence.violations.critical).toBe(1);
    expect(result.gateStatus).toBe('BLOCKED');
    expect(result.score).toBeLessThan(100);
  });

  it('returns warning for serious-only run and reflects reliability loss', () => {
    const serious = makeResult('serious', 'FAILED');
    const result = QualityIndexReporter.buildQualityIndex([serious]);

    expect(result.gateStatus).toBe('WARNING');
    expect(result.breakdown.reliabilityScore).toBeLessThan(100);
  });
});
