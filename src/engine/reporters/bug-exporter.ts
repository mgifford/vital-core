import * as fs from 'fs';
import * as path from 'path';
import { TargetScanResult } from '../../types/site-quality-spec';

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

    let md = `# 🛑 Section 508 Compliance Registry: ${targetResult.targetId.toUpperCase()}\n`;
    md += `> **Scan Summary:** Processed completely on ${new Date().toUTCString()} | Duration: ${(targetResult.scanDurationMs / 1000).toFixed(2)}s\n\n`;

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
            md += `#### 🛑 Rule Triggered: \`${violation.id}\` (${violation.severity.toUpperCase()})\n`;
            md += `* **Description:** ${violation.description}\n`;
            md += `* **Target Standards Alignment:** ${violation.impactedCriteria.map(c => `\`${c}\``).join(', ')}\n`;
            md += `* **Detailed Resolution Requirements:** [Deque Axe Ruleset Specification](${violation.helpUrl})\n\n`;
            md += `##### 🛠️ Code Failure Snippets:\n`;

            violation.instances.forEach((instance, idx) => {
              md += `###### Instance ${idx + 1}\n`;
              md += `* **Target DOM Coordinate:** \`${instance.target.join(' -> ')}\`\n`;
              md += `* **Failing Source Node Code:**\n \`\`\`html\n ${instance.html}\n \`\`\`\n`;
              md += `* **Remediation Action Path:** ${instance.failureSummary}\n\n`;

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
      }
    }

    const safeFilename = `${targetResult.targetId}_issues.md`;
    const csvFilename = `${targetResult.targetId}_issues.csv`;

    fs.writeFileSync(path.join(this.REPORT_DIR, safeFilename), md, 'utf8');
    fs.writeFileSync(path.join(this.REPORT_DIR, csvFilename), this.toCsv(csvRows), 'utf8');

    return safeFilename;
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
