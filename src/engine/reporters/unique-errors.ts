import { TargetScanResult } from '../../types/site-quality-spec';

export interface UniqueErrorPageEntry {
  url: string;
  instanceCount: number;
  /** CSS selector strings from axe-core `target` arrays, deduplicated. */
  selectorPatterns: string[];
}

export interface UniqueErrorDomainBreakdown {
  targetId: string;
  domain: string;
  pageCount: number;
  instanceCount: number;
  affectedPages: UniqueErrorPageEntry[];
}

export interface UniqueErrorEntry {
  ruleId: string;
  severity: 'critical' | 'serious' | 'moderate' | 'minor';
  description: string;
  helpUrl: string;
  wcagVersion: string;
  /** Number of distinct domains (targets) this rule fires on. */
  totalDomainCount: number;
  /** Total number of pages (across all domains) this rule fires on. */
  totalPageCount: number;
  /** Total number of failing instances (across all domains and pages). */
  totalInstanceCount: number;
  /**
   * True when this rule fires on 2 or more distinct domains, indicating a
   * systemic issue that is not isolated to a single site.
   */
  isSystemic: boolean;
  domains: UniqueErrorDomainBreakdown[];
}

const SEVERITY_ORDER: Array<UniqueErrorEntry['severity']> = ['critical', 'serious', 'moderate', 'minor'];

function severityRank(sev: string): number {
  const idx = SEVERITY_ORDER.indexOf(sev as UniqueErrorEntry['severity']);
  return idx === -1 ? SEVERITY_ORDER.length : idx;
}

/**
 * Identifies unique axe-core rule violations that appear across one or more
 * domains, enabling strategic prioritisation of system-level accessibility
 * problems rather than page-level issues.
 *
 * Grouping key: axe rule ID (`A11yViolation.id`).
 * For each rule the reporter records:
 *  - Which domains it appears on
 *  - How many pages and instances per domain
 *  - CSS selector patterns from the axe `target` arrays so that common
 *    structural patterns (e.g. shared CMS components) can be identified
 */
export class UniqueErrorsReporter {
  /**
   * Minimum number of domains a rule must fire on to be flagged as systemic.
   */
  public static readonly SYSTEMIC_DOMAIN_THRESHOLD = 2;

  /**
   * Builds the cross-domain unique-errors report from a set of scan results.
   *
   * Results are sorted by severity (critical → minor), then by number of
   * affected domains descending.
   */
  public static buildUniqueErrors(allResults: TargetScanResult[]): UniqueErrorEntry[] {
    // Map: ruleId → Map<targetId, { domain, pageMap: Map<url, pageEntry> }>
    interface TargetAccumulator {
      domain: string;
      pageMap: Map<string, {
        instanceCount: number;
        selectors: Set<string>;
      }>;
    }

    const ruleMap = new Map<string, {
      severity: UniqueErrorEntry['severity'];
      description: string;
      helpUrl: string;
      wcagVersion: string;
      targets: Map<string, TargetAccumulator>;
    }>();

    for (const target of allResults) {
      const targetId = String(target.targetId || '');
      const domain = String(target.domain || '');

      for (const page of target.pagesScanned) {
        const pageUrl = String(page?.url || '');
        const violations = page?.liveAudits?.accessibilityViolations ?? [];

        for (const violation of violations) {
          const ruleId = String(violation?.id || '').trim();
          if (!ruleId) {
            continue;
          }

          if (!ruleMap.has(ruleId)) {
            ruleMap.set(ruleId, {
              severity: (violation.severity as UniqueErrorEntry['severity']) || 'minor',
              description: String(violation.description || ''),
              helpUrl: String(violation.helpUrl || ''),
              wcagVersion: String(violation.wcagVersion || ''),
              targets: new Map()
            });
          }

          const ruleEntry = ruleMap.get(ruleId)!;

          // Keep the most severe rating seen for this rule across all pages.
          if (severityRank(violation.severity) < severityRank(ruleEntry.severity)) {
            ruleEntry.severity = violation.severity as UniqueErrorEntry['severity'];
          }

          if (!ruleEntry.targets.has(targetId)) {
            ruleEntry.targets.set(targetId, { domain, pageMap: new Map() });
          }

          const targetAcc = ruleEntry.targets.get(targetId)!;

          if (!targetAcc.pageMap.has(pageUrl)) {
            targetAcc.pageMap.set(pageUrl, { instanceCount: 0, selectors: new Set() });
          }

          const pageAcc = targetAcc.pageMap.get(pageUrl)!;
          const instances = Array.isArray(violation.instances) ? violation.instances : [];
          pageAcc.instanceCount += instances.length;

          for (const inst of instances) {
            const targets = Array.isArray(inst.target) ? inst.target : [];
            for (const sel of targets) {
              const normalised = String(sel || '').trim();
              if (normalised) {
                pageAcc.selectors.add(normalised);
              }
            }
          }
        }
      }
    }

    const entries: UniqueErrorEntry[] = [];

    for (const [ruleId, ruleData] of ruleMap) {
      let totalPageCount = 0;
      let totalInstanceCount = 0;
      const domains: UniqueErrorDomainBreakdown[] = [];

      for (const [targetId, targetAcc] of ruleData.targets) {
        let domainInstanceCount = 0;
        const affectedPages: UniqueErrorPageEntry[] = [];

        for (const [url, pageAcc] of targetAcc.pageMap) {
          domainInstanceCount += pageAcc.instanceCount;
          affectedPages.push({
            url,
            instanceCount: pageAcc.instanceCount,
            selectorPatterns: Array.from(pageAcc.selectors)
          });
        }

        const pageCount = targetAcc.pageMap.size;
        totalPageCount += pageCount;
        totalInstanceCount += domainInstanceCount;

        domains.push({
          targetId,
          domain: targetAcc.domain,
          pageCount,
          instanceCount: domainInstanceCount,
          affectedPages: affectedPages.sort((a, b) => b.instanceCount - a.instanceCount)
        });
      }

      const totalDomainCount = domains.length;

      entries.push({
        ruleId,
        severity: ruleData.severity,
        description: ruleData.description,
        helpUrl: ruleData.helpUrl,
        wcagVersion: ruleData.wcagVersion,
        totalDomainCount,
        totalPageCount,
        totalInstanceCount,
        isSystemic: totalDomainCount >= UniqueErrorsReporter.SYSTEMIC_DOMAIN_THRESHOLD,
        domains: domains.sort((a, b) => b.instanceCount - a.instanceCount)
      });
    }

    return entries.sort((a, b) => {
      const sevDiff = severityRank(a.severity) - severityRank(b.severity);
      if (sevDiff !== 0) return sevDiff;
      const domainDiff = b.totalDomainCount - a.totalDomainCount;
      if (domainDiff !== 0) return domainDiff;
      return b.totalInstanceCount - a.totalInstanceCount;
    });
  }
}
