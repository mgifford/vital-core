import { ProfileParser } from '../../src/engine/parser';
import { ResilientBrowserEngine } from '../../src/engine/browser';

async function verifyWorkersSmoke() {
  try {
    console.log('⏳ Running worker pipeline smoke validation...');

    const profile = ProfileParser.loadProfile('profiles/us-health.yml');
    const target = profile.targets.find(t => t.id === 'cms-gov');
    if (!target) throw new Error('Could not read target matrix.');

    const singleUrlTestQueue = ['https://www.cms.gov/medicare/physician-fee-schedule/search'];

    console.log('🏃 Running analysis pipelines across targeted domain...');
    const { reports: results } = await ResilientBrowserEngine.executeSnapshotSession(target, singleUrlTestQueue);
    const report = results[0];

    console.log('\n==============================================');
    console.log('🕵️ ASSESSED WORKER OUTPUT TELEMETRY MATCH');
    console.log('==============================================');
    console.log(`🎯 URL Processed: ${report.url}`);
    console.log(`🛡️ Accessibility Rules Verified: ${report.liveAudits?.accessibilityViolations.length} distinct violations detected.`);
    console.log(`🧩 USWDS Architecture Found: ${report.offlineAudits?.designSystem.usesUSWDS}`);
    console.log(`📝 Readability Metrics Level: ${report.offlineAudits?.contentMetrics.readabilityScore}/100`);
    console.log(`🖼️ Flagged Alt Attributes: ${report.offlineAudits?.contentMetrics.suspiciousAltTextCount} instances identified.`);

    if (report.status !== 'COMPLETED') {
      throw new Error(`Execution ended with bad status: ${report.status}`);
    }

    console.log('\n✅ Worker smoke validation passed.');
  } catch (error: any) {
    console.error('\n❌ Worker smoke validation crash:', error.message);
    process.exit(1);
  }
}

verifyWorkersSmoke();
