import { describe, expect, it } from 'vitest';
import { DomainRatingScorer, scoreToLetterGrade } from '../../src/engine/reporters/domain-rating';
import { TargetScanResult } from '../../src/types/site-quality-spec';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: {
  targetId?: string;
  domain?: string;
  pages?: Array<{
    url: string;
    violations?: Array<{
      id: string;
      severity: 'critical' | 'serious' | 'moderate' | 'minor';
      instanceCount?: number;
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
        description: `Description for ${v.id}`,
        helpUrl: `https://dequeuniversity.com/rules/axe/4.10/${v.id}`,
        impactedCriteria: ['wcag2aa'],
        instances: Array.from({ length: v.instanceCount ?? 1 }, (_, i) => ({
          html: `<div id="${v.id}-${i}">`,
          target: [`.${v.id}-target`],
          failureSummary: 'Fix this'
        }))
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
    targetId: overrides.targetId ?? 'test-target',
    domain: overrides.domain ?? 'https://example.org',
    scanDurationMs: 1000,
    pagesScanned: pages
  };
}

// ---------------------------------------------------------------------------
// scoreToLetterGrade
// ---------------------------------------------------------------------------

describe('scoreToLetterGrade', () => {
  it('maps 100 to A+', () => expect(scoreToLetterGrade(100)).toBe('A+'));
  it('maps 97 to A+', () => expect(scoreToLetterGrade(97)).toBe('A+'));
  it('maps 96 to A', () => expect(scoreToLetterGrade(96)).toBe('A'));
  it('maps 93 to A', () => expect(scoreToLetterGrade(93)).toBe('A'));
  it('maps 92 to A-', () => expect(scoreToLetterGrade(92)).toBe('A-'));
  it('maps 90 to A-', () => expect(scoreToLetterGrade(90)).toBe('A-'));
  it('maps 89 to B+', () => expect(scoreToLetterGrade(89)).toBe('B+'));
  it('maps 87 to B+', () => expect(scoreToLetterGrade(87)).toBe('B+'));
  it('maps 86 to B', () => expect(scoreToLetterGrade(86)).toBe('B'));
  it('maps 83 to B', () => expect(scoreToLetterGrade(83)).toBe('B'));
  it('maps 82 to B-', () => expect(scoreToLetterGrade(82)).toBe('B-'));
  it('maps 80 to B-', () => expect(scoreToLetterGrade(80)).toBe('B-'));
  it('maps 79 to C+', () => expect(scoreToLetterGrade(79)).toBe('C+'));
  it('maps 77 to C+', () => expect(scoreToLetterGrade(77)).toBe('C+'));
  it('maps 76 to C', () => expect(scoreToLetterGrade(76)).toBe('C'));
  it('maps 73 to C', () => expect(scoreToLetterGrade(73)).toBe('C'));
  it('maps 72 to C-', () => expect(scoreToLetterGrade(72)).toBe('C-'));
  it('maps 70 to C-', () => expect(scoreToLetterGrade(70)).toBe('C-'));
  it('maps 69 to D+', () => expect(scoreToLetterGrade(69)).toBe('D+'));
  it('maps 67 to D+', () => expect(scoreToLetterGrade(67)).toBe('D+'));
  it('maps 66 to D', () => expect(scoreToLetterGrade(66)).toBe('D'));
  it('maps 63 to D', () => expect(scoreToLetterGrade(63)).toBe('D'));
  it('maps 62 to D-', () => expect(scoreToLetterGrade(62)).toBe('D-'));
  it('maps 0 to D-', () => expect(scoreToLetterGrade(0)).toBe('D-'));
});

// ---------------------------------------------------------------------------
// DomainRatingScorer.buildDomainRating
// ---------------------------------------------------------------------------

describe('DomainRatingScorer.buildDomainRating', () => {
  it('scores A+ with zero violations', () => {
    const result = makeResult({ pages: [{ url: 'https://example.org/' }] });
    const rating = DomainRatingScorer.buildDomainRating(result, []);

    expect(rating.numericScore).toBe(100);
    expect(rating.letterGrade).toBe('A+');
    expect(rating.breakdown.critical.rawCount).toBe(0);
    expect(rating.breakdown.serious.rawCount).toBe(0);
    expect(rating.breakdown.moderate.rawCount).toBe(0);
    expect(rating.breakdown.minor.rawCount).toBe(0);
  });

  it('scores A+ with no pages scanned', () => {
    const result = makeResult({ pages: [] });
    const rating = DomainRatingScorer.buildDomainRating(result, []);

    expect(rating.numericScore).toBe(100);
    expect(rating.letterGrade).toBe('A+');
  });

  it('penalises critical violations more than minor', () => {
    const singlePage = [{ url: 'https://example.org/' }];
    const criticalResult = makeResult({
      pages: [{ url: singlePage[0].url, violations: [{ id: 'rule-a', severity: 'critical' }] }]
    });
    const minorResult = makeResult({
      pages: [{ url: singlePage[0].url, violations: [{ id: 'rule-b', severity: 'minor' }] }]
    });

    const criticalRating = DomainRatingScorer.buildDomainRating(criticalResult, []);
    const minorRating = DomainRatingScorer.buildDomainRating(minorResult, []);

    expect(criticalRating.numericScore).toBeLessThan(minorRating.numericScore);
    expect(criticalRating.breakdown.critical.uniqueRuleCount).toBe(1);
    expect(minorRating.breakdown.minor.uniqueRuleCount).toBe(1);
  });

  it('applies systemic multiplier when the same rule fires on 3 or more pages', () => {
    const nonSystemicResult = makeResult({
      pages: [
        { url: 'https://example.org/p1', violations: [{ id: 'rule-x', severity: 'serious' }] },
        { url: 'https://example.org/p2', violations: [{ id: 'rule-x', severity: 'serious' }] }
        // only 2 pages → NOT systemic
      ]
    });

    const systemicResult = makeResult({
      pages: [
        { url: 'https://example.org/p1', violations: [{ id: 'rule-x', severity: 'serious' }] },
        { url: 'https://example.org/p2', violations: [{ id: 'rule-x', severity: 'serious' }] },
        { url: 'https://example.org/p3', violations: [{ id: 'rule-x', severity: 'serious' }] }
        // 3 pages → systemic
      ]
    });

    const nonSystemicRating = DomainRatingScorer.buildDomainRating(nonSystemicResult, []);
    const systemicRating = DomainRatingScorer.buildDomainRating(systemicResult, []);

    // Systemic version should have lower score (higher penalty per page pair)
    expect(systemicRating.breakdown.serious.systemicCount).toBe(1);
    expect(nonSystemicRating.breakdown.serious.systemicCount).toBe(0);

    // Same number of pages, but systemic penalty is 1.75× so per-page penalty is higher
    expect(systemicRating.numericScore).toBeLessThan(nonSystemicRating.numericScore);
  });

  it('does not mark a rule as systemic when it fires on fewer than 3 pages', () => {
    const result = makeResult({
      pages: [
        { url: 'https://example.org/p1', violations: [{ id: 'rule-y', severity: 'moderate' }] },
        { url: 'https://example.org/p2', violations: [{ id: 'rule-y', severity: 'moderate' }] }
      ]
    });

    const rating = DomainRatingScorer.buildDomainRating(result, []);

    expect(rating.breakdown.moderate.systemicCount).toBe(0);
  });

  it('applies priority-page multiplier when the failing page is in the seed list', () => {
    const pageUrl = 'https://example.org/';

    const withoutPriorityRating = DomainRatingScorer.buildDomainRating(
      makeResult({ pages: [{ url: pageUrl, violations: [{ id: 'rule-z', severity: 'serious' }] }] }),
      [] // no seed URLs
    );

    const withPriorityRating = DomainRatingScorer.buildDomainRating(
      makeResult({ pages: [{ url: pageUrl, violations: [{ id: 'rule-z', severity: 'serious' }] }] }),
      [pageUrl] // page is a priority page
    );

    expect(withPriorityRating.breakdown.serious.priorityPageCount).toBe(1);
    expect(withoutPriorityRating.breakdown.serious.priorityPageCount).toBe(0);
    expect(withPriorityRating.numericScore).toBeLessThan(withoutPriorityRating.numericScore);
  });

  it('counts rawCount as the sum of all violation instances, not unique rules', () => {
    const result = makeResult({
      pages: [{
        url: 'https://example.org/',
        violations: [
          { id: 'rule-a', severity: 'critical', instanceCount: 5 },
          { id: 'rule-b', severity: 'critical', instanceCount: 3 }
        ]
      }]
    });

    const rating = DomainRatingScorer.buildDomainRating(result, []);

    expect(rating.breakdown.critical.rawCount).toBe(8); // 5 + 3
    expect(rating.breakdown.critical.uniqueRuleCount).toBe(2);
  });

  it('deduplicates the same rule on the same page (counts once per page)', () => {
    // Even if a violation appears multiple times (via instances), the per-page
    // penalty for a rule is applied once.
    const resultWith1Instance = makeResult({
      pages: [{ url: 'https://example.org/', violations: [{ id: 'rule-a', severity: 'minor', instanceCount: 1 }] }]
    });
    const resultWith10Instances = makeResult({
      pages: [{ url: 'https://example.org/', violations: [{ id: 'rule-a', severity: 'minor', instanceCount: 10 }] }]
    });

    const r1 = DomainRatingScorer.buildDomainRating(resultWith1Instance, []);
    const r10 = DomainRatingScorer.buildDomainRating(resultWith10Instances, []);

    // Penalty is per unique (rule, page) pair regardless of instance count
    expect(r1.numericScore).toBe(r10.numericScore);
    expect(r1.breakdown.minor.weightedPenalty).toBe(r10.breakdown.minor.weightedPenalty);
  });

  it('populates priority-page coverage stats correctly', () => {
    const seed1 = 'https://example.org/popular';
    const seed2 = 'https://example.org/news';

    const result = makeResult({
      pages: [
        { url: seed1, violations: [{ id: 'rule-a', severity: 'minor' }] },
        { url: seed2 }, // no violations
        { url: 'https://example.org/deep' } // not in seed list
      ]
    });

    const rating = DomainRatingScorer.buildDomainRating(result, [seed1, seed2]);

    expect(rating.priorityPageCoverage.totalPriorityPages).toBe(2);
    expect(rating.priorityPageCoverage.pagesWithViolations).toBe(1);
    expect(rating.priorityPageCoverage.violationShareOnPriorityPages).toBeCloseTo(0.5, 4);
  });
});

// ---------------------------------------------------------------------------
// DomainRatingScorer.buildAllDomainRatings
// ---------------------------------------------------------------------------

describe('DomainRatingScorer.buildAllDomainRatings', () => {
  it('returns an empty array when allResults is empty', () => {
    const ratings = DomainRatingScorer.buildAllDomainRatings([], null);
    expect(ratings).toHaveLength(0);
  });

  it('sorts results best score first', () => {
    const clean = makeResult({
      targetId: 'clean-site',
      pages: [{ url: 'https://clean.example.org/' }]
    });
    const dirty = makeResult({
      targetId: 'dirty-site',
      pages: [{ url: 'https://dirty.example.org/', violations: [{ id: 'critical-rule', severity: 'critical' }] }]
    });

    const ratings = DomainRatingScorer.buildAllDomainRatings([dirty, clean], null);

    expect(ratings[0].targetId).toBe('clean-site');
    expect(ratings[1].targetId).toBe('dirty-site');
  });

  it('uses seed URLs from the snapshot when available', () => {
    const pageUrl = 'https://example.org/home';
    const result = makeResult({
      targetId: 'my-site',
      pages: [{ url: pageUrl, violations: [{ id: 'rule-a', severity: 'serious' }] }]
    });

    const snapshot = {
      generatedAt: new Date().toISOString(),
      strategy: 'duckduckgo-site-query' as const,
      targets: [
        {
          targetId: 'my-site',
          host: 'example.org',
          domain: 'https://example.org',
          fetchedAt: new Date().toISOString(),
          source: 'duckduckgo' as const,
          estimatedIndexedPages: null,
          topUrls: [pageUrl]
        }
      ]
    };

    const withSnapshot = DomainRatingScorer.buildAllDomainRatings([result], snapshot);
    const withoutSnapshot = DomainRatingScorer.buildAllDomainRatings([result], null);

    // With snapshot the page is a priority page so penalty is higher → lower score
    expect(withSnapshot[0].breakdown.serious.priorityPageCount).toBe(1);
    expect(withSnapshot[0].numericScore).toBeLessThan(withoutSnapshot[0].numericScore);
  });
});

// ---------------------------------------------------------------------------
// DomainRatingScorer.buildPenaltyDriverSummary
// ---------------------------------------------------------------------------

describe('DomainRatingScorer.buildPenaltyDriverSummary', () => {
  it('reports "No violations detected" for a clean domain', () => {
    const result = makeResult({ pages: [{ url: 'https://example.org/' }] });
    const rating = DomainRatingScorer.buildDomainRating(result, []);
    expect(DomainRatingScorer.buildPenaltyDriverSummary(rating)).toBe('No violations detected');
  });

  it('surfaces the highest-severity driver first', () => {
    const result = makeResult({
      pages: [{
        url: 'https://example.org/',
        violations: [
          { id: 'minor-rule', severity: 'minor' },
          { id: 'critical-rule', severity: 'critical' }
        ]
      }]
    });
    const rating = DomainRatingScorer.buildDomainRating(result, []);
    const summary = DomainRatingScorer.buildPenaltyDriverSummary(rating);
    expect(summary).toMatch(/critical/i);
    expect(summary).not.toMatch(/minor/i);
  });

  it('includes "systemic" annotation when critical rules are systemic', () => {
    const result = makeResult({
      pages: [
        { url: 'https://example.org/p1', violations: [{ id: 'crit-rule', severity: 'critical' }] },
        { url: 'https://example.org/p2', violations: [{ id: 'crit-rule', severity: 'critical' }] },
        { url: 'https://example.org/p3', violations: [{ id: 'crit-rule', severity: 'critical' }] }
      ]
    });
    const rating = DomainRatingScorer.buildDomainRating(result, []);
    const summary = DomainRatingScorer.buildPenaltyDriverSummary(rating);
    expect(summary).toContain('systemic');
  });

  it('includes priority-page annotation when violations hit priority pages', () => {
    const priorityUrl = 'https://example.org/home';
    const result = makeResult({
      pages: [{ url: priorityUrl, violations: [{ id: 'critical-rule', severity: 'critical' }] }]
    });
    const rating = DomainRatingScorer.buildDomainRating(result, [priorityUrl]);
    const summary = DomainRatingScorer.buildPenaltyDriverSummary(rating);
    expect(summary).toContain('priority page');
  });
});
