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

/** Violation severity counts for a weekly aggregate. */
export interface SeverityCount {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
}

/** Weekly aggregated rating for a single domain (7-day window). */
export interface WeeklyDomainRating {
  targetId: string;
  domain: string;
  weekStart: string;
  weekEnd: string;
  /** Number of distinct pages scanned in this week. */
  pagesCovered: number;
  /** Estimated indexed pages for this domain (from DuckDuckGo seed data). */
  estimatedSize: number | null;
  /** Violation counts by severity across all pages in the window. */
  violationCounts: SeverityCount;
  /** Numeric compliance score 0–100 (same methodology as per-run, but 7-day window). */
  scoreNumerical: number;
  /** Letter grade mapped from scoreNumerical. */
  letterGrade: LetterGrade;
}

/** Per-run domain snapshot: single run's aggregated metrics. */
export interface PerRunDomainSnapshot {
  runId: string;
  generatedAt: string;
  targetId: string;
  domain: string;
  /** Number of pages completed in this run. */
  pagesCompleted: number;
  /** Number of pages skipped (cached) in this run. */
  pagesSkipped: number;
  /** Total pages processed (completed + skipped). */
  pagesTotalScanned: number;
  /** Violation counts from pages with COMPLETED status. */
  violationCounts: SeverityCount;
  /** Numeric score from this run. */
  scoreNumerical: number;
  /** Letter grade from this run. */
  letterGrade: LetterGrade;
}

/** Week-over-week compliance trend point. */
export interface WeeklyTrendPoint {
  weekStart: string;
  weekEnd: string;
  /** Total unique pages scanned in this week. */
  totalPages: number;
  /** Total violations recorded in this week. */
  violationsCount: number;
  /** Pages with zero violations. */
  compliantPages: number;
  /** Compliance percentage 0–100. */
  compliancePercent: number;
}

/** Rule frequency aggregate over a time window. */
export interface WeeklyRuleFrequency {
  ruleId: string;
  occurrences: number;
  affectedPages: number;
  severities: SeverityCount;
  /** Severity distribution. */
  mostCommonSeverity: 'critical' | 'serious' | 'moderate' | 'minor';
}

/** Metadata for a historical run. */
export interface RunDirectoryEntry {
  runId: string;
  generatedAt: string;
  pagesScanned: number;
  pagesCompleted: number;
  pagesSkipped: number;
  totalViolations: number;
  qualityIndexScore: number;
}
