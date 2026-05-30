import { TargetScanResult } from '../../types/site-quality-spec';

export interface QualityIndexBreakdown {
  accessibilityScore: number;
  contentQualityScore: number;
  reliabilityScore: number;
  linkIntegrityScore: number;
}

export interface QualityIndexResult {
  score: number;
  gateStatus: 'PASS' | 'WARNING' | 'BLOCKED';
  breakdown: QualityIndexBreakdown;
  evidence: {
    pages: number;
    completedPages: number;
    violations: {
      critical: number;
      serious: number;
      moderate: number;
      minor: number;
      total: number;
    };
    suspiciousAltTextCount: number;
    brokenLinks: {
      checked: number;
      broken: number;
    };
  };
}

const WEIGHTS = {
  accessibility: 0.6,
  contentQuality: 0.15,
  reliability: 0.15,
  linkIntegrity: 0.1
} as const;

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

export class QualityIndexReporter {
  public static buildQualityIndex(allResults: TargetScanResult[]): QualityIndexResult {
    const pages = allResults.reduce((sum, target) => sum + target.pagesScanned.length, 0);

    let completedPages = 0;
    let critical = 0;
    let serious = 0;
    let moderate = 0;
    let minor = 0;
    let suspiciousAltTextCount = 0;
    let totalCheckedLinks = 0;
    let brokenLinks = 0;

    for (const target of allResults) {
      for (const page of target.pagesScanned) {
        if (page.status === 'COMPLETED') {
          completedPages += 1;
        }

        for (const violation of page.liveAudits?.accessibilityViolations ?? []) {
          if (violation.severity === 'critical') critical += 1;
          if (violation.severity === 'serious') serious += 1;
          if (violation.severity === 'moderate') moderate += 1;
          if (violation.severity === 'minor') minor += 1;
        }

        suspiciousAltTextCount += page.offlineAudits?.contentMetrics.suspiciousAltTextCount ?? 0;
        totalCheckedLinks += page.offlineAudits?.linkHealth.totalChecked ?? 0;
        brokenLinks += page.offlineAudits?.linkHealth.brokenCount ?? 0;
      }
    }

    const weightedViolationPoints = (critical * 4) + (serious * 3) + (moderate * 2) + minor;
    const perPageViolationPoints = pages > 0 ? weightedViolationPoints / pages : 0;
    const accessibilityScore = clampScore(100 - (perPageViolationPoints * 12));

    const suspiciousAltPerPage = pages > 0 ? suspiciousAltTextCount / pages : 0;
    const contentQualityScore = clampScore(100 - (suspiciousAltPerPage * 20));

    const reliabilityScore = pages > 0 ? clampScore((completedPages / pages) * 100) : 0;

    const brokenRate = totalCheckedLinks > 0 ? brokenLinks / totalCheckedLinks : 0;
    const linkIntegrityScore = clampScore(100 - (brokenRate * 100));

    const weightedScore = (
      (accessibilityScore * WEIGHTS.accessibility) +
      (contentQualityScore * WEIGHTS.contentQuality) +
      (reliabilityScore * WEIGHTS.reliability) +
      (linkIntegrityScore * WEIGHTS.linkIntegrity)
    );
    const score = clampScore(weightedScore);

    let gateStatus: QualityIndexResult['gateStatus'] = 'PASS';
    if (critical > 0) {
      gateStatus = 'BLOCKED';
    } else if (serious > 0 || score < 75) {
      gateStatus = 'WARNING';
    }

    return {
      score,
      gateStatus,
      breakdown: {
        accessibilityScore,
        contentQualityScore,
        reliabilityScore,
        linkIntegrityScore
      },
      evidence: {
        pages,
        completedPages,
        violations: {
          critical,
          serious,
          moderate,
          minor,
          total: critical + serious + moderate + minor
        },
        suspiciousAltTextCount,
        brokenLinks: {
          checked: totalCheckedLinks,
          broken: brokenLinks
        }
      }
    };
  }
}
