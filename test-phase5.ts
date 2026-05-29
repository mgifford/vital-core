import { BugExporter } from './src/engine/reporters/bug-exporter';
import { DashboardCompiler } from './src/engine/reporters/dashboard-compiler';
import { TargetScanResult } from './src/types/site-quality-spec';
import * as fs from 'fs';
import * as path from 'path';

function verifyPhase5Reporting() {
  try {
    console.log("⏳ Instantiating Phase 5 Compilation and Compliance Export validation tests...");

    // 1. Create mock payload that matches our universal JSON schema spec
    const mockDataResults: TargetScanResult[] = [
      {
        targetId: "cms-main",
        domain: "https://www.cms.gov",
        scanDurationMs: 4210,
        pagesScanned: [
          {
            url: "https://www.cms.gov/medicare/physician-fee-schedule/search",
            timestamp: new Date().toISOString(),
            status: "COMPLETED",
            errorMessage: null,
            technologyStack: [],
            liveAudits: {
              lighthouse: null,
              accessibilityViolations: [
                {
                  id: "color-contrast",
                  severity: "serious",
                  description: "Ensures the contrast between foreground and background colors meets WCAG 2 AA thresholds.",
                  helpUrl: "https://dequeuniversity.com/rules/axe/4.8/color-contrast",
                  impactedCriteria: ["wcag2aa", "508-302.1"],
                  instances: [
                    {
                      html: "<button class='usa-btn'>Search PFS</button>",
                      target: [".usa-btn"],
                      failureSummary: "Fix color contrast element tracking values (Expected ratio 4.5:1, found 2.1:1)"
                    }
                  ]
                }
              ]
            },
            offlineAudits: {
              overlayDetected: { found: false, provider: null, evidence: null },
              designSystem: { usesUSWDS: true, versionDetected: "3.0" },
              contentMetrics: {
                readabilityScore: 62.4,
                suspiciousAltTextCount: 1,
                suspiciousAltInstances: [
                  { imgHtml: "<img src='logo.png' alt='logo'>", invalidValue: "logo" }
                ]
              },
              linkHealth: { totalChecked: 0, brokenCount: 0, brokenLinks: [] }
            }
          }
        ]
      }
    ];

    // 2. Trigger generation pipelines
    console.log("🏃 Executing markdown ticket extraction...");
    const reportFilename = BugExporter.exportMarkdownReport(mockDataResults[0]);

    console.log("🏃 Compiling system dashboard graphics interface...");
    DashboardCompiler.compileStaticDashboard(mockDataResults);

    // 3. Validation Checkpoints (Definition of Done Assertions)
    const htmlPath = path.resolve(process.cwd(), 'dist/index.html');
    const mdPath = path.resolve(process.cwd(), 'dist/reports', reportFilename);

    if (!fs.existsSync(htmlPath)) throw new Error("Dashboard compiler failed to create index.html asset target.");
    if (!fs.existsSync(mdPath)) throw new Error(`Report exporter failed to extract file at: ${mdPath}`);

    const markdownContent = fs.readFileSync(mdPath, 'utf8');
    if (!markdownContent.includes('### ♿ Technical Accessibility Deficiencies')) {
      throw new Error("Markdown content validation failed: Expected structural a11y sections are missing.");
    }

    console.log("\n✅ Phase 5 compilation routines successfully passed inspection requirements.");
    console.log(`   👉 Dashboard URL: ${htmlPath}`);
    console.log(`   👉 Developer Issues Log: ${mdPath}`);

  } catch (error: any) {
    console.error("\n❌ Phase 5 Reporter Infrastructure Exception Found:", error.message);
    process.exit(1);
  }
}

verifyPhase5Reporting();
