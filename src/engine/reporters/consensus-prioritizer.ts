import { TargetScanResult } from '../../types/site-quality-spec';
import { NormalizedFindingAdapter } from './normalized-finding-adapter';

export interface ConsensusSummary {
  consensusFailure: number;
  alfaOnlyFailure: number;
  axeOnlyFailure: number;
  totalCorrelatedFindings: number;
}

interface CorrelatedFinding {
  key: string;
  pageUrl: string;
  canonicalRuleKey: string;
  severity: 'critical' | 'serious' | 'moderate' | 'minor';
  hasAlfa: boolean;
  hasAxe: boolean;
}

export class ConsensusPrioritizer {
  public static buildSummary(allResults: TargetScanResult[]): ConsensusSummary {
    const correlated = this.correlateFindings(allResults);

    let consensusFailure = 0;
    let alfaOnlyFailure = 0;
    let axeOnlyFailure = 0;

    for (const finding of correlated) {
      if (finding.hasAlfa && finding.hasAxe) {
        consensusFailure += 1;
      } else if (finding.hasAlfa) {
        alfaOnlyFailure += 1;
      } else if (finding.hasAxe) {
        axeOnlyFailure += 1;
      }
    }

    return {
      consensusFailure,
      alfaOnlyFailure,
      axeOnlyFailure,
      totalCorrelatedFindings: correlated.length
    };
  }

  private static correlateFindings(allResults: TargetScanResult[]): CorrelatedFinding[] {
    const grouped = new Map<string, CorrelatedFinding>();

    for (const target of allResults) {
      for (const page of target.pagesScanned) {
        const pageUrl = page.url;
        const axeFindings = NormalizedFindingAdapter.fromAxeViolations(pageUrl, page.liveAudits?.accessibilityViolations || []);
        const alfaFindings = NormalizedFindingAdapter.fromAlfaAudit(pageUrl, page.alfaAudits);

        for (const finding of axeFindings) {
          this.mergeFinding(grouped, pageUrl, finding.canonicalRuleKey, finding.severity, false, true);
        }

        for (const finding of alfaFindings) {
          this.mergeFinding(grouped, pageUrl, finding.canonicalRuleKey, finding.severity, true, false);
        }
      }
    }

    return Array.from(grouped.values()).sort((a, b) => this.severityRank(a.severity) - this.severityRank(b.severity));
  }

  private static mergeFinding(
    grouped: Map<string, CorrelatedFinding>,
    pageUrl: string,
    canonicalRuleKey: string,
    severity: 'critical' | 'serious' | 'moderate' | 'minor',
    hasAlfa: boolean,
    hasAxe: boolean
  ): void {
    const canonicalBase = this.toCanonicalBase(canonicalRuleKey);
    const key = `${pageUrl}::${canonicalBase}`;

    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        key,
        pageUrl,
        canonicalRuleKey: canonicalBase,
        severity,
        hasAlfa,
        hasAxe
      });
      return;
    }

    existing.hasAlfa = existing.hasAlfa || hasAlfa;
    existing.hasAxe = existing.hasAxe || hasAxe;
    if (this.severityRank(severity) < this.severityRank(existing.severity)) {
      existing.severity = severity;
    }
  }

  private static toCanonicalBase(canonicalRuleKey: string): string {
    return String(canonicalRuleKey || '')
      .replace(/^axe:/i, '')
      .replace(/^alfa:/i, '')
      .trim()
      .toLowerCase();
  }

  private static severityRank(value: 'critical' | 'serious' | 'moderate' | 'minor'): number {
    if (value === 'critical') return 0;
    if (value === 'serious') return 1;
    if (value === 'moderate') return 2;
    return 3;
  }
}