import { describe, expect, it } from 'vitest';
import { ConsensusPrioritizer } from '../../src/engine/reporters/consensus-prioritizer';
import { TargetScanResult } from '../../src/types/site-quality-spec';

describe('ConsensusPrioritizer', () => {
  it('classifies findings into consensus/alfa-only/axe-only buckets', () => {
    const results: TargetScanResult[] = [
      {
        targetId: 'cms-gov',
        domain: 'https://www.cms.gov',
        scanDurationMs: 1000,
        pagesScanned: [
          {
            url: 'https://www.cms.gov/a',
            timestamp: new Date().toISOString(),
            status: 'COMPLETED',
            errorMessage: null,
            alfaAudits: {
              executed: true,
              findingsCount: 2,
              errorMessage: null,
              rawResults: {
                outcomes: [
                  { rule: 'image-alt', severity: 'serious' },
                  { rule: 'duplicate-id', severity: 'moderate' }
                ]
              }
            },
            technologyStack: [],
            thirdPartyImpact: null,
            liveAudits: {
              lighthouse: null,
              accessibilityViolations: [
                {
                  id: 'image-alt',
                  severity: 'serious',
                  description: 'desc',
                  helpUrl: 'https://example.org/help',
                  impactedCriteria: ['wcag2aa'],
                  instances: [{ html: '<img>', target: ['img'], failureSummary: 'summary' }]
                },
                {
                  id: 'color-contrast',
                  severity: 'serious',
                  description: 'desc',
                  helpUrl: 'https://example.org/help',
                  impactedCriteria: ['wcag2aa'],
                  instances: [{ html: '<p>', target: ['p'], failureSummary: 'summary' }]
                }
              ]
            },
            offlineAudits: {
              overlayDetected: { found: false, provider: null, evidence: null },
              designSystem: { usesUSWDS: false, versionDetected: null },
              contentMetrics: { readabilityScore: 60, suspiciousAltTextCount: 0, suspiciousAltInstances: [] },
              linkHealth: { totalChecked: 0, brokenCount: 0, brokenLinks: [] }
            }
          }
        ]
      }
    ];

    const summary = ConsensusPrioritizer.buildSummary(results);
    expect(summary.consensusFailure).toBe(1);
    expect(summary.alfaOnlyFailure).toBe(1);
    expect(summary.axeOnlyFailure).toBe(1);
    expect(summary.totalCorrelatedFindings).toBe(3);
  });
});