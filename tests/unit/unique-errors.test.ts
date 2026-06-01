import { describe, expect, it } from 'vitest';
import { UniqueErrorsReporter } from '../../src/engine/reporters/unique-errors';
import { TargetScanResult } from '../../src/types/site-quality-spec';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTarget(overrides: {
  targetId: string;
  domain?: string;
  pages?: Array<{
    url: string;
    violations?: Array<{
      id: string;
      severity: 'critical' | 'serious' | 'moderate' | 'minor';
      description?: string;
      helpUrl?: string;
      wcagVersion?: '2.0' | '2.1' | '2.2' | 'section508' | 'best-practice';
      instances?: Array<{ html: string; target: string[]; failureSummary: string }>;
    }>;
  }>;
}): TargetScanResult {
  const pages = (overrides.pages ?? []).map(p => ({
    url: p.url,
    timestamp: new Date().toISOString(),
    status: 'COMPLETED' as const,
    errorMessage: null,
    technologyStack: [],
    liveAudits: {
      lighthouse: null,
      accessibilityViolations: (p.violations ?? []).map(v => ({
        id: v.id,
        severity: v.severity,
        description: v.description ?? `Description for ${v.id}`,
        helpUrl: v.helpUrl ?? `https://dequeuniversity.com/rules/axe/4/${v.id}`,
        impactedCriteria: ['wcag2aa'],
        wcagVersion: v.wcagVersion,
        instances: v.instances ?? [
          { html: `<div class="${v.id}">`, target: [`.${v.id}`], failureSummary: 'Fix this' }
        ]
      }))
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
  }));

  return {
    targetId: overrides.targetId,
    domain: overrides.domain ?? `https://${overrides.targetId}.gov`,
    scanDurationMs: 1000,
    pagesScanned: pages
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UniqueErrorsReporter.buildUniqueErrors', () => {
  it('returns empty array when there are no violations', () => {
    const results: TargetScanResult[] = [
      makeTarget({ targetId: 'cms-gov', pages: [{ url: 'https://cms.gov/' }] })
    ];
    expect(UniqueErrorsReporter.buildUniqueErrors(results)).toEqual([]);
  });

  it('returns empty array for an empty results list', () => {
    expect(UniqueErrorsReporter.buildUniqueErrors([])).toEqual([]);
  });

  it('returns one entry per unique rule ID', () => {
    const results = [
      makeTarget({
        targetId: 'cms-gov',
        pages: [
          {
            url: 'https://cms.gov/a',
            violations: [
              { id: 'image-alt', severity: 'serious' },
              { id: 'color-contrast', severity: 'moderate' }
            ]
          }
        ]
      })
    ];
    const entries = UniqueErrorsReporter.buildUniqueErrors(results);
    expect(entries).toHaveLength(2);
    const ruleIds = entries.map(e => e.ruleId);
    expect(ruleIds).toContain('image-alt');
    expect(ruleIds).toContain('color-contrast');
  });

  it('aggregates the same rule across multiple pages of the same domain', () => {
    const results = [
      makeTarget({
        targetId: 'cms-gov',
        pages: [
          {
            url: 'https://cms.gov/a',
            violations: [{ id: 'image-alt', severity: 'serious', instances: [
              { html: '<img src="a.png">', target: ['.img-a'], failureSummary: 'Fix' }
            ]}]
          },
          {
            url: 'https://cms.gov/b',
            violations: [{ id: 'image-alt', severity: 'serious', instances: [
              { html: '<img src="b.png">', target: ['.img-b'], failureSummary: 'Fix' },
              { html: '<img src="c.png">', target: ['.img-c'], failureSummary: 'Fix' }
            ]}]
          }
        ]
      })
    ];
    const [entry] = UniqueErrorsReporter.buildUniqueErrors(results);
    expect(entry.ruleId).toBe('image-alt');
    expect(entry.totalDomainCount).toBe(1);
    expect(entry.totalPageCount).toBe(2);
    expect(entry.totalInstanceCount).toBe(3);
    expect(entry.isSystemic).toBe(false);
  });

  it('marks a rule as systemic when it appears on multiple domains', () => {
    const results = [
      makeTarget({
        targetId: 'cms-gov',
        pages: [{ url: 'https://cms.gov/', violations: [{ id: 'image-alt', severity: 'serious' }] }]
      }),
      makeTarget({
        targetId: 'hhs-gov',
        pages: [{ url: 'https://hhs.gov/', violations: [{ id: 'image-alt', severity: 'serious' }] }]
      })
    ];
    const [entry] = UniqueErrorsReporter.buildUniqueErrors(results);
    expect(entry.ruleId).toBe('image-alt');
    expect(entry.totalDomainCount).toBe(2);
    expect(entry.isSystemic).toBe(true);
  });

  it('does not mark a rule as systemic when it appears on only one domain', () => {
    const results = [
      makeTarget({
        targetId: 'cms-gov',
        pages: [{ url: 'https://cms.gov/', violations: [{ id: 'color-contrast', severity: 'moderate' }] }]
      })
    ];
    const [entry] = UniqueErrorsReporter.buildUniqueErrors(results);
    expect(entry.isSystemic).toBe(false);
  });

  it('sorts results critical → serious → moderate → minor, then by domain count descending', () => {
    const results = [
      makeTarget({
        targetId: 'cms-gov',
        pages: [{
          url: 'https://cms.gov/',
          violations: [
            { id: 'minor-rule', severity: 'minor' },
            { id: 'critical-rule', severity: 'critical' },
            { id: 'moderate-rule', severity: 'moderate' }
          ]
        }]
      })
    ];
    const entries = UniqueErrorsReporter.buildUniqueErrors(results);
    expect(entries[0].severity).toBe('critical');
    expect(entries[1].severity).toBe('moderate');
    expect(entries[2].severity).toBe('minor');
  });

  it('cross-domain rules appear before single-domain rules of the same severity', () => {
    const results = [
      makeTarget({
        targetId: 'cms-gov',
        pages: [{ url: 'https://cms.gov/', violations: [{ id: 'image-alt', severity: 'serious' }] }]
      }),
      makeTarget({
        targetId: 'hhs-gov',
        pages: [{ url: 'https://hhs.gov/', violations: [
          { id: 'image-alt', severity: 'serious' },
          { id: 'label', severity: 'serious' }
        ]}]
      })
    ];
    const entries = UniqueErrorsReporter.buildUniqueErrors(results);
    const imageAlt = entries.find(e => e.ruleId === 'image-alt')!;
    const label = entries.find(e => e.ruleId === 'label')!;
    expect(entries.indexOf(imageAlt)).toBeLessThan(entries.indexOf(label));
  });

  it('collects CSS selector patterns from instances', () => {
    const results = [
      makeTarget({
        targetId: 'cms-gov',
        pages: [{
          url: 'https://cms.gov/',
          violations: [{
            id: 'image-alt',
            severity: 'serious',
            instances: [
              { html: '<img>', target: ['#header img', '.hero img'], failureSummary: 'Fix' }
            ]
          }]
        }]
      })
    ];
    const [entry] = UniqueErrorsReporter.buildUniqueErrors(results);
    const pageEntry = entry.domains[0].affectedPages[0];
    expect(pageEntry.selectorPatterns).toContain('#header img');
    expect(pageEntry.selectorPatterns).toContain('.hero img');
  });

  it('deduplicates selectors within a page', () => {
    const results = [
      makeTarget({
        targetId: 'cms-gov',
        pages: [{
          url: 'https://cms.gov/',
          violations: [{
            id: 'image-alt',
            severity: 'serious',
            instances: [
              { html: '<img>', target: ['.hero img'], failureSummary: 'Fix' },
              { html: '<img>', target: ['.hero img'], failureSummary: 'Fix' }
            ]
          }]
        }]
      })
    ];
    const [entry] = UniqueErrorsReporter.buildUniqueErrors(results);
    expect(entry.domains[0].affectedPages[0].selectorPatterns).toEqual(['.hero img']);
  });

  it('correctly counts total instances across multiple pages and domains', () => {
    const results = [
      makeTarget({
        targetId: 'cms-gov',
        pages: [
          {
            url: 'https://cms.gov/a',
            violations: [{
              id: 'color-contrast', severity: 'serious',
              instances: [
                { html: '<p>', target: ['.p1'], failureSummary: 'Fix' },
                { html: '<p>', target: ['.p2'], failureSummary: 'Fix' }
              ]
            }]
          }
        ]
      }),
      makeTarget({
        targetId: 'hhs-gov',
        pages: [
          {
            url: 'https://hhs.gov/',
            violations: [{
              id: 'color-contrast', severity: 'serious',
              instances: [
                { html: '<span>', target: ['.s1'], failureSummary: 'Fix' }
              ]
            }]
          }
        ]
      })
    ];
    const [entry] = UniqueErrorsReporter.buildUniqueErrors(results);
    expect(entry.totalInstanceCount).toBe(3);
    expect(entry.totalPageCount).toBe(2);
    expect(entry.totalDomainCount).toBe(2);
  });

  it('promotes severity when the same rule has different severities across domains', () => {
    // 'image-alt' reported as 'minor' on one domain but 'critical' on another
    const results = [
      makeTarget({
        targetId: 'cms-gov',
        pages: [{ url: 'https://cms.gov/', violations: [{ id: 'image-alt', severity: 'minor' }] }]
      }),
      makeTarget({
        targetId: 'hhs-gov',
        pages: [{ url: 'https://hhs.gov/', violations: [{ id: 'image-alt', severity: 'critical' }] }]
      })
    ];
    const [entry] = UniqueErrorsReporter.buildUniqueErrors(results);
    expect(entry.severity).toBe('critical');
  });

  it('ignores pages with no liveAudits', () => {
    const target: TargetScanResult = {
      targetId: 'cms-gov',
      domain: 'https://cms.gov',
      scanDurationMs: 1000,
      pagesScanned: [
        {
          url: 'https://cms.gov/',
          timestamp: new Date().toISOString(),
          status: 'SKIPPED_UNCHANGED',
          errorMessage: null,
          technologyStack: [],
          liveAudits: null,
          offlineAudits: null
        }
      ]
    };
    expect(UniqueErrorsReporter.buildUniqueErrors([target])).toEqual([]);
  });

  it('ignores violation entries with empty rule IDs', () => {
    const results = [
      makeTarget({
        targetId: 'cms-gov',
        pages: [{
          url: 'https://cms.gov/',
          violations: [
            { id: '', severity: 'serious' },
            { id: '   ', severity: 'moderate' }
          ]
        }]
      })
    ];
    expect(UniqueErrorsReporter.buildUniqueErrors(results)).toHaveLength(0);
  });
});
