import * as fs from 'fs';
import * as path from 'path';
import type { DiscoveryQueueComposition } from '../discovery';
import { TargetScanResult } from '../../types/site-quality-spec';
import { UrlManifest, UrlManifestStore } from '../url-manifest';

export interface FailedUrlDetail {
  url: string;
  status: string;
  consecutiveFailures: number;
  cooldownUntil: string | null;
}

export interface TargetScanStatus {
  targetId: string;
  domain: string;
  /** Total URLs tracked in the manifest for this target (includes all-time discovered URLs). */
  totalKnownUrls: number;
  /** Pages included in the scan queue this run (after filtering). */
  queuedThisRun: number;
  /** Pages returned in scan reports this run (COMPLETED + SKIPPED_UNCHANGED + failures). */
  scannedThisRun: number;
  completedThisRun: number;
  skippedUnchangedThisRun: number;
  timedOutThisRun: number;
  failedThisRun: number;
  /** Pages excluded before scanning because they succeeded within the rescan window. */
  skippedRecentlyScanned: number;
  /** Pages currently in a quarantine cooldown (excluded from queue until cooldown expires). */
  quarantinedUrls: number;
  /** Explicit queue composition by discovery source. */
  queueComposition: DiscoveryQueueComposition;
  /** CDN provider detected from response headers, or null if none. */
  cdnProvider: string | null;
  /** Throttle profile applied for this target during the run. */
  throttleProfile: string;
  /** Remaining daily page budget, or null if no budget was configured. */
  remainingDailyBudget: number | null;
  /** Per-URL details for all pages that timed out or failed this run. */
  failedUrlDetails: FailedUrlDetail[];
}

export interface ScanStatusPayload {
  targets: TargetScanStatus[];
}

export class ScanStatusReporter {
  private static get runsDir(): string {
    return path.resolve(process.cwd(), 'dist/runs');
  }

  /**
   * Builds per-target scan status summaries from scan results and their manifests.
   */
  public static buildScanStatus(
    results: TargetScanResult[],
    manifests: Map<string, UrlManifest>,
    options: {
      cdnProviders?: Map<string, string | null>;
      throttleProfiles?: Map<string, string>;
      dailyBudgets?: Map<string, number | null>;
      skippedByRecency?: Map<string, number>;
      queueSizes?: Map<string, number>;
      queueCompositions?: Map<string, DiscoveryQueueComposition>;
    } = {}
  ): TargetScanStatus[] {
    const {
      cdnProviders = new Map(),
      throttleProfiles = new Map(),
      dailyBudgets = new Map(),
      skippedByRecency = new Map(),
      queueSizes = new Map(),
      queueCompositions = new Map()
    } = options;

    const emptyQueueComposition: DiscoveryQueueComposition = {
      recently_updated: 0,
      duckduckgo_seed: 0,
      priority_url: 0,
      stale_weekly_rescan: 0,
      sitemap_sample: 0
    };

    return results.map(result => {
      const manifest = manifests.get(result.targetId) ?? {};
      const cdnProvider = cdnProviders.get(result.targetId) ?? null;
      const throttleProfile = throttleProfiles.get(result.targetId) ?? 'moderate';
      const budget = dailyBudgets.get(result.targetId) ?? null;
      const skippedRecent = skippedByRecency.get(result.targetId) ?? 0;
      const queuedThisRun = queueSizes.get(result.targetId) ?? result.pagesScanned.length;
      const queueComposition = queueCompositions.get(result.targetId) ?? emptyQueueComposition;

      const completed = result.pagesScanned.filter(p => p.status === 'COMPLETED').length;
      const skippedUnchanged = result.pagesScanned.filter(p => p.status === 'SKIPPED_UNCHANGED').length;
      const timedOut = result.pagesScanned.filter(p => p.status === 'TIMEOUT').length;
      const failed = result.pagesScanned.filter(
        p => p.status === 'FAILED' || p.status === 'WAF_BLOCKED'
      ).length;

      const quarantinedUrls = UrlManifestStore.countQuarantined(manifest);
      const totalKnownUrls = Object.keys(manifest).length;

      const failedUrlDetails: FailedUrlDetail[] = result.pagesScanned
        .filter(p => p.status === 'TIMEOUT' || p.status === 'FAILED' || p.status === 'WAF_BLOCKED')
        .map(p => {
          const entry = manifest[p.url];
          return {
            url: p.url,
            status: p.status,
            consecutiveFailures: entry?.consecutiveFailures ?? 1,
            cooldownUntil: entry?.cooldownUntil ?? null
          };
        });

      const remainingDailyBudget =
        budget !== null ? Math.max(0, budget - completed - skippedUnchanged) : null;

      return {
        targetId: result.targetId,
        domain: result.domain,
        totalKnownUrls,
        queuedThisRun,
        scannedThisRun: result.pagesScanned.length,
        completedThisRun: completed,
        skippedUnchangedThisRun: skippedUnchanged,
        timedOutThisRun: timedOut,
        failedThisRun: failed,
        skippedRecentlyScanned: skippedRecent,
        quarantinedUrls,
        queueComposition,
        cdnProvider,
        throttleProfile,
        remainingDailyBudget,
        failedUrlDetails
      };
    });
  }

  /**
   * Persists the scan status payload as JSON to `dist/runs/scan-status.json`.
   */
  public static saveJson(statuses: TargetScanStatus[]): void {
    if (!fs.existsSync(this.runsDir)) {
      fs.mkdirSync(this.runsDir, { recursive: true });
    }

    const payload: ScanStatusPayload = {
      targets: statuses
    };

    fs.writeFileSync(
      path.join(this.runsDir, 'scan-status.json'),
      JSON.stringify(payload, null, 2),
      'utf8'
    );
  }

  /**
   * Builds a Markdown scan status report suitable for PR comments or CI logs.
   */
  public static buildMarkdownReport(statuses: TargetScanStatus[]): string {
    const lines: string[] = [
      '# Scan Status Report',
      '',
      '## Per-Domain Summary',
      '',
      '| Domain | Known URLs | Queued | Completed | Unchanged | Budget-Skipped | Timed Out | Failed | Quarantined | Queue Composition | CDN | Throttle |',
      '|--------|-----------|--------|-----------|-----------|---------------|-----------|--------|-------------|-------------------|-----|----------|'
    ];

    for (const s of statuses) {
      const cdn = s.cdnProvider ?? '—';
      const queueComposition = this.formatQueueComposition(s.queueComposition);
      lines.push(
        `| ${s.domain} | ${s.totalKnownUrls} | ${s.queuedThisRun} | ` +
          `${s.completedThisRun} | ${s.skippedUnchangedThisRun} | ${s.skippedRecentlyScanned} | ` +
          `${s.timedOutThisRun} | ${s.failedThisRun} | ${s.quarantinedUrls} | ${queueComposition} | ` +
          `${cdn} | ${s.throttleProfile} |`
      );
    }

    lines.push('');

    // Per-target failure details
    for (const s of statuses) {
      if (s.failedUrlDetails.length === 0) {
        continue;
      }

      lines.push(`## ${s.domain} — Timeout / Failed URLs`);
      lines.push('');
      lines.push('| URL | Status | Consecutive Failures | Quarantined Until |');
      lines.push('|-----|--------|----------------------|-------------------|');

      for (const d of s.failedUrlDetails) {
        const cooldown = d.cooldownUntil ?? '—';
        lines.push(
          `| ${d.url} | ${d.status} | ${d.consecutiveFailures} | ${cooldown} |`
        );
      }
      lines.push('');
    }

    lines.push('## Throttle & CDN Guidance');
    lines.push('');
    lines.push(
      'Sites behind **Akamai**, **Cloudflare**, or **Imperva** are auto-assigned the ' +
        '`conservative` throttle profile (3 s base delay + 1.5 s jitter) unless overridden.'
    );
    lines.push(
      'Add `throttle_profile: conservative` to a target\'s `settings` block to enforce it explicitly.'
    );
    lines.push(
      'Set `VITAL_SCAN_WINDOW_START_HOUR` / `VITAL_SCAN_WINDOW_END_HOUR` (UTC) to restrict scans ' +
        'to off-peak hours. Recommended window for US government sites: **22:00–06:00 UTC** (6 PM–1 AM ET).'
    );

    return lines.join('\n');
  }

  /**
   * Writes both the JSON and Markdown scan status reports to `dist/runs/`.
   */
  public static save(statuses: TargetScanStatus[]): void {
    this.saveJson(statuses);

    const markdown = this.buildMarkdownReport(statuses);
    if (!fs.existsSync(this.runsDir)) {
      fs.mkdirSync(this.runsDir, { recursive: true });
    }
    fs.writeFileSync(path.join(this.runsDir, 'scan-status.md'), markdown, 'utf8');
  }

  private static formatQueueComposition(queueComposition: DiscoveryQueueComposition): string {
    return [
      `updated:${queueComposition.recently_updated}`,
      `seed:${queueComposition.duckduckgo_seed}`,
      `priority:${queueComposition.priority_url}`,
      `weekly:${queueComposition.stale_weekly_rescan}`,
      `sample:${queueComposition.sitemap_sample}`
    ].join(', ');
  }
}
