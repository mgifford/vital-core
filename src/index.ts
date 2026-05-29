import { ProfileParser } from './engine/parser';
import { TargetDiscoveryEngine } from './engine/discovery';
import { ResilientBrowserEngine } from './engine/browser';
import { BugExporter } from './engine/reporters/bug-exporter';
import { DashboardCompiler } from './engine/reporters/dashboard-compiler';
import { TargetScanResult, PageScanReport } from './types/site-quality-spec';

async function main() {
  const startTime = Date.now();
  const profilePath = process.argv[2] || 'profiles/us-health.yml';
  
  console.log(`🚀 Initalizing VITAL-Core Run Engine using profile: ${profilePath}`);
  
  try {
    // 1. Ingest Configuration Profile
    const profile = ProfileParser.loadProfile(profilePath);
    const globalAccumulatedResults: TargetScanResult[] = [];

    // 2. Loop Through Targets Sequentially to Protect Bandwidth
    for (const target of profile.targets) {
      const targetStartTime = Date.now();
      console.log(`\n===== Processing Target: ${target.name} (${target.id}) =====`);

      // 3. Resolve URLs via Sitemap & Filter Globs
      const urlQueue = await TargetDiscoveryEngine.discoverUrls(target);
      if (urlQueue.length === 0) {
        console.warn(`⚠️ No URLs discovered for target ${target.id}. Skipping...`);
        continue;
      }

      // 4. Run Browser Session (Live tests + Snapshot Generation + Offline Tests)
      const rawPageReports = await ResilientBrowserEngine.executeSnapshotSession(target, urlQueue);
      
      // Enforce strict Type casting verification for generated scan reports
      const completedPageScans: PageScanReport[] = rawPageReports as PageScanReport[];

      const targetResult: TargetScanResult = {
        targetId: target.id,
        domain: target.base_url,
        scanDurationMs: Date.now() - targetStartTime,
        pagesScanned: completedPageScans
      };

      // 5. Generate individual Markdown Bug Ticket Artifact for this target
      console.log(`📝 Exporting Section 508 developer tickets...`);
      BugExporter.exportMarkdownReport(targetResult);

      globalAccumulatedResults.push(targetResult);
    }

    // 6. Compile global dashboard across all scanned profiles
    console.log(`\n📊 Compiling executive compliance dashboard UI...`);
    DashboardCompiler.compileStaticDashboard(globalAccumulatedResults);

    const totalDurationSec = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n🏁 VITAL-Core Execution Loop Completed Successfully in ${totalDurationSec}s.`);

  } catch (error: any) {
    console.error(`❌ Critical runtime failure in orchestrator pipeline:`, error.message);
    process.exit(1);
  }
}

main();
