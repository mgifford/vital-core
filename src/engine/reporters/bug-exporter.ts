import * as fs from 'fs';
import * as path from 'path';
import { TargetScanResult } from '../../types/site-quality-spec';
import { RemediationAdvisor } from './remediation-advisor';

export class BugExporter {
  private static REPORT_DIR = path.resolve(process.cwd(), 'dist/reports');

  private static csvHeader = [
    'target_id',
    'page_url',
    'status',
    'error_message',
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
   */
  public static exportMarkdownReport(targetResult: TargetScanResult): string {
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
      for (const page of problematicPages) {
        md += `--- \n\n## 📄 Page Context: [${page.url}](${page.url})\n`;
        md += `* **Result Execution Status:** \`${page.status}\`\n`;

        if (page.errorMessage) {
          md += `* **Error Context:** \`${page.errorMessage}\`\n`;
          csvRows.push([
            targetResult.targetId,
            page.url,
            page.status,
            page.errorMessage,
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
          continue;
        }

        // Output Core Accessibility Violations
        const violations = page.liveAudits?.accessibilityViolations || [];
        if (violations.length > 0) {
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
        const content = page.offlineAudits?.contentMetrics;
        if (content && content.suspiciousAltTextCount > 0) {
          md += `### 📝 Alternative Text Anomalies\n`;
          md += `Found **${content.suspiciousAltTextCount}** instances of missing or generic alt patterns (e.g., 'image.png', 'screenshot').\n\n`;
          content.suspiciousAltInstances.forEach((inst, idx) => {
            md += `${idx + 1}. **Target Code Matrix:** \`${inst.imgHtml}\` | **Value Identified:** *"${inst.invalidValue}"*\n`;

            csvRows.push([
              targetResult.targetId,
              page.url,
              page.status,
              '',
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
        const thirdPartyImpact = page.thirdPartyImpact;
        if (thirdPartyImpact?.evaluated && thirdPartyImpact.regressionDetected) {
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
      }
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
      if (tag === 'wcag2a' || tag === 'wcag2aa' || tag.startsWith('wcag2')) {
        labels.add('WCAG 2.0');
      }
      if (tag.startsWith('wcag21')) {
        labels.add('WCAG 2.1');
      }
      if (tag.startsWith('wcag22')) {
        labels.add('WCAG 2.2');
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

  private static escapeCsvField(value: string): string {
    const text = String(value ?? '');
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }
}
