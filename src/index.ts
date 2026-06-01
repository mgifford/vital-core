import * as fs from 'fs';
import * as path from 'path';
import { ProfileParser } from './engine/parser';
import { TargetDiscoveryEngine } from './engine/discovery';
import { ResilientBrowserEngine } from './engine/browser';
import { TargetConfig } from './types/profile';
import { BugExporter } from './engine/reporters/bug-exporter';
import { DashboardCompiler } from './engine/reporters/dashboard-compiler';
import { PageStateCache, PageStateMap } from './engine/reporters/page-state-cache';
import { RunHistoryReporter } from './engine/reporters/run-history';
import { PrioritySeedStore } from './engine/priority-seeds';
import { TargetScanResult, PageScanReport } from './types/site-quality-spec';
import { DiscoveryNonHtmlExclusion } from './engine/discovery';

interface TargetScanPlan {
  target: TargetConfig;
  discoveredUrls: string[];
  nextOffset: number;
  startedAtMs: number;
  completedPages: PageScanReport[];
}

/**
 * Persists per-target scan artifacts consumed by the compile-and-deploy job.
 * Called only when VITAL_TARGET_ID is set (parallel matrix mode).
 */
function saveSingleTargetArtifacts(
  result: TargetScanResult,
  discoveredUrls: string[],
  pageState: PageStateMap,
  exclusions: DiscoveryNonHtmlExclusion[]
): void {
  const artifactDir = path.resolve(process.cwd(), 'dist', 'scan-artifacts', result.targetId);
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir, { recursive: true });
  }

  fs.writeFileSync(path.join(artifactDir, 'result.json'), JSON.stringify(result), 'utf8');

  // Save only the page-state entries for URLs this target discovered/scanned.
  const pageStateDelta: PageStateMap = {};
  for (const url of discoveredUrls) {
    if (pageState[url]) {
      pageStateDelta[url] = pageState[url];
    }
  }
  fs.writeFileSync(path.join(artifactDir, 'page-state.json'), JSON.stringify(pageStateDelta), 'utf8');

  fs.writeFileSync(path.join(artifactDir, 'exclusions.json'), JSON.stringify(exclusions), 'utf8');

  console.log(
    `💾 Saved scan artifacts for "${result.targetId}": ` +
      `${result.pagesScanned.length} pages, ${Object.keys(pageStateDelta).length} page-state entries, ` +
      `${exclusions.length} non-HTML exclusions.`
  );
}

async function main() {
  const startTime = Date.now();
  const profilePath = process.argv[2] || 'profiles/us-health.yml';
  const targetIdFilter = process.env.VITAL_TARGET_ID || '';
  const forceRescan = /^(1|true|yes)$/i.test(process.env.FORCE_RESCAN || '');
  const forcePrioritySeedRefresh = /^(1|true|yes)$/i.test(process.env.FORCE_PRIORITY_SEED_REFRESH || '');
  const revalidateAfterDays = Number.parseInt(process.env.VITAL_REVALIDATE_AFTER_DAYS || '7', 10);
  const updatedWithinDays = Number.parseInt(process.env.VITAL_UPDATED_WITHIN_DAYS || '7', 10);
  const updatedRecheckHours = Number.parseInt(process.env.VITAL_UPDATED_RECHECK_HOURS || '12', 10);
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

    const activeTargets = targetIdFilter
      ? profile.targets.filter(t => t.id === targetIdFilter)
      : profile.targets;

    if (targetIdFilter && activeTargets.length === 0) {
      throw new Error(`Target not found in profile: ${targetIdFilter}`);
    }

    if (targetIdFilter) {
      console.log(`🎯 Single-target mode: scanning only target "${targetIdFilter}".`);
    }

    const globalAccumulatedResults: TargetScanResult[] = [];
    const pageState = PageStateCache.load();
    const previouslyScannedUrls = new Set(Object.keys(pageState));

    const prioritySeedState = await PrioritySeedStore.initialize(profile.targets, {
      // In single-target mode, seeds are refreshed once by the setup job; never refresh here.
      forceRefresh: targetIdFilter ? false : forcePrioritySeedRefresh,
      maxAgeDays: targetIdFilter ? 90 : 31,
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
    for (const target of activeTargets) {
      console.log(`\n===== Planning Target: ${target.name} (${target.id}) =====`);
      const urlQueue = await TargetDiscoveryEngine.discoverUrls(target, {
          pageState,
        previouslyScannedUrls,
          skipPreviouslyScanned: !forceRescan,
          revalidateAfterDays: Number.isFinite(revalidateAfterDays) ? revalidateAfterDays : 7,
            updatedWithinDays: Number.isFinite(updatedWithinDays) ? updatedWithinDays : 7,
            updatedRecheckHours: Number.isFinite(updatedRecheckHours) ? updatedRecheckHours : 12
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

      globalAccumulatedResults.push(targetResult);
    }

    if (targetIdFilter) {
      // 5a. Single-target mode: save scan artifacts for the compile-and-deploy job.
      // BugExporter, DashboardCompiler, and RunHistoryReporter are deferred to src/compile.ts.
      const result = globalAccumulatedResults[0];
      if (result) {
        const plan = scanPlans[0];
        const discoveryExclusions = TargetDiscoveryEngine.consumeNonHtmlExclusions();
        saveSingleTargetArtifacts(result, plan ? plan.discoveredUrls : [], pageState, discoveryExclusions);
      }
      const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`\n✅ Single-target scan for "${targetIdFilter}" completed in ${durationSec}s. Artifacts saved.`);
      return;
    }

    // 5b. Full-profile mode: generate bug tickets and compile the global dashboard.
    for (const plan of scanPlans) {
      const targetResult = globalAccumulatedResults.find(r => r.targetId === plan.target.id);
      if (!targetResult) {
        continue;
      }

      // 5. Generate individual Markdown Bug Ticket Artifact for this target
      console.log(`📝 Exporting Section 508 developer tickets...`);
      const seedUrls = PrioritySeedStore.getSeedUrls(plan.target);
      BugExporter.exportMarkdownReport(targetResult, seedUrls);
    }

    // 6. Compile global dashboard across all scanned profiles
    console.log(`\n📊 Compiling executive compliance dashboard UI...`);
    const discoveryNonHtmlExclusions = TargetDiscoveryEngine.consumeNonHtmlExclusions();
    DashboardCompiler.compileStaticDashboard(globalAccumulatedResults, {
      nonHtmlDiscoveryExclusions: discoveryNonHtmlExclusions,
      prioritySeedSnapshot: PrioritySeedStore.getActiveSnapshot()
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

// Lighthouse's `waitForCPUIdle` helper calls `checkForQuiet` recursively
// via `setTimeout(() => checkForQuiet(...))` — a fire-and-forget pattern that
// creates a Promise with no rejection handler.  When Chrome is killed at the
// end of a scan session the pending `Runtime.evaluate` inside that callback
// rejects with a Protocol error.  On Node.js ≥ 15 an unhandled rejection
// crashes the process, aborting any subsequent scan rounds.
//
// We suppress these benign post-shutdown artifacts here instead of letting
// them propagate as fatal errors.  All other unhandled rejections are
// re-emitted so that real bugs remain visible.
process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/protocol error/i.test(message) && /session closed|target closed/i.test(message)) {
    console.warn(`⚠️ Suppressed stale Lighthouse Protocol rejection after Chrome shutdown: ${message}`);
    return;
  }
  // Re-emit as an uncaught exception so Node.js still terminates on real bugs.
  throw reason;
});

main();
