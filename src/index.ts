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
  const revalidateAfterDays = Number.parseInt(process.env.VITAL_REVALIDATE_AFTER_DAYS || '7', 10);
  const updatedWithinDays = Number.parseInt(process.env.VITAL_UPDATED_WITHIN_DAYS || '7', 10);
  const maxRunMinutes = Number.parseInt(process.env.VITAL_MAX_RUN_MINUTES || '0', 10);
  const hasRuntimeDeadline = Number.isFinite(maxRunMinutes) && maxRunMinutes > 0;
  const runtimeDeadlineMs = hasRuntimeDeadline ? startTime + (maxRunMinutes * 60 * 1000) : null;
  const baseBatchSize = Math.max(1, Number.parseInt(process.env.VITAL_BATCH_SIZE_BASE || '2', 10));
  const maxBatchSize = Math.max(baseBatchSize, Number.parseInt(process.env.VITAL_BATCH_SIZE_MAX || '6', 10));
  const escalationSeconds = Math.max(10, Number.parseInt(process.env.VITAL_BATCH_ESCALATION_SECONDS || '45', 10));
  const dynamicBatchEnabled = !/^(0|false|no)$/i.test(process.env.VITAL_DYNAMIC_BATCH_ENABLE || 'true');

  const shouldStopForRuntimeBudget = () => {
    if (!runtimeDeadlineMs) {
      return false;
    }
    return Date.now() >= runtimeDeadlineMs;
  };

  const getAdaptiveBatchSize = (
    timeoutCount: number,
    completedCount: number,
    targetTimeoutStreak: number
  ): number => {
    if (!dynamicBatchEnabled || !runtimeDeadlineMs) {
      return baseBatchSize;
    }

    if (targetTimeoutStreak > 0) {
      return 1;
    }

    const remainingMs = runtimeDeadlineMs - Date.now();
    if (remainingMs <= escalationSeconds * 1000) {
      return baseBatchSize;
    }

    const timeoutRatio = completedCount > 0 ? timeoutCount / completedCount : 0;
    if (timeoutCount >= 3 || timeoutRatio >= 0.2) {
      return baseBatchSize;
    }

    if (remainingMs >= escalationSeconds * 4 * 1000) {
      return maxBatchSize;
    }

    if (remainingMs >= escalationSeconds * 2 * 1000) {
      return Math.min(maxBatchSize, baseBatchSize + 2);
    }

    return Math.min(maxBatchSize, baseBatchSize + 1);
  };
  
  console.log(`🚀 Initalizing VITAL-Core Run Engine using profile: ${profilePath}`);
  
  try {
    // 1. Ingest Configuration Profile
    const profile = ProfileParser.loadProfile(profilePath);
    const globalAccumulatedResults: TargetScanResult[] = [];
    const pageState = PageStateCache.load();
    const previouslyScannedUrls = new Set(Object.keys(pageState));

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
      const urlQueue = await TargetDiscoveryEngine.discoverUrls(target, {
          pageState,
        previouslyScannedUrls,
          skipPreviouslyScanned: !forceRescan,
          revalidateAfterDays: Number.isFinite(revalidateAfterDays) ? revalidateAfterDays : 7,
          updatedWithinDays: Number.isFinite(updatedWithinDays) ? updatedWithinDays : 7
      });
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
    let timeoutCount = 0;
    let completedCount = 0;
    const targetTimeoutStreaks = new Map<string, number>();
    let round = 1;
    let stoppedForBudget = false;
    while (scanPlans.some(plan => plan.nextOffset < plan.discoveredUrls.length)) {
      if (shouldStopForRuntimeBudget()) {
        stoppedForBudget = true;
        console.warn(
          `⏱️ Runtime budget reached (${maxRunMinutes} minutes). Stopping new scan batches to allow graceful publish.`
        );
        break;
      }

      console.log(`\n🔄 Starting round-robin scan cycle ${round}...`);

      for (const plan of scanPlans) {
        if (shouldStopForRuntimeBudget()) {
          stoppedForBudget = true;
          console.warn(
            `⏱️ Runtime budget reached (${maxRunMinutes} minutes) mid-cycle. Ending scan loop after current progress.`
          );
          break;
        }

        if (plan.nextOffset >= plan.discoveredUrls.length) {
          continue;
        }

        const targetTimeoutStreak = targetTimeoutStreaks.get(plan.target.id) || 0;
        const roundRobinBatchSize = getAdaptiveBatchSize(timeoutCount, completedCount, targetTimeoutStreak);
        const batch = plan.discoveredUrls.slice(plan.nextOffset, plan.nextOffset + roundRobinBatchSize);
        const batchStart = plan.nextOffset + 1;
        const batchEnd = plan.nextOffset + batch.length;
        console.log(
          `🌐 Round ${round}: ${plan.target.id} scanning URLs ${batchStart}-${batchEnd} of ${plan.discoveredUrls.length} (batch size ${batch.length})`
        );

        const rawPageReports = await ResilientBrowserEngine.executeSnapshotSession(plan.target, batch, {
          forceRescan,
          pageState
        });
      
        const completedPageScans: PageScanReport[] = rawPageReports as PageScanReport[];
        const batchTimeouts = completedPageScans.filter(report => report && report.status === 'TIMEOUT').length;
        if (batchTimeouts > 0) {
          targetTimeoutStreaks.set(plan.target.id, (targetTimeoutStreaks.get(plan.target.id) || 0) + batchTimeouts);
        } else {
          targetTimeoutStreaks.set(plan.target.id, 0);
        }

        completedPageScans.forEach(report => {
          completedCount += 1;
          if (report && report.status === 'TIMEOUT') {
            timeoutCount += 1;
          }
        });
        plan.completedPages.push(...completedPageScans);
        plan.nextOffset += batch.length;
      }

      if (stoppedForBudget) {
        break;
      }

      round += 1;
    }

    if (stoppedForBudget) {
      console.log('🧾 Partial run completed within runtime budget. Persisting collected findings and dashboards.');
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
    const discoveryNonHtmlExclusions = TargetDiscoveryEngine.consumeNonHtmlExclusions();
    DashboardCompiler.compileStaticDashboard(globalAccumulatedResults, {
      nonHtmlDiscoveryExclusions: discoveryNonHtmlExclusions
    });
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
