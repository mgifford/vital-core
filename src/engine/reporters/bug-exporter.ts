import * as fs from 'fs';
import * as path from 'path';
import { TargetScanResult } from '../../types/site-quality-spec';

export class BugExporter {
  private static REPORT_DIR = path.resolve(process.cwd(), 'dist/reports');

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
      p => p.status !== 'COMPLETED' || (p.liveAudits?.accessibilityViolations.length ?? 0) > 0 || (p.offlineAudits?.contentMetrics.suspiciousAltTextCount ?? 0) > 0
    );

    if (problematicPages.length === 0) {
      md += `## 🎉 Zero Flagged Violations\nAll audited paths perfectly satisfied validation criteria.\n`;
    } else {
      for (const page of problematicPages) {
        md += `--- \n\n## 📄 Page Context: [${page.url}](${page.url})\n`;
        md += `* **Result Execution Status:** \`${page.status}\`\n`;

        if (page.errorMessage) {
          md += `* **Error Context:** \`${page.errorMessage}\`\n`;
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
          });
          md += `\n`;
        }
      }
    }

    const safeFilename = `${targetResult.targetId}_issues.md`;
    fs.writeFileSync(path.join(this.REPORT_DIR, safeFilename), md, 'utf8');
    return safeFilename;
  }
}
