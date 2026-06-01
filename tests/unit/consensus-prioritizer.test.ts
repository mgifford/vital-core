import { describe, expect, it } from 'vitest';
import { ConsensusPrioritizer } from '../../src/engine/reporters/consensus-prioritizer';
import { TargetScanResult } from '../../src/types/site-quality-spec';

function makeOfflineAudits() {
  return {
    overlayDetected: { found: false as const, provider: null, evidence: null },
    designSystem: { usesUSWDS: false, versionDetected: null },
    contentMetrics: { readabilityScore: 60, suspiciousAltTextCount: 0, suspiciousAltInstances: [] as Array<{ imgHtml: string; invalidValue: string }> },
    linkHealth: { totalChecked: 0, brokenCount: 0, brokenLinks: [] as Array<{ sourceUrl: string; targetUrl: string; statusCode: number | null }> }
  };
}

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
            offlineAudits: makeOfflineAudits()
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

  it('returns all-zero summary when no results are provided', () => {
    const summary = ConsensusPrioritizer.buildSummary([]);

    expect(summary.consensusFailure).toBe(0);
    expect(summary.alfaOnlyFailure).toBe(0);
    expect(summary.axeOnlyFailure).toBe(0);
    expect(summary.totalCorrelatedFindings).toBe(0);
  });

  it('counts only axe-only when alfa audits are absent', () => {
    const results: TargetScanResult[] = [
      {
        targetId: 'axe-only',
        domain: 'https://example.gov',
        scanDurationMs: 500,
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
                  id: 'label',
                  severity: 'critical',
                  description: 'Form elements must have labels',
                  helpUrl: 'https://example.org/help',
                  impactedCriteria: ['wcag2a'],
                  instances: [{ html: '<input>', target: ['input'], failureSummary: 'Missing label' }]
                }
              ]
            },
            offlineAudits: makeOfflineAudits()
          }
        ]
      }
    ];

    const summary = ConsensusPrioritizer.buildSummary(results);
    expect(summary.axeOnlyFailure).toBe(1);
    expect(summary.alfaOnlyFailure).toBe(0);
    expect(summary.consensusFailure).toBe(0);
    expect(summary.totalCorrelatedFindings).toBe(1);
  });

  it('deduplicates findings from the same page and rule across alfa and axe', () => {
    const results: TargetScanResult[] = [
      {
        targetId: 'dedup',
        domain: 'https://example.gov',
        scanDurationMs: 500,
        pagesScanned: [
          {
            url: 'https://example.gov/page',
            timestamp: new Date().toISOString(),
            status: 'COMPLETED',
            errorMessage: null,
            alfaAudits: {
              executed: true,
              findingsCount: 1,
              errorMessage: null,
              rawResults: {
                outcomes: [{ rule: 'label', severity: 'critical' }]
              }
            },
            technologyStack: [],
            liveAudits: {
              lighthouse: null,
              accessibilityViolations: [
                {
                  id: 'label',
                  severity: 'critical',
                  description: 'Form elements must have labels',
                  helpUrl: 'https://example.org/help',
                  impactedCriteria: ['wcag2a'],
                  instances: [{ html: '<input>', target: ['input'], failureSummary: 'Missing label' }]
                }
              ]
            },
            offlineAudits: makeOfflineAudits()
          }
        ]
      }
    ];

    const summary = ConsensusPrioritizer.buildSummary(results);
    // Same rule on same page → consensus, not counted twice
    expect(summary.consensusFailure).toBe(1);
    expect(summary.totalCorrelatedFindings).toBe(1);
  });
});