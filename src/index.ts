import { ProfileParser } from './engine/parser';
import { TargetDiscoveryEngine } from './engine/discovery';
import { ResilientBrowserEngine } from './engine/browser';
import { TargetConfig } from './types/profile';
import { BugExporter } from './engine/reporters/bug-exporter';
import { DashboardCompiler } from './engine/reporters/dashboard-compiler';
import { PageStateCache } from './engine/reporters/page-state-cache';
import { RunHistoryReporter } from './engine/reporters/run-history';
import { PrioritySeedStore } from './engine/priority-seeds';
import { TargetScanResult, PageScanReport } from './types/site-quality-spec';

interface TargetScanPlan {
  target: TargetConfig;
  discoveredUrls: string[];
  nextOffset: number;
  startedAtMs: number;
  completedPages: PageScanReport[];
}

async function main() {
  const startTime = Date.now();
  const profilePath = process.argv[2] || 'profiles/us-health.yml';
  const forceRescan = /^(1|true|yes)$/i.test(process.env.FORCE_RESCAN || '');
  const forcePrioritySeedRefresh = /^(1|true|yes)$/i.test(process.env.FORCE_PRIORITY_SEED_REFRESH || '');
  
  console.log(`🚀 Initalizing VITAL-Core Run Engine using profile: ${profilePath}`);
  
  try {
    // 1. Ingest Configuration Profile
    const profile = ProfileParser.loadProfile(profilePath);
    const globalAccumulatedResults: TargetScanResult[] = [];
    const pageState = PageStateCache.load();

    const prioritySeedState = await PrioritySeedStore.initialize(profile.targets, {
      forceRefresh: forcePrioritySeedRefresh,
      maxAgeDays: 31,
      perTargetLimit: 12
    });

    console.log(
      `🧭 Priority URL seeds ${prioritySeedState.refreshed ? 'refreshed' : 'loaded'} ` +
        `(${prioritySeedState.targetCount} targets, generated ${prioritySeedState.generatedAt}).`
    );

    if (forceRescan) {
      console.log('🔁 FORCE_RESCAN enabled. All pages will be scanned regardless of change state.');
    }

    // 2. Discover URLs across all targets first so scan execution can be interleaved.
    const scanPlans: TargetScanPlan[] = [];
    for (const target of profile.targets) {
      console.log(`\n===== Planning Target: ${target.name} (${target.id}) =====`);
      const urlQueue = await TargetDiscoveryEngine.discoverUrls(target);
      if (urlQueue.length === 0) {
        console.warn(`⚠️ No URLs discovered for target ${target.id}. Skipping...`);
        continue;
      }

      scanPlans.push({
        target,
        discoveredUrls: urlQueue,
        nextOffset: 0,
        startedAtMs: Date.now(),
        completedPages: []
      });
    }

    // 3. Interleave scans across targets to avoid concentrated domain load.
    // We scan small batches in round-robin order and naturally focus remaining targets once smaller queues are exhausted.
    const roundRobinBatchSize = 2;
    let round = 1;
    while (scanPlans.some(plan => plan.nextOffset < plan.discoveredUrls.length)) {
      console.log(`\n🔄 Starting round-robin scan cycle ${round}...`);

      for (const plan of scanPlans) {
        if (plan.nextOffset >= plan.discoveredUrls.length) {
          continue;
        }

        const batch = plan.discoveredUrls.slice(plan.nextOffset, plan.nextOffset + roundRobinBatchSize);
        const batchStart = plan.nextOffset + 1;
        const batchEnd = plan.nextOffset + batch.length;
        console.log(
          `🌐 Round ${round}: ${plan.target.id} scanning URLs ${batchStart}-${batchEnd} of ${plan.discoveredUrls.length}`
        );

        const rawPageReports = await ResilientBrowserEngine.executeSnapshotSession(plan.target, batch, {
          forceRescan,
          pageState
        });
      
        const completedPageScans: PageScanReport[] = rawPageReports as PageScanReport[];
        plan.completedPages.push(...completedPageScans);
        plan.nextOffset += batch.length;
      }

      round += 1;
    }

    // 4. Build target-level outputs once all interleaved scan rounds complete.
    for (const plan of scanPlans) {
      const targetResult: TargetScanResult = {
        targetId: plan.target.id,
        domain: plan.target.base_url,
        scanDurationMs: Date.now() - plan.startedAtMs,
        pagesScanned: plan.completedPages
      };

      // 5. Generate individual Markdown Bug Ticket Artifact for this target
      console.log(`📝 Exporting Section 508 developer tickets...`);
      BugExporter.exportMarkdownReport(targetResult);

      globalAccumulatedResults.push(targetResult);
    }

    // 6. Compile global dashboard across all scanned profiles
    console.log(`\n📊 Compiling executive compliance dashboard UI...`);
    DashboardCompiler.compileStaticDashboard(globalAccumulatedResults);
    PageStateCache.save(pageState);

    const totalDurationMs = Date.now() - startTime;
    const runEntry = RunHistoryReporter.persistRunHistory(globalAccumulatedResults, profilePath, totalDurationMs);
    console.log(`🗃️ Updated persistent run history index with run ${runEntry.runId}.`);

    const totalDurationSec = (totalDurationMs / 1000).toFixed(2);
    console.log(`\n🏁 VITAL-Core Execution Loop Completed Successfully in ${totalDurationSec}s.`);

  } catch (error: any) {
    console.error(`❌ Critical runtime failure in orchestrator pipeline:`, error.message);
    process.exit(1);
  }
}

main();
