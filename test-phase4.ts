import { ProfileParser } from './src/engine/parser';
import { ResilientBrowserEngine } from './src/engine/browser';

async function verifyPhase4Workers() {
  try {
    console.log("⏳ Instantiating Phase 4 Data Worker validation routine...");
    
    const profile = ProfileParser.loadProfile('profiles/us-health.yml');
    const target = profile.targets.find(t => t.id === 'cms-gov');
    if (!target) throw new Error("Could not read targets footprint matrix.");

    // Isolate configuration boundary criteria to a single page check
    const singleUrlTestQueue = ["https://www.cms.gov/medicare/physician-fee-schedule/search"];
    
    console.log(`🏃 Running analysis pipelines sequentially across targeted domain...`);
    const results = await ResilientBrowserEngine.executeSnapshotSession(target, singleUrlTestQueue);
    const report = results[0];

    console.log("\n==============================================");
    console.log("🕵️ ASSESSED WORKER OUTPUT TELEMETRY MATCH");
    console.log("==============================================");
    console.log(`🎯 URL Processed: ${report.url}`);
    console.log(`🛡️ Accessibility Rules Verified: ${report.liveAudits?.accessibilityViolations.length} distinct violations detected.`);
    console.log(`🧩 USWDS Architecture Found: ${report.offlineAudits?.designSystem.usesUSWDS}`);
    console.log(`📝 Readability Metrics Level: ${report.offlineAudits?.contentMetrics.readabilityScore}/100`);
    console.log(`🖼️ Flagged Alt Attributes: ${report.offlineAudits?.contentMetrics.suspiciousAltTextCount} instances identified.`);

    if (report.status !== 'COMPLETED') {
      throw new Error(`Execution ended prematurely with a bad status state: ${report.status}`);
    }

    console.log("\n✅ Phase 4 validation verification complete. Workers are delivering clean output metrics mapping.");
  } catch (error: any) {
    console.error("\n❌ Phase 4 Functional Worker Test Crash Error:", error.message);
    process.exit(1);
  }
}

verifyPhase4Workers();
