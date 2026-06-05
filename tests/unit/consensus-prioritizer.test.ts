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
  it('summarizes cross-engine overlap for a single page', () => {
    const summary = ConsensusPrioritizer.buildPageSummary('https://example.gov/page', [
      {
        id: 'document-title',
        severity: 'serious',
        description: 'Documents must have a title',
        helpUrl: 'https://example.org/help/document-title',
        impactedCriteria: ['wcag2a'],
        instances: [{ html: '<html>', target: ['html'], failureSummary: 'Missing title' }],
        sourceEngine: 'axe'
      },
      {
        id: 'color-contrast',
        severity: 'serious',
        description: 'Text needs sufficient contrast',
        helpUrl: 'https://example.org/help/color-contrast',
        impactedCriteria: ['wcag2aa'],
        instances: [{ html: '<p>', target: ['p'], failureSummary: 'Low contrast' }],
        sourceEngine: 'axe'
      },
      {
        id: 'sia-r1',
        severity: 'serious',
        description: 'Documents should have a title',
        helpUrl: 'https://alfa.siteimprove.com/rules/sia-r1',
        impactedCriteria: ['wcag2a'],
        instances: [{ html: '<html>', target: ['html'], failureSummary: 'Missing title' }],
        sourceEngine: 'alfa'
      },
      {
        id: 'sia-r6',
        severity: 'moderate',
        description: 'Decorative image should be ignored',
        helpUrl: 'https://alfa.siteimprove.com/rules/sia-r6',
        impactedCriteria: ['wcag2a'],
        instances: [{ html: '<img>', target: ['img'], failureSummary: 'Decorative image issue' }],
        sourceEngine: 'alfa'
      }
    ]);

    expect(summary.consensusFailure).toBe(1);
    expect(summary.axeOnlyFailure).toBe(1);
    expect(summary.alfaOnlyFailure).toBe(1);
    expect(summary.totalCorrelatedFindings).toBe(3);
  });

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
                  // sia-r2 covers ACT rule 23a2a8, same as axe 'image-alt' → consensus
                  { rule: 'sia-r2', severity: 'serious' },
                  // sia-r6 covers ACT rule 5b7ae0, no axe implementation → alfa-only
                  { rule: 'sia-r6', severity: 'moderate' }
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
                  // color-contrast maps to ACT afw4f7; alfa has no implementation → axe-only
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
                // sia-r8 covers ACT rule e086e5, same as axe 'label'
                outcomes: [{ rule: 'sia-r8', severity: 'critical' }]
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
    // Same ACT rule (e086e5) on same page → consensus, not counted twice
    expect(summary.consensusFailure).toBe(1);
    expect(summary.totalCorrelatedFindings).toBe(1);
  });

  it('correlates findings via shared W3C ACT rule ID when axe and alfa use different rule names', () => {
    // axe uses 'document-title', alfa uses 'sia-r1' — both implement ACT rule 2779a5
    const results: TargetScanResult[] = [
      {
        targetId: 'act-correlation',
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
                outcomes: [{ rule: 'sia-r1', severity: 'serious' }]
              }
            },
            technologyStack: [],
            liveAudits: {
              lighthouse: null,
              accessibilityViolations: [
                {
                  id: 'document-title',
                  severity: 'serious',
                  description: 'Documents must have <title> element',
                  helpUrl: 'https://example.org/help',
                  impactedCriteria: ['wcag2a'],
                  instances: [{ html: '<html>', target: ['html'], failureSummary: 'Missing title' }]
                }
              ]
            },
            offlineAudits: makeOfflineAudits()
          }
        ]
      }
    ];

    const summary = ConsensusPrioritizer.buildSummary(results);
    // Different tool-specific rule names, same ACT rule 2779a5 → consensus
    expect(summary.consensusFailure).toBe(1);
    expect(summary.alfaOnlyFailure).toBe(0);
    expect(summary.axeOnlyFailure).toBe(0);
    expect(summary.totalCorrelatedFindings).toBe(1);
  });
});