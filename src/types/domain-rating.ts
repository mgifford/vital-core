/**
 * Letter grade scale for per-domain accessibility ratings.
 *
 * Grades reflect weighted WCAG 2.2 AA compliance, factoring in:
 * - violation severity (critical → minor)
 * - systemic recurrence (same rule on ≥3 pages)
 * - page popularity (violations on DuckDuckGo-seeded priority pages)
 */
export type LetterGrade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-';

/** Per-severity contribution to the domain accessibility rating. */
export interface SeverityRatingBreakdown {
  /** Total violation instances (sum of all instances arrays across all pages). */
  rawCount: number;
  /** Number of distinct rule IDs that produce violations with this severity. */
  uniqueRuleCount: number;
  /** Number of distinct rule IDs that fire on 3 or more pages (systemic failures). */
  systemicCount: number;
  /** Number of (ruleId, pageUrl) pairs where the page appears in the DuckDuckGo seed list. */
  priorityPageCount: number;
  /** Total weighted penalty contributed by this severity to the domain score. */
  weightedPenalty: number;
}

/** Full accessibility rating for a single domain. */
export interface DomainAccessibilityRating {
  targetId: string;
  domain: string;
  /** Numeric score 0–100, where 100 is zero violations. */
  numericScore: number;
  /** Letter grade mapped from numericScore. */
  letterGrade: LetterGrade;
  breakdown: {
    critical: SeverityRatingBreakdown;
    serious: SeverityRatingBreakdown;
    moderate: SeverityRatingBreakdown;
    minor: SeverityRatingBreakdown;
  };
  /** Coverage stats for pages surfaced by DuckDuckGo as high-traffic. */
  priorityPageCoverage: {
    /** Total number of seed URLs provided for this domain. */
    totalPriorityPages: number;
    /** Number of seed URLs that have at least one violation. */
    pagesWithViolations: number;
    /** Fraction of priority pages that have violations (0–1). */
    violationShareOnPriorityPages: number;
  };
}
