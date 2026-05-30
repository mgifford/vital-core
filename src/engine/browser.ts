import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { chromium, Browser, Page } from 'playwright';
import { TargetConfig } from '../types/profile';
import { PageScanReport } from '../types/site-quality-spec';
import { PageStateEntry, PageStateMap } from './reporters/page-state-cache';
import { LiveWorker } from './workers/live-worker';
import { OfflineWorker } from './workers/offline-worker';
import { TechnologyWorker } from './workers/technology-worker';

interface SnapshotSessionOptions {
  forceRescan?: boolean;
  pageState?: PageStateMap;
}

interface PageProbeResult {
  unchanged: boolean;
  reason: string;
  etag: string | null;
  lastModified: string | null;
  contentHash: string | null;
}

export class ResilientBrowserEngine {
  private static SNAPSHOT_DIR = path.resolve(process.cwd(), 'tmp/html-snapshots');

  /**
   * Orchestrates the browser session lifecycle to scrape target pages and generate snapshots.
   */
  public static async executeSnapshotSession(
    target: TargetConfig,
    urlQueue: string[],
    options: SnapshotSessionOptions = {}
  ): Promise<Partial<PageScanReport>[]> {
    
    // Ensure local snapshot directory cache layout exists
    if (!fs.existsSync(this.SNAPSHOT_DIR)) {
      fs.mkdirSync(this.SNAPSHOT_DIR, { recursive: true });
    }

    console.log(`🚀 Starting headless browser session for target: ${target.id}`);
    const browser: Browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 VitalCore/1.0'
    });
    
    const reports: Partial<PageScanReport>[] = [];
    const settings = target.settings;
    const pageState = options.pageState;
    const forceRescan = options.forceRescan === true;

    for (const url of urlQueue) {
      const probe = await this.probePageChange(url, pageState?.[url], settings.maxTimeoutMs);
      
      const baseReport: Partial<PageScanReport> = {
        url,
        timestamp: new Date().toISOString(),
        status: 'COMPLETED',
        errorMessage: null,
        technologyStack: [],
        liveAudits: null,
        offlineAudits: null
      };

      if (!forceRescan && probe.unchanged) {
        baseReport.status = 'SKIPPED_UNCHANGED';
        baseReport.errorMessage = probe.reason;
        console.log(`⏭️ Skipping unchanged page: ${url}`);

        if (pageState) {
          this.writePageState(pageState, url, probe, false, pageState[url]?.lastScannedAt || '');
        }

        reports.push(baseReport);
        continue;
      }

      console.log(`🌐 Navigating to: ${url}`);
      const page: Page = await context.newPage();
      const scannedAt = new Date().toISOString();

      try {
        // 1. Navigation with strict 2-minute hard boundary
        await page.goto(url, {
          waitUntil: 'networkidle',
          timeout: settings.maxTimeoutMs
        });

        // 2. Hydration Settle Buffer (Let slow API grids map to the DOM)
        if (settings.postLoadDelay > 0) {
          console.log(`⏱️ Applying load buffer of ${settings.postLoadDelay}ms for dynamic scripts...`);
          await page.waitForTimeout(settings.postLoadDelay);
        }

        // 3. Extract fully rendered HTML string state
        const hydratedHtml = await page.content();
        const contentHash = this.hashContent(hydratedHtml);

        // 4. Detect CMS/framework tooling footprint for page profile reporting
        baseReport.technologyStack = await TechnologyWorker.detectTechnologyStack(url);

        // 5. Run Live browser evaluations in memory (Axe Core Automation)
        console.log(`🧪 Launching live accessibility evaluations for: ${url}`);
        baseReport.liveAudits = await LiveWorker.runLiveAudits(page);

        // 6. Generate offline local analysis metrics from DOM snapshot
        baseReport.offlineAudits = OfflineWorker.processSnapshot(hydratedHtml);

        // 7. Clean URL into a cross-platform safe filename
        const safeFilename = this.sanitizeUrlToFilename(url);
        const snapshotPath = path.join(this.SNAPSHOT_DIR, safeFilename);

        fs.writeFileSync(snapshotPath, hydratedHtml, 'utf8');
        console.log(`💾 Snapshot safely cached to disk: tmp/html-snapshots/${safeFilename}`);

        baseReport.status = 'COMPLETED';

        if (pageState) {
          this.writePageState(pageState, url, { ...probe, contentHash }, true, scannedAt);
        }

      } catch (error: any) {
        baseReport.status = 'FAILED';
        
        if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
          baseReport.status = 'TIMEOUT';
          baseReport.errorMessage = `Page execution exceeded strict ${settings.maxTimeoutMs / 1000}s limit.`;
        } else {
          baseReport.errorMessage = error.message;
        }

        console.warn(`⚠️ Skipping assessment loop for ${url}: ${baseReport.errorMessage}`);

        if (pageState) {
          this.writePageState(pageState, url, probe, true, scannedAt);
        }
      } finally {
        await page.close();
        reports.push(baseReport);
      }
    }

    await browser.close();
    console.log(`🏁 Browser session terminated for ${target.id}. Total Snapshots generated: ${reports.filter(r => r.status === 'COMPLETED').length}`);
    return reports;
  }

  /**
   * Converts a URL string into a deterministic filesystem-safe string
   */
  private static sanitizeUrlToFilename(url: string): string {
    return url
      .replace(/^https?:\/\//, '')
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase() + '.html';
  }

  private static async probePageChange(
    url: string,
    previousState: PageStateEntry | undefined,
    maxTimeoutMs: number
  ): Promise<PageProbeResult> {
    const timeoutMs = Math.min(maxTimeoutMs, 15000);

    try {
      const headResponse = await this.fetchWithTimeout(url, { method: 'HEAD' }, timeoutMs);
      const etag = headResponse.headers.get('etag');
      const lastModified = headResponse.headers.get('last-modified');

      if (previousState) {
        if (etag && previousState.etag && etag === previousState.etag) {
          return {
            unchanged: true,
            reason: 'Skipped unchanged page based on matching ETag.',
            etag,
            lastModified,
            contentHash: previousState.contentHash
          };
        }

        if (lastModified && previousState.lastModified && lastModified === previousState.lastModified) {
          return {
            unchanged: true,
            reason: 'Skipped unchanged page based on matching Last-Modified header.',
            etag,
            lastModified,
            contentHash: previousState.contentHash
          };
        }
      }

      if (!etag && !lastModified && previousState?.contentHash) {
        try {
          const getResponse = await this.fetchWithTimeout(url, { method: 'GET' }, timeoutMs);
          const contentHash = this.hashContent(await getResponse.text());
          if (contentHash === previousState.contentHash) {
            return {
              unchanged: true,
              reason: 'Skipped unchanged page based on matching lightweight content hash.',
              etag,
              lastModified,
              contentHash
            };
          }

          return {
            unchanged: false,
            reason: 'Page changed based on lightweight content hash comparison.',
            etag,
            lastModified,
            contentHash
          };
        } catch {
          // Fall through to changed=true when lightweight fetch fails.
        }
      }

      return {
        unchanged: false,
        reason: 'Page appears changed or no prior state available.',
        etag,
        lastModified,
        contentHash: previousState?.contentHash ?? null
      };
    } catch {
      return {
        unchanged: false,
        reason: 'Change probe failed; scanning page to avoid missing updates.',
        etag: previousState?.etag ?? null,
        lastModified: previousState?.lastModified ?? null,
        contentHash: previousState?.contentHash ?? null
      };
    }
  }

  private static async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'VitalCore/1.0 (+https://github.com/mgifford/vital-core)'
        }
      });

      if (!response.ok) {
        throw new Error(`Probe failed with status ${response.status}`);
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  private static hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private static writePageState(
    pageState: PageStateMap,
    url: string,
    probe: PageProbeResult,
    scanned: boolean,
    scannedAt: string
  ): void {
    const previous = pageState[url];
    pageState[url] = {
      etag: probe.etag,
      lastModified: probe.lastModified,
      contentHash: probe.contentHash,
      lastCheckedAt: new Date().toISOString(),
      lastScannedAt: scanned ? scannedAt : previous?.lastScannedAt || ''
    };
  }
}
