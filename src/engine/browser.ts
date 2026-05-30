import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { load } from 'cheerio';
import { chromium, firefox, webkit, Browser, BrowserContext, Page } from 'playwright';
import { TargetConfig } from '../types/profile';
import { PageScanReport } from '../types/site-quality-spec';
import { PageStateEntry, PageStateMap } from './reporters/page-state-cache';
import { LiveWorker } from './workers/live-worker';
import { LighthouseWorker } from './workers/lighthouse-worker';
import { OfflineWorker } from './workers/offline-worker';
import { TechnologyWorker } from './workers/technology-worker';
import { AlfaWorker } from './workers/alfa-worker';
import { ThirdPartyImpactWorker } from './workers/third-party-impact-worker';

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
  assetFingerprintHash: string | null;
}

type EngineType = 'chromium' | 'firefox' | 'webkit';
type EmulatedBrowserFamily = 'chrome' | 'firefox' | 'safari';
type EmulatedColorScheme = 'light' | 'dark';

interface EmulationProfile {
  family: EmulatedBrowserFamily;
  viewportLabel: string;
  viewport: {
    width: number;
    height: number;
  };
  colorScheme: EmulatedColorScheme;
  userAgent: string;
}

export class ResilientBrowserEngine {
  private static SNAPSHOT_DIR = path.resolve(process.cwd(), 'tmp/html-snapshots');
  private static readonly BROWSER_FAMILIES: EmulatedBrowserFamily[] = ['chrome', 'firefox', 'safari'];
  private static readonly VIEWPORT_PRESETS = [
    { label: 'desktop-standard', width: 1366, height: 768 },
    { label: 'desktop-wide', width: 1920, height: 1080 },
    { label: 'tablet-portrait', width: 834, height: 1112 },
    { label: 'tablet-landscape', width: 1112, height: 834 },
    { label: 'mobile-portrait', width: 390, height: 844 },
    { label: 'mobile-landscape', width: 844, height: 390 }
  ] as const;

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
    const engine = this.selectEngineForTarget(target.id);
    const browser: Browser = await this.launchBrowser(engine);
    
    const reports: Partial<PageScanReport>[] = [];
    const settings = target.settings;
    const pageState = options.pageState;
    const forceRescan = options.forceRescan === true;

    for (const url of urlQueue) {
      const emulation = this.selectEmulationProfile(target.id, url);
      const probe = await this.probePageChange(url, pageState?.[url], settings.maxTimeoutMs);
      
      const baseReport: Partial<PageScanReport> = {
        url,
        timestamp: new Date().toISOString(),
        status: 'COMPLETED',
        errorMessage: null,
        alfaAudits: null,
        technologyStack: [],
        thirdPartyImpact: null,
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
      console.log(
        `🧭 Emulation profile: ${emulation.family}/${emulation.viewportLabel}/${emulation.colorScheme} (${emulation.viewport.width}x${emulation.viewport.height})`
      );

      const context: BrowserContext = await browser.newContext({
        userAgent: emulation.userAgent,
        viewport: emulation.viewport,
        colorScheme: emulation.colorScheme
      });
      const page: Page = await context.newPage();
      page.setDefaultNavigationTimeout(settings.maxTimeoutMs);
      page.setDefaultTimeout(settings.maxTimeoutMs);
      const scannedAt = new Date().toISOString();

      try {
        await this.runWithTimeout(async () => {
          // 1. Navigation with strict maxTimeoutMs boundary
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
          const assetFingerprintHash = this.computeAssetFingerprint(hydratedHtml, url);

          // 4. Detect CMS/framework tooling footprint for page profile reporting
          baseReport.technologyStack = await TechnologyWorker.detectTechnologyStack(url);

          // 5. Generate offline local analysis metrics from DOM snapshot
          baseReport.offlineAudits = OfflineWorker.processSnapshot(hydratedHtml);

          // 6. Run Live browser evaluations in memory (Axe Core Automation)
          console.log(`🧪 Launching live accessibility evaluations for: ${url}`);
          baseReport.liveAudits = await LiveWorker.runLiveAudits(page);

          // 6b. Capture raw Alfa results for this page to support future consensus mapping.
          baseReport.alfaAudits = await AlfaWorker.runAlfaAudits(url);

          // 7. Compare impact of suspicious third-party scripts by re-auditing with JavaScript disabled
          if (baseReport.offlineAudits) {
            baseReport.thirdPartyImpact = await ThirdPartyImpactWorker.evaluate({
              browser,
              url,
              maxTimeoutMs: settings.maxTimeoutMs,
              postLoadDelay: settings.postLoadDelay,
              htmlSnapshot: hydratedHtml,
              technologyStack: baseReport.technologyStack,
              offlineAudits: baseReport.offlineAudits,
              baselineLiveAudits: baseReport.liveAudits
            });
          }

          // 8. Clean URL into a cross-platform safe filename
          const safeFilename = this.sanitizeUrlToFilename(url);
          const snapshotPath = path.join(this.SNAPSHOT_DIR, safeFilename);

          fs.writeFileSync(snapshotPath, hydratedHtml, 'utf8');
          console.log(`💾 Snapshot safely cached to disk: tmp/html-snapshots/${safeFilename}`);

          // 9. Run Lighthouse performance against the local cached snapshot to track page load quality over time.
          const lighthouse = await LighthouseWorker.auditCachedSnapshot(snapshotPath, settings.maxTimeoutMs);
          if (baseReport.liveAudits) {
            baseReport.liveAudits.lighthouse = lighthouse;
          }

          baseReport.status = 'COMPLETED';

          if (pageState) {
            this.writePageState(pageState, url, { ...probe, contentHash, assetFingerprintHash }, true, scannedAt);
          }
        }, settings.maxTimeoutMs);

      } catch (error: any) {
        baseReport.status = 'FAILED';
        
        if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
          baseReport.status = 'TIMEOUT';
          baseReport.errorMessage = `Page scan exceeded strict ${settings.maxTimeoutMs / 1000}s limit and was cancelled.`;
        } else {
          baseReport.errorMessage = error.message;
        }

        console.warn(`⚠️ Skipping assessment loop for ${url}: ${baseReport.errorMessage}`);

        if (pageState) {
          this.writePageState(pageState, url, probe, true, scannedAt);
        }
      } finally {
        await page.close();
        await context.close();
        reports.push(baseReport);
      }
    }

    await browser.close();
    console.log(`🏁 Browser session terminated for ${target.id}. Total Snapshots generated: ${reports.filter(r => r.status === 'COMPLETED').length}`);
    return reports;
  }

  private static selectEngineForTarget(targetId: string): EngineType {
    const allowMultiEngine = /^(1|true|yes)$/i.test(process.env.VITAL_ENABLE_MULTI_ENGINE || '');
    if (!allowMultiEngine) {
      return 'chromium';
    }

    const index = this.seededIndex(`engine:${targetId}`, 3);
    if (index === 1) {
      return 'firefox';
    }
    if (index === 2) {
      return 'webkit';
    }
    return 'chromium';
  }

  private static async launchBrowser(engine: EngineType): Promise<Browser> {
    try {
      if (engine === 'firefox') {
        return await firefox.launch({ headless: true });
      }
      if (engine === 'webkit') {
        return await webkit.launch({ headless: true });
      }
      return await chromium.launch({ headless: true });
    } catch (error: any) {
      console.warn(`⚠️ Browser engine '${engine}' unavailable (${error.message}). Falling back to chromium.`);
      return await chromium.launch({ headless: true });
    }
  }

  private static selectEmulationProfile(targetId: string, url: string): EmulationProfile {
    const family = this.BROWSER_FAMILIES[this.seededIndex(`family:${targetId}:${url}`, this.BROWSER_FAMILIES.length)] || 'chrome';
    const viewport = this.VIEWPORT_PRESETS[this.seededIndex(`viewport:${targetId}:${url}`, this.VIEWPORT_PRESETS.length)] || this.VIEWPORT_PRESETS[0];
    const colorScheme: EmulatedColorScheme = this.seededIndex(`colorscheme:${targetId}:${url}`, 2) === 0 ? 'light' : 'dark';

    return {
      family,
      viewportLabel: viewport.label,
      viewport: {
        width: viewport.width,
        height: viewport.height
      },
      colorScheme,
      userAgent: this.userAgentForFamily(family)
    };
  }

  private static userAgentForFamily(family: EmulatedBrowserFamily): string {
    if (family === 'firefox') {
      return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0 VitalCore/1.0';
    }

    if (family === 'safari') {
      return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15 VitalCore/1.0';
    }

    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 VitalCore/1.0';
  }

  private static seededIndex(seedKey: string, modulo: number): number {
    if (modulo <= 1) {
      return 0;
    }

    const globalSeed = process.env.VITAL_SAMPLING_SEED || new Date().toISOString().slice(0, 13);
    const digest = createHash('sha256').update(`${globalSeed}:${seedKey}`).digest('hex');
    const integer = Number.parseInt(digest.slice(0, 8), 16);
    if (!Number.isFinite(integer)) {
      return 0;
    }

    return Math.abs(integer) % modulo;
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
            contentHash: previousState.contentHash,
            assetFingerprintHash: previousState.assetFingerprintHash
          };
        }

        if (lastModified && previousState.lastModified && lastModified === previousState.lastModified) {
          return {
            unchanged: true,
            reason: 'Skipped unchanged page based on matching Last-Modified header.',
            etag,
            lastModified,
            contentHash: previousState.contentHash,
            assetFingerprintHash: previousState.assetFingerprintHash
          };
        }
      }

      if (!etag && !lastModified && previousState?.contentHash) {
        try {
          const getResponse = await this.fetchWithTimeout(url, { method: 'GET' }, timeoutMs);
          const html = await getResponse.text();
          const contentHash = this.hashContent(html);
          const assetFingerprintHash = this.computeAssetFingerprint(html, url);

          if (
            contentHash === previousState.contentHash &&
            (!previousState.assetFingerprintHash || assetFingerprintHash === previousState.assetFingerprintHash)
          ) {
            return {
              unchanged: true,
              reason: 'Skipped unchanged page based on matching HTML + asset fingerprint hash.',
              etag,
              lastModified,
              contentHash,
              assetFingerprintHash
            };
          }

          return {
            unchanged: false,
            reason: 'Page changed based on HTML + asset fingerprint hash comparison.',
            etag,
            lastModified,
            contentHash,
            assetFingerprintHash
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
        contentHash: previousState?.contentHash ?? null,
        assetFingerprintHash: previousState?.assetFingerprintHash ?? null
      };
    } catch {
      return {
        unchanged: false,
        reason: 'Change probe failed; scanning page to avoid missing updates.',
        etag: previousState?.etag ?? null,
        lastModified: previousState?.lastModified ?? null,
        contentHash: previousState?.contentHash ?? null,
        assetFingerprintHash: previousState?.assetFingerprintHash ?? null
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

  private static computeAssetFingerprint(html: string, pageUrl: string): string {
    const $ = load(html);

    const styleUrls = new Set<string>();
    $('link[rel="stylesheet"][href]').each((_, element) => {
      const href = ($(element).attr('href') || '').trim();
      const resolved = this.resolveAssetUrl(pageUrl, href);
      if (resolved) {
        styleUrls.add(resolved);
      }
    });

    const scriptUrls = new Set<string>();
    $('script[src]').each((_, element) => {
      const src = ($(element).attr('src') || '').trim();
      const resolved = this.resolveAssetUrl(pageUrl, src);
      if (resolved) {
        scriptUrls.add(resolved);
      }
    });

    const inlineScriptHashes: string[] = [];
    $('script:not([src])').each((_, element) => {
      const text = ($(element).html() || '').trim();
      if (text) {
        inlineScriptHashes.push(this.hashContent(text));
      }
    });

    const inlineStyleHashes: string[] = [];
    $('style').each((_, element) => {
      const text = ($(element).html() || '').trim();
      if (text) {
        inlineStyleHashes.push(this.hashContent(text));
      }
    });

    const fingerprintPayload = JSON.stringify({
      styleUrls: Array.from(styleUrls).sort(),
      scriptUrls: Array.from(scriptUrls).sort(),
      inlineScriptHashes: inlineScriptHashes.sort(),
      inlineStyleHashes: inlineStyleHashes.sort()
    });

    return this.hashContent(fingerprintPayload);
  }

  private static resolveAssetUrl(baseUrl: string, candidate: string): string | null {
    if (!candidate) {
      return null;
    }

    try {
      const parsed = new URL(candidate, baseUrl);
      if (!/^https?:$/i.test(parsed.protocol)) {
        return null;
      }

      parsed.hash = '';
      return parsed.toString();
    } catch {
      return null;
    }
  }

  private static async runWithTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
      return await Promise.race([operation(), timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
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
      assetFingerprintHash: probe.assetFingerprintHash,
      lastCheckedAt: new Date().toISOString(),
      lastScannedAt: scanned ? scannedAt : previous?.lastScannedAt || ''
    };
  }
}
