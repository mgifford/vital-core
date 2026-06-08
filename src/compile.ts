import * as fs from 'fs';
import * as path from 'path';
import { ProfileParser } from './engine/parser';
import { BugExporter } from './engine/reporters/bug-exporter';
import { DashboardCompiler } from './engine/reporters/dashboard-compiler';
import { PageStateCache, PageStateMap } from './engine/reporters/page-state-cache';
import { RunHistoryReporter } from './engine/reporters/run-history';
import { PrioritySeedStore } from './engine/priority-seeds';
import { TargetScanResult, TargetScanResultSchema } from './types/site-quality-spec';
import { DiscoveryNonHtmlExclusion, DiscoveryQueueSummary } from './engine/discovery';

/**
 * Compile-and-deploy phase for parallel matrix scan runs.
 *
 * After all per-target scan jobs complete, this script:
 *   1. Reads each target's TargetScanResult artifact from dist/scan-artifacts/<id>/result.json
 *   2. Merges per-target page-state deltas into a unified page-state
 *   3. Merges per-target non-HTML discovery exclusions
 *   4. Runs BugExporter, DashboardCompiler, PageStateCache.save, and RunHistoryReporter
 *
 * Requires VITAL_HISTORY_CACHE_DIR to be set so history data is available.
 */

const SCAN_ARTIFACTS_DIR = path.resolve(process.cwd(), 'dist', 'scan-artifacts');

function isCancellationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return /operation was canceled/i.test(String(error));
  }

  const candidate = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    cause?: unknown;
  };

  const name = typeof candidate.name === 'string' ? candidate.name : '';
  const message = typeof candidate.message === 'string' ? candidate.message : String(error);
  const code = typeof candidate.code === 'string' ? candidate.code : '';

  if (name === 'AbortError' || code === 'ABORT_ERR') {
    return true;
  }

  if (/operation was canceled/i.test(message) || /aborted/i.test(message)) {
    return true;
  }

  return isCancellationError(candidate.cause);
}

function loadScanArtifacts(): {
  results: TargetScanResult[];
  pageStateDeltas: PageStateMap[];
  allExclusions: DiscoveryNonHtmlExclusion[];
  queueSummaries: Map<string, DiscoveryQueueSummary>;
} {
  if (!fs.existsSync(SCAN_ARTIFACTS_DIR)) {
    return { results: [], pageStateDeltas: [], allExclusions: [], queueSummaries: new Map() };
  }

  const results: TargetScanResult[] = [];
  const pageStateDeltas: PageStateMap[] = [];
  const allExclusions: DiscoveryNonHtmlExclusion[] = [];
  const queueSummaries = new Map<string, DiscoveryQueueSummary>();

  const entries = fs.readdirSync(SCAN_ARTIFACTS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const targetDir = path.join(SCAN_ARTIFACTS_DIR, entry.name);

    const resultPath = path.join(targetDir, 'result.json');
    if (fs.existsSync(resultPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as unknown;
        const parsed = TargetScanResultSchema.safeParse(raw);
        if (parsed.success) {
          results.push(parsed.data);
        } else {
          console.warn(`⚠️ Skipping malformed result artifact for "${entry.name}": ${parsed.error.message}`);
        }
      } catch (err: any) {
        console.warn(`⚠️ Failed to read result artifact for "${entry.name}": ${err.message}`);
      }
    }

    const pageStatePath = path.join(targetDir, 'page-state.json');
    if (fs.existsSync(pageStatePath)) {
      try {
        const delta = JSON.parse(fs.readFileSync(pageStatePath, 'utf8')) as PageStateMap;
        pageStateDeltas.push(delta);
      } catch (err: any) {
        console.warn(`⚠️ Failed to read page-state artifact for "${entry.name}": ${err.message}`);
      }
    }

    const exclusionsPath = path.join(targetDir, 'exclusions.json');
    if (fs.existsSync(exclusionsPath)) {
      try {
        const exclusions = JSON.parse(fs.readFileSync(exclusionsPath, 'utf8')) as DiscoveryNonHtmlExclusion[];
        if (Array.isArray(exclusions)) {
          allExclusions.push(...exclusions);
        }
      } catch (err: any) {
        console.warn(`⚠️ Failed to read exclusions artifact for "${entry.name}": ${err.message}`);
      }
    }

    const queueSummaryPath = path.join(targetDir, 'scan-queue-summary.json');
    if (fs.existsSync(queueSummaryPath)) {
      try {
        const summary = JSON.parse(fs.readFileSync(queueSummaryPath, 'utf8')) as DiscoveryQueueSummary;
        if (summary && typeof summary === 'object') {
          queueSummaries.set(entry.name, summary);
        }
      } catch (err: any) {
        console.warn(`⚠️ Failed to read queue summary for "${entry.name}": ${err.message}`);
      }
    }

    const queuePath = path.join(targetDir, 'scan-queue.json');
    if (fs.existsSync(queuePath)) {
      const targetId = entry.name;
      const queueDestDir = path.resolve(process.cwd(), 'dist', 'runs', targetId);
      const queueDestPath = path.join(queueDestDir, 'scan-queue.json');
      const queueSummaryDestPath = path.join(queueDestDir, 'scan-queue-summary.json');
      try {
        if (!fs.existsSync(queueDestDir)) {
          fs.mkdirSync(queueDestDir, { recursive: true });
        }
        fs.copyFileSync(queuePath, queueDestPath);
        if (fs.existsSync(queueSummaryPath)) {
          fs.copyFileSync(queueSummaryPath, queueSummaryDestPath);
        }
        console.log(`📋 Restored scan queue for "${targetId}" → dist/runs/${targetId}/scan-queue.json`);
      } catch (err: any) {
        console.warn(`⚠️ Failed to restore scan queue for "${targetId}": ${err.message}`);
      }
    }

    // Restore url-manifest.json so it is published to GitHub Pages and available
    // to fetch-history.mjs → UrlManifestStore.restoreCachedManifest() on the next run.
    // Without this copy, the url-manifest never reaches Pages and partitionByRecency
    // has no data, causing already-scanned URLs to resurface in every run.
    const manifestSrcPath = path.join(targetDir, 'url-manifest.json');
    if (fs.existsSync(manifestSrcPath)) {
      const targetId = entry.name;
      const manifestDestDir = path.resolve(process.cwd(), 'dist', 'runs', targetId);
      const manifestDestPath = path.join(manifestDestDir, 'url-manifest.json');
      try {
        if (!fs.existsSync(manifestDestDir)) {
          fs.mkdirSync(manifestDestDir, { recursive: true });
        }
        fs.copyFileSync(manifestSrcPath, manifestDestPath);
        console.log(`📋 Restored url-manifest for "${targetId}" → dist/runs/${targetId}/url-manifest.json`);
      } catch (err: any) {
        console.warn(`⚠️ Failed to restore url-manifest for "${targetId}": ${err.message}`);
      }
    }
  }

  return { results, pageStateDeltas, allExclusions, queueSummaries };
}

async function main() {
  const startTime = Date.now();
  const profilePath = process.argv[2] || 'profiles/us-health.yml';

  console.log(`🗜️  VITAL-Core Compile Phase starting for profile: ${profilePath}`);

  try {
    const profile = ProfileParser.loadProfile(profilePath);

    // Initialize priority seeds from history cache without triggering a refresh.
    // Seeds are refreshed by the setup job when needed.
    const prioritySeedState = await PrioritySeedStore.initialize(profile.targets, {
      forceRefresh: false,
      maxAgeDays: 90,
      perTargetLimit: 12
    });

    console.log(
      `🧭 Priority URL seeds loaded (${prioritySeedState.targetCount} targets, generated ${prioritySeedState.generatedAt}).`
    );

    // Load the base page-state from history (via VITAL_HISTORY_CACHE_DIR restoration).
    const basePageState = PageStateCache.load();

    // Read all per-target scan artifacts.
    const { results, pageStateDeltas, allExclusions, queueSummaries } = loadScanArtifacts();

    if (results.length === 0) {
      throw new Error(
        `No scan artifacts found in ${SCAN_ARTIFACTS_DIR}. Ensure all scan jobs completed successfully.`
      );
    }

    console.log(`📦 Loaded ${results.length} target scan artifact(s) from ${SCAN_ARTIFACTS_DIR}.`);

    // Merge per-target page-state deltas into the base history page-state.
    // Each target only mutates URLs within its own domain, so deltas are non-overlapping.
    const mergedPageState: PageStateMap = { ...basePageState };
    for (const delta of pageStateDeltas) {
      Object.assign(mergedPageState, delta);
    }

    // Generate bug reports for each target.
    for (const result of results) {
      const target = profile.targets.find(t => t.id === result.targetId);
      const seedUrls = target ? PrioritySeedStore.getSeedUrls(target) : [];
      console.log(`📝 Exporting Section 508 developer tickets for ${result.targetId}...`);
      BugExporter.exportMarkdownReport(result, seedUrls);
    }

    // Compile the global dashboard from all collected scan results.
    console.log(`\n📊 Compiling executive compliance dashboard UI...`);
    DashboardCompiler.compileStaticDashboard(results, {
      nonHtmlDiscoveryExclusions: allExclusions,
      queueSummaries,
      prioritySeedSnapshot: PrioritySeedStore.getActiveSnapshot()
    });

    // Persist the merged page-state.
    try {
      PageStateCache.save(mergedPageState);
    } catch (error) {
      if (isCancellationError(error)) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`⚠️  Page-state persistence canceled; continuing with the collected artifacts. ${message}`);
      } else {
        throw error;
      }
    }

    // Persist run history.
    const totalDurationMs = Date.now() - startTime;
    const runEntry = RunHistoryReporter.persistRunHistory(results, profilePath, totalDurationMs);
    console.log(`🗃️  Updated persistent run history index with run ${runEntry.runId}.`);

    const totalDurationSec = (totalDurationMs / 1000).toFixed(2);
    console.log(`\n🏁 VITAL-Core Compile Phase Completed Successfully in ${totalDurationSec}s.`);
  } catch (error: any) {
    if (isCancellationError(error)) {
      console.warn(`⚠️  Compile phase canceled; exiting without failing the workflow. ${error.message}`);
      process.exit(0);
    }

    console.error(`❌ Compile phase failed:`, error.message);
    process.exit(1);
  }
}

main();
