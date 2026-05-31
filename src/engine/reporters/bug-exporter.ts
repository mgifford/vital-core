import * as fs from 'fs';
import * as path from 'path';
import { TargetScanResult } from '../../types/site-quality-spec';
import { RemediationAdvisor } from './remediation-advisor';
import { DomainRatingScorer } from './domain-rating';
import { DomainAccessibilityRating } from '../../types/domain-rating';

export class BugExporter {
  private static REPORT_DIR = path.resolve(process.cwd(), 'dist/reports');

  private static csvHeader = [
    'target_id',
    'page_url',
    'status',
    'error_message',
    'lighthouse_performance_score',
    'lighthouse_first_contentful_paint_ms',
    'lighthouse_largest_contentful_paint_ms',
    'lighthouse_speed_index_ms',
    'severity',
    'rule_id',
    'description',
    'help_url',
    'impacted_criteria',
    'selector',
    'html_snippet',
    'failure_summary',
    'suspicious_alt_value',
    'suspicious_alt_html'
  ];

  /**
   * Generates formatted Markdown issue documentation for a scanned target
   *
   * @param targetResult Scan results for the target.
   * @param seedUrls     Optional DuckDuckGo priority-page seed URLs for the target.
   *                     When provided, the accessibility grade reflects page popularity.
   */
  public static exportMarkdownReport(targetResult: TargetScanResult, seedUrls: string[] = []): string {
    if (!fs.existsSync(this.REPORT_DIR)) {
      fs.mkdirSync(this.REPORT_DIR, { recursive: true });
    }

    const remediationAdvisor = new RemediationAdvisor();

    let md = `# 🛑 Section 508 Compliance Registry: ${targetResult.targetId.toUpperCase()}\n`;
    md += `> **Scan Summary:** Processed completely on ${new Date().toUTCString()} | Duration: ${(targetResult.scanDurationMs / 1000).toFixed(2)}s\n\n`;
    md += `## 📘 Conformance Policy Context\n`;
    md += `* **Legal baseline:** WCAG 2.0 AA (federal minimum requirement).\n`;
    md += `* **Recommended target:** WCAG 2.2 AA where feasible, while keeping WCAG 2.0 / 2.1 / 2.2 distinctions explicit in reporting.\n`;
    md += `* **AAA guidance:** Encourage AAA improvements where practical, but do not treat automated AAA checks as equivalent to human validation.\n`;
    md += `* **Manual testing priority:** Keyboard-only and assistive-technology testing should be prioritized above automated AAA score chasing.\n\n`;

    md += this.buildAccessibilityGradeSection(targetResult, seedUrls);

    // Filter pages that encountered severe issues
    const problematicPages = targetResult.pagesScanned.filter(
      p =>
        (p.status !== 'COMPLETED' && p.status !== 'SKIPPED_UNCHANGED') ||
        (p.liveAudits?.accessibilityViolations.length ?? 0) > 0 ||
        (p.offlineAudits?.contentMetrics.suspiciousAltTextCount ?? 0) > 0
    );

    const csvRows: string[][] = [];

    if (problematicPages.length === 0) {
      md += `## 🎉 Zero Flagged Violations\nAll audited paths perfectly satisfied validation criteria.\n`;
    } else {
      const pageNavigation = problematicPages.map((page, index) => {
        const pageAnchor = this.buildAnchorId(`page-${index + 1}-${page.url}`);
        return `- [Page report ${index + 1}: ${page.url}](#${pageAnchor})`;
      });

      md += `## 🔎 Report Navigation\n`;
      md += `${pageNavigation.join('\n')}\n\n`;

      problematicPages.forEach((page, index) => {
        const pageAnchor = this.buildAnchorId(`page-${index + 1}-${page.url}`);
        const violations = page.liveAudits?.accessibilityViolations || [];
        const content = page.offlineAudits?.contentMetrics;
        const thirdPartyImpact = page.thirdPartyImpact;

        const pageSectionLinks: string[] = [];
        if (violations.length > 0) {
          pageSectionLinks.push(`[Accessibility deficiencies](#${pageAnchor}-accessibility-deficiencies)`);
        }
        if (content && content.suspiciousAltTextCount > 0) {
          pageSectionLinks.push(`[Alternative text anomalies](#${pageAnchor}-alternative-text-anomalies)`);
        }
        if (thirdPartyImpact?.evaluated && thirdPartyImpact.regressionDetected) {
          pageSectionLinks.push(`[Third-party JavaScript regression](#${pageAnchor}-third-party-regression)`);
        }

        md += `--- \n\n<a id="${pageAnchor}" tabindex="-1"></a>\n`;
        md += `## 📄 Page Context: [${page.url}](${page.url})\n`;
        if (pageSectionLinks.length > 0) {
          md += `* Jump to section: ${pageSectionLinks.join(' | ')}\n`;
        }
        md += `* **Result Execution Status:** \`${page.status}\`\n`;

        const lighthouse = page.liveAudits?.lighthouse;
        md += `* **Lighthouse Performance Score:** ${this.formatMetric(lighthouse?.performanceScore)}\n`;
        md += `* **First Contentful Paint (ms):** ${this.formatMetric(lighthouse?.firstContentfulPaintMs)}\n`;
        md += `* **Largest Contentful Paint (ms):** ${this.formatMetric(lighthouse?.largestContentfulPaintMs)}\n`;
        md += `* **Speed Index (ms):** ${this.formatMetric(lighthouse?.speedIndexMs)}\n`;

        if (page.errorMessage) {
          md += `* **Error Context:** \`${page.errorMessage}\`\n`;
          csvRows.push([
            targetResult.targetId,
            page.url,
            page.status,
            page.errorMessage,
            this.formatMetric(lighthouse?.performanceScore),
            this.formatMetric(lighthouse?.firstContentfulPaintMs),
            this.formatMetric(lighthouse?.largestContentfulPaintMs),
            this.formatMetric(lighthouse?.speedIndexMs),
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            ''
          ]);
          return;
        }

        // Output Core Accessibility Violations
        if (violations.length > 0) {
          md += `<a id="${pageAnchor}-accessibility-deficiencies" tabindex="-1"></a>\n`;
          md += `### ♿ Technical Accessibility Deficiencies\n`;
          for (const violation of violations) {
            const standardProfile = this.classifyWcagProfile(violation.impactedCriteria);
            md += `#### 🛑 Rule Triggered: \`${violation.id}\` (${violation.severity.toUpperCase()})\n`;
            md += `* **Description:** ${violation.description}\n`;
            md += `* **Target Standards Alignment:** ${violation.impactedCriteria.map(c => `\`${c}\``).join(', ')}\n`;
            md += `* **WCAG Scope Classification:** ${standardProfile}\n`;
            md += `* **Primary Rule Guidance (Deque Axe):** [Deque Axe Ruleset Specification](${violation.helpUrl})\n\n`;
            md += `##### 🛠️ Code Failure Snippets:\n`;

            violation.instances.forEach((instance, idx) => {
              md += `###### Instance ${idx + 1}\n`;
              md += `* **Target DOM Coordinate:** \`${instance.target.join(' -> ')}\`\n`;
              md += `* **Failing Source Node Code:**\n \`\`\`html\n ${instance.html}\n \`\`\`\n`;
              md += `* **Remediation Action Path:** ${instance.failureSummary}\n\n`;

              const supplemental = remediationAdvisor.getSupplemental(violation.id, instance.html);
              if (supplemental) {
                md += `* **Supplemental Pattern Advice (${supplemental.source}, ${supplemental.confidence} confidence):** ${supplemental.advice}\n`;
                md += `* **Supplemental Match Signature:** \`${supplemental.matchedLabel}\`\n`;
                if (supplemental.catalogLastUpdated) {
                  md += `* **Supplemental Catalog Last Updated:** ${supplemental.catalogLastUpdated}\n`;
                }
                md += `\n`;
              }

              csvRows.push([
                targetResult.targetId,
                page.url,
                page.status,
                '',
                this.formatMetric(lighthouse?.performanceScore),
                this.formatMetric(lighthouse?.firstContentfulPaintMs),
                this.formatMetric(lighthouse?.largestContentfulPaintMs),
                this.formatMetric(lighthouse?.speedIndexMs),
                violation.severity,
                violation.id,
                violation.description,
                violation.helpUrl,
                violation.impactedCriteria.join('; '),
                instance.target.join(' -> '),
                instance.html,
                instance.failureSummary,
                '',
                ''
              ]);
            });
          }
        }

        // Output Structural Content Concerns (Alt-Text & Readability)
        if (content && content.suspiciousAltTextCount > 0) {
          md += `<a id="${pageAnchor}-alternative-text-anomalies" tabindex="-1"></a>\n`;
          md += `### 📝 Alternative Text Anomalies\n`;
          md += `Found **${content.suspiciousAltTextCount}** instances of missing or generic alt patterns (e.g., 'image.png', 'screenshot').\n\n`;
          content.suspiciousAltInstances.forEach((inst, idx) => {
            md += `${idx + 1}. **Target Code Matrix:** \`${inst.imgHtml}\` | **Value Identified:** *"${inst.invalidValue}"*\n`;

            csvRows.push([
              targetResult.targetId,
              page.url,
              page.status,
              '',
              this.formatMetric(lighthouse?.performanceScore),
              this.formatMetric(lighthouse?.firstContentfulPaintMs),
              this.formatMetric(lighthouse?.largestContentfulPaintMs),
              this.formatMetric(lighthouse?.speedIndexMs),
              'moderate',
              'suspicious-alt-text',
              'Suspicious or missing alternative text pattern detected.',
              '',
              '',
              '',
              '',
              '',
              inst.invalidValue,
              inst.imgHtml
            ]);
          });
          md += `\n`;
        }

        // Output Third-Party JavaScript Accessibility Regression Signal
        if (thirdPartyImpact?.evaluated && thirdPartyImpact.regressionDetected) {
          md += `<a id="${pageAnchor}-third-party-regression" tabindex="-1"></a>\n`;
          md += `### 🧩 Third-Party JavaScript Accessibility Regression\n`;
          md += `Third-party script patterns were detected and this page was re-evaluated with JavaScript disabled.\n\n`;
          md += `* **JS Enabled Violations:** ${thirdPartyImpact.baselineViolationCount}\n`;
          md += `* **JS Disabled Violations:** ${thirdPartyImpact.jsDisabledViolationCount}\n`;
          md += `* **Violations Introduced by JS:** ${thirdPartyImpact.addedByJavaScriptCount}\n`;
          md += `* **Potentially Responsible Rules:** ${thirdPartyImpact.highRiskRules.map(rule => `\`${rule}\``).join(', ') || 'n/a'}\n`;
          md += `* **Likely Third-Party Providers:** ${thirdPartyImpact.likelyIntroducedByProviders.join(', ') || 'Unknown'}\n`;
          if (thirdPartyImpact.providerAttribution.length > 0) {
            md += `* **Provider Confidence:** ${thirdPartyImpact.providerAttribution
              .map(item => `${item.provider} (${item.confidence}, score ${item.score})`)
              .join('; ')}\n`;
          }
          if (thirdPartyImpact.ruleToLikelyProviders.length > 0) {
            md += `* **Rule Attribution:** ${thirdPartyImpact.ruleToLikelyProviders
              .map(item => `\`${item.ruleId}\` -> ${item.providers.join('|') || 'Unknown'}`)
              .join('; ')}\n`;
          }
          if (thirdPartyImpact.ruleToProviderAttribution.length > 0) {
            md += `* **Rule Attribution Confidence:** ${thirdPartyImpact.ruleToProviderAttribution
              .map(item => `${item.ruleId} -> ${item.providers
                .map(provider => `${provider.provider}:${provider.confidence}`)
                .join('|')}`)
              .join('; ')}\n`;
          }
          md += `* **Trigger Evidence:** ${thirdPartyImpact.triggeredBy.join('; ')}\n\n`;

          csvRows.push([
            targetResult.targetId,
            page.url,
            page.status,
            '',
            this.formatMetric(lighthouse?.performanceScore),
            this.formatMetric(lighthouse?.firstContentfulPaintMs),
            this.formatMetric(lighthouse?.largestContentfulPaintMs),
            this.formatMetric(lighthouse?.speedIndexMs),
            'serious',
            'third-party-js-regression',
            'Accessibility regressions detected when comparing JS-enabled and JS-disabled audits.',
            '',
            'wcag2a;wcag2aa;section508',
            '',
            '',
            `Added by JS: ${thirdPartyImpact.addedByJavaScriptCount}; Rules: ${thirdPartyImpact.highRiskRules.join('|')}; Providers: ${thirdPartyImpact.providerAttribution.map(item => `${item.provider}:${item.confidence}`).join('|')}`,
            '',
            ''
          ]);
        }
      });
    }

    const safeFilename = `${targetResult.targetId}_issues.md`;
    const csvFilename = `${targetResult.targetId}_issues.csv`;

    fs.writeFileSync(path.join(this.REPORT_DIR, safeFilename), md, 'utf8');
    fs.writeFileSync(path.join(this.REPORT_DIR, csvFilename), this.toCsv(csvRows), 'utf8');

    return safeFilename;
  }

  private static classifyWcagProfile(criteria: string[]): string {
    const labels = new Set<string>();

    for (const criterion of criteria) {
      const tag = String(criterion || '').toLowerCase();
      // Check in reverse version order to avoid wcag21/wcag22 matching wcag2 prefix
      if (tag.startsWith('wcag22')) {
        labels.add('WCAG 2.2');
      } else if (tag.startsWith('wcag21')) {
        labels.add('WCAG 2.1');
      } else if (tag === 'wcag2a' || tag === 'wcag2aa' || tag === 'wcag2aaa') {
        labels.add('WCAG 2.0');
      }
      if (tag.includes('aaa')) {
        labels.add('AAA');
      }
      if (tag.includes('508')) {
        labels.add('Section 508');
      }
    }

    if (labels.size === 0) {
      return 'Unclassified';
    }

    return Array.from(labels).join(', ');
  }

  private static toCsv(rows: string[][]): string {
    const serializedRows = [this.csvHeader, ...rows].map(cols => cols.map(this.escapeCsvField).join(','));
    return serializedRows.join('\n') + '\n';
  }

  private static formatMetric(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value)
      ? String(Math.round(value))
      : 'n/a';
  }

  private static escapeCsvField(value: string): string {
    const text = String(value ?? '');
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  private static buildAnchorId(value: string): string {
    return String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'section';
  }

  private static buildAccessibilityGradeSection(targetResult: TargetScanResult, seedUrls: string[]): string {
    const rating: DomainAccessibilityRating = DomainRatingScorer.buildDomainRating(targetResult, seedUrls);
    const driver = DomainRatingScorer.buildPenaltyDriverSummary(rating);
    const { breakdown: bd, priorityPageCoverage: ppc } = rating;

    let section = `## ♿ Accessibility Grade\n\n`;
    section += `| Metric | Value |\n`;
    section += `|--------|-------|\n`;
    section += `| **Grade** | **${rating.letterGrade}** |\n`;
    section += `| **Score** | ${rating.numericScore} / 100 |\n`;
    section += `| **Summary** | ${driver} |\n`;
    section += `| Priority pages scanned | ${ppc.totalPriorityPages} |\n`;
    section += `| Priority pages with violations | ${ppc.pagesWithViolations} |\n`;
    section += `\n`;

    section += `### Severity Breakdown\n\n`;
    section += `| Severity | Instances | Unique Rules | Systemic Rules | Priority-Page Pairs | Weighted Penalty |\n`;
    section += `|----------|-----------|--------------|----------------|---------------------|------------------|\n`;
    for (const sev of ['critical', 'serious', 'moderate', 'minor'] as const) {
      const b = bd[sev];
      section += `| ${sev.charAt(0).toUpperCase() + sev.slice(1)} | ${b.rawCount} | ${b.uniqueRuleCount} | ${b.systemicCount} | ${b.priorityPageCount} | ${b.weightedPenalty} |\n`;
    }
    section += `\n`;
    section += `> **Grade scale:** A+ (97–100) · A (93–96) · A− (90–92) · B+ (87–89) · B (83–86) · B− (80–82) · C+ (77–79) · C (73–76) · C− (70–72) · D+ (67–69) · D (63–66) · D− (<63)\n\n`;

    return section;
  }
}
