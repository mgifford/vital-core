import { TargetScanResult } from '../../types/site-quality-spec';
import { DomainAccessibilityRating, LetterGrade, SeverityRatingBreakdown } from '../../types/domain-rating';
import { PrioritySeedSnapshot } from '../priority-seeds';

type IssueSeverity = 'critical' | 'serious' | 'moderate' | 'minor';

const SEVERITY_WEIGHTS: Record<IssueSeverity, {
  basePenalty: number;
  systemicMultiplier: number;
  priorityMultiplier: number;
}> = {
  critical: { basePenalty: 8,   systemicMultiplier: 2.00, priorityMultiplier: 1.50 },
  serious:  { basePenalty: 5,   systemicMultiplier: 1.75, priorityMultiplier: 1.30 },
  moderate: { basePenalty: 2.5, systemicMultiplier: 1.50, priorityMultiplier: 1.15 },
  minor:    { basePenalty: 1,   systemicMultiplier: 1.20, priorityMultiplier: 1.05 }
};

/**
 * Minimum number of pages a rule must fire on to be considered systemic.
 * Systemic violations receive a higher penalty multiplier.
 */
const SYSTEMIC_PAGE_THRESHOLD = 3;

/**
 * Scales the normalised per-page penalty to a 0–100 score.
 * Higher = stricter (lower scores for the same number of violations).
 */
const GRADE_SCALE_FACTOR = 4;

/**
 * Ordered thresholds (highest first) that map a numeric score to a letter grade.
 */
const GRADE_THRESHOLDS: Array<{ min: number; grade: LetterGrade }> = [
  { min: 97, grade: 'A+' },
  { min: 93, grade: 'A'  },
  { min: 90, grade: 'A-' },
  { min: 87, grade: 'B+' },
  { min: 83, grade: 'B'  },
  { min: 80, grade: 'B-' },
  { min: 77, grade: 'C+' },
  { min: 73, grade: 'C'  },
  { min: 70, grade: 'C-' },
  { min: 67, grade: 'D+' },
  { min: 63, grade: 'D'  },
  { min:  0, grade: 'D-' }
];

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

/** Maps a numeric 0–100 score to a LetterGrade. */
export function scoreToLetterGrade(score: number): LetterGrade {
  for (const threshold of GRADE_THRESHOLDS) {
    if (score >= threshold.min) {
      return threshold.grade;
    }
  }
  return 'D-';
}

function emptyBreakdown(): SeverityRatingBreakdown {
  return { rawCount: 0, uniqueRuleCount: 0, systemicCount: 0, priorityPageCount: 0, weightedPenalty: 0 };
}

/**
 * Computes per-domain accessibility ratings that go beyond raw violation counts.
 *
 * Three factors contribute to the penalty:
 *  1. Severity weight – calibrated to WCAG 2.2 AA impact (critical 8 pts → minor 1 pt).
 *  2. Systemic multiplier – applied when the same rule fires on ≥3 pages.
 *  3. Priority-page multiplier – applied when the failing page is in the
 *     DuckDuckGo-seeded top-URL list for the domain.
 */
export class DomainRatingScorer {
  /**
   * Scores a single domain and returns its full rating.
   *
   * @param result   Scan results for one target.
   * @param seedUrls Top-task URLs from DuckDuckGo for this domain (may be empty).
   */
  public static buildDomainRating(result: TargetScanResult, seedUrls: string[]): DomainAccessibilityRating {
    const seedSet = new Set(seedUrls.map(u => {
      try {
        const parsed = new URL(u);
        parsed.hash = '';
        return parsed.toString();
      } catch {
        return u;
      }
    }));

    const totalPages = result.pagesScanned.length;

    // --- Step 1: gather unique (ruleId, pageUrl, severity) pairs ---
    // Deduplicate so the same rule on the same page counts once regardless of how
    // many failing instances the rule reports.
    interface ViolationPair {
      ruleId: string;
      pageUrl: string;
      severity: IssueSeverity;
    }

    const pairs: ViolationPair[] = [];
    const ruleToPageUrls = new Map<string, Set<string>>();
    const rawCounts: Record<IssueSeverity, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };

    for (const page of result.pagesScanned) {
      const violations = page.liveAudits?.accessibilityViolations ?? [];
      const seenRulesOnPage = new Set<string>();

      for (const v of violations) {
        const severity = v.severity as IssueSeverity;
        rawCounts[severity] += v.instances.length;

        const ruleId = String(v.id || '').trim();
        if (!ruleId || seenRulesOnPage.has(ruleId)) {
          continue;
        }
        seenRulesOnPage.add(ruleId);

        if (!ruleToPageUrls.has(ruleId)) {
          ruleToPageUrls.set(ruleId, new Set());
        }
        ruleToPageUrls.get(ruleId)!.add(page.url);
        pairs.push({ ruleId, pageUrl: page.url, severity });
      }
    }

    // --- Step 2: identify systemic rules ---
    const systemicRules = new Set<string>();
    for (const [ruleId, pages] of ruleToPageUrls) {
      if (pages.size >= SYSTEMIC_PAGE_THRESHOLD) {
        systemicRules.add(ruleId);
      }
    }

    // --- Step 3: build per-severity breakdowns and total penalty ---
    const breakdowns: Record<IssueSeverity, SeverityRatingBreakdown> = {
      critical: emptyBreakdown(),
      serious:  emptyBreakdown(),
      moderate: emptyBreakdown(),
      minor:    emptyBreakdown()
    };

    const uniqueRulesBySeverity: Record<IssueSeverity, Set<string>> = {
      critical: new Set(), serious: new Set(), moderate: new Set(), minor: new Set()
    };
    const systemicRulesBySeverity: Record<IssueSeverity, Set<string>> = {
      critical: new Set(), serious: new Set(), moderate: new Set(), minor: new Set()
    };

    let totalWeightedPenalty = 0;

    for (const { ruleId, pageUrl, severity } of pairs) {
      const weights = SEVERITY_WEIGHTS[severity];
      const isSystemic = systemicRules.has(ruleId);
      const isPriorityPage = seedSet.has(pageUrl);

      const penalty = weights.basePenalty
        * (isSystemic ? weights.systemicMultiplier : 1)
        * (isPriorityPage ? weights.priorityMultiplier : 1);

      uniqueRulesBySeverity[severity].add(ruleId);
      if (isSystemic) {
        systemicRulesBySeverity[severity].add(ruleId);
      }
      if (isPriorityPage) {
        breakdowns[severity].priorityPageCount += 1;
      }
      breakdowns[severity].weightedPenalty = Number(
        (breakdowns[severity].weightedPenalty + penalty).toFixed(4)
      );
      totalWeightedPenalty += penalty;
    }

    for (const sev of ['critical', 'serious', 'moderate', 'minor'] as IssueSeverity[]) {
      breakdowns[sev].rawCount = rawCounts[sev];
      breakdowns[sev].uniqueRuleCount = uniqueRulesBySeverity[sev].size;
      breakdowns[sev].systemicCount = systemicRulesBySeverity[sev].size;
    }

    // --- Step 4: normalise penalty by page count and compute score ---
    const normalizedPenalty = totalPages > 0 ? totalWeightedPenalty / totalPages : 0;
    const numericScore = clampScore(100 - normalizedPenalty * GRADE_SCALE_FACTOR);
    const letterGrade = scoreToLetterGrade(numericScore);

    // --- Step 5: priority-page coverage stats ---
    const priorityPageUrls = seedUrls.map(u => {
      try {
        const parsed = new URL(u);
        parsed.hash = '';
        return parsed.toString();
      } catch {
        return u;
      }
    });

    const scannedPageUrls = new Set(result.pagesScanned.map(p => p.url));
    const pagesWithAnyViolation = new Set(
      result.pagesScanned
        .filter(p => (p.liveAudits?.accessibilityViolations ?? []).length > 0)
        .map(p => p.url)
    );

    const relevantPriorityUrls = priorityPageUrls.filter(u => scannedPageUrls.has(u));
    const priorityPagesWithViolations = relevantPriorityUrls.filter(u => pagesWithAnyViolation.has(u));
    const totalPriorityPages = relevantPriorityUrls.length;
    const pagesWithViolations = priorityPagesWithViolations.length;

    return {
      targetId: result.targetId,
      domain: result.domain,
      numericScore,
      letterGrade,
      breakdown: {
        critical: breakdowns.critical,
        serious:  breakdowns.serious,
        moderate: breakdowns.moderate,
        minor:    breakdowns.minor
      },
      priorityPageCoverage: {
        totalPriorityPages,
        pagesWithViolations,
        violationShareOnPriorityPages: totalPriorityPages > 0
          ? Number((pagesWithViolations / totalPriorityPages).toFixed(4))
          : 0
      }
    };
  }

  /**
   * Scores all targets and returns ratings sorted best grade first.
   *
   * @param allResults  All scan results from the current run.
   * @param snapshot    Current DuckDuckGo priority-seed snapshot (may be null).
   */
  public static buildAllDomainRatings(
    allResults: TargetScanResult[],
    snapshot: PrioritySeedSnapshot | null
  ): DomainAccessibilityRating[] {
    return allResults
      .map(result => {
        const seedEntry = snapshot?.targets.find(t => t.targetId === result.targetId);
        const seedUrls = seedEntry?.topUrls ?? [];
        return this.buildDomainRating(result, seedUrls);
      })
      .sort((a, b) => b.numericScore - a.numericScore);
  }

  /** Returns a one-line human summary of the main penalty driver. */
  public static buildPenaltyDriverSummary(rating: DomainAccessibilityRating): string {
    const { critical, serious, moderate, minor } = rating.breakdown;

    if (critical.uniqueRuleCount > 0) {
      const systemic = critical.systemicCount > 0
        ? `, ${critical.systemicCount} systemic`
        : '';
      const priority = critical.priorityPageCount > 0
        ? `, ${critical.priorityPageCount} on priority page${critical.priorityPageCount > 1 ? 's' : ''}`
        : '';
      return `${critical.uniqueRuleCount} critical rule${critical.uniqueRuleCount > 1 ? 's' : ''}${systemic}${priority}`;
    }

    if (serious.uniqueRuleCount > 0) {
      const systemic = serious.systemicCount > 0
        ? `, ${serious.systemicCount} systemic`
        : '';
      const priority = serious.priorityPageCount > 0
        ? `, ${serious.priorityPageCount} on priority page${serious.priorityPageCount > 1 ? 's' : ''}`
        : '';
      return `${serious.uniqueRuleCount} serious rule${serious.uniqueRuleCount > 1 ? 's' : ''}${systemic}${priority}`;
    }

    if (moderate.uniqueRuleCount > 0) {
      return `${moderate.uniqueRuleCount} moderate rule${moderate.uniqueRuleCount > 1 ? 's' : ''}`;
    }

    if (minor.uniqueRuleCount > 0) {
      return `${minor.uniqueRuleCount} minor rule${minor.uniqueRuleCount > 1 ? 's' : ''}`;
    }

    return 'No violations detected';
  }
}
