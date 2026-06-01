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

  it('returns PASS status and full score when no violations are present', () => {
    const clean: TargetScanResult = {
      targetId: 'clean-target',
      domain: 'https://clean.example.gov',
      scanDurationMs: 500,
      pagesScanned: [
        {
          url: 'https://clean.example.gov/page',
          timestamp: new Date().toISOString(),
          status: 'COMPLETED',
          errorMessage: null,
          technologyStack: [],
          liveAudits: { lighthouse: null, accessibilityViolations: [] },
          offlineAudits: {
            overlayDetected: { found: false, provider: null, evidence: null },
            designSystem: { usesUSWDS: false, versionDetected: null },
            contentMetrics: { readabilityScore: 80, suspiciousAltTextCount: 0, suspiciousAltInstances: [] },
            linkHealth: { totalChecked: 0, brokenCount: 0, brokenLinks: [] }
          }
        }
      ]
    };

    const result = QualityIndexReporter.buildQualityIndex([clean]);

    expect(result.gateStatus).toBe('PASS');
    expect(result.score).toBe(100);
    expect(result.evidence.violations.total).toBe(0);
  });

  it('returns a predictable score when no pages are provided', () => {
    const result = QualityIndexReporter.buildQualityIndex([]);

    expect(result.evidence.pages).toBe(0);
    // With no pages: accessibility=100, content=100, reliability=0, linkIntegrity=100
    // Weighted: 100*0.6 + 100*0.15 + 0*0.15 + 100*0.1 = 85
    expect(result.score).toBe(85);
    // No violations → gate passes (score ≥ 75)
    expect(result.gateStatus).toBe('PASS');
  });

  it('counts violation severities accurately across multiple pages', () => {
    const result = QualityIndexReporter.buildQualityIndex([
      makeResult('critical'),
      makeResult('serious'),
      makeResult('moderate'),
      makeResult('minor')
    ]);

    expect(result.evidence.violations.critical).toBe(1);
    expect(result.evidence.violations.serious).toBe(1);
    expect(result.evidence.violations.moderate).toBe(1);
    expect(result.evidence.violations.minor).toBe(1);
    expect(result.evidence.violations.total).toBe(4);
    expect(result.gateStatus).toBe('BLOCKED');
  });

  it('reflects broken-link ratio in link integrity score', () => {
    const withBrokenLinks: TargetScanResult = {
      targetId: 'broken-links',
      domain: 'https://example.gov',
      scanDurationMs: 1000,
      pagesScanned: [
        {
          url: 'https://example.gov/page',
          timestamp: new Date().toISOString(),
          status: 'COMPLETED',
          errorMessage: null,
          technologyStack: [],
          liveAudits: { lighthouse: null, accessibilityViolations: [] },
          offlineAudits: {
            overlayDetected: { found: false, provider: null, evidence: null },
            designSystem: { usesUSWDS: false, versionDetected: null },
            contentMetrics: { readabilityScore: 80, suspiciousAltTextCount: 0, suspiciousAltInstances: [] },
            linkHealth: { totalChecked: 10, brokenCount: 5, brokenLinks: [] }
          }
        }
      ]
    };

    const result = QualityIndexReporter.buildQualityIndex([withBrokenLinks]);
    expect(result.breakdown.linkIntegrityScore).toBe(50);
    expect(result.evidence.brokenLinks.checked).toBe(10);
    expect(result.evidence.brokenLinks.broken).toBe(5);
  });
});

describe('QualityIndexReporter.buildTargetQualityIndex', () => {
  it('returns one entry per target, sorted alphabetically by targetId', () => {
    const results = [makeResult('moderate'), makeResult('serious')].map((r, i) => ({
      ...r,
      targetId: i === 0 ? 'zebra-target' : 'alpha-target'
    }));

    const entries = QualityIndexReporter.buildTargetQualityIndex(results);

    expect(entries).toHaveLength(2);
    expect(entries[0].targetId).toBe('alpha-target');
    expect(entries[1].targetId).toBe('zebra-target');
  });

  it('includes pagesScanned and totalViolations for each target', () => {
    const result = makeResult('serious');
    const entries = QualityIndexReporter.buildTargetQualityIndex([result]);

    expect(entries[0].pagesScanned).toBe(1);
    expect(entries[0].totalViolations).toBe(1);
    expect(typeof entries[0].score).toBe('number');
    expect(['PASS', 'WARNING', 'BLOCKED']).toContain(entries[0].gateStatus);
  });

  it('returns empty array when called with no results', () => {
    const entries = QualityIndexReporter.buildTargetQualityIndex([]);
    expect(entries).toEqual([]);
  });
});
