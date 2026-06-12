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
import { CdnDetector, CdnDetectionResult, ThrottleProfile, THROTTLE_PROFILES } from './cdn-detection';
import { UrlManifest, UrlManifestStore, QuarantineConfig, DEFAULT_QUARANTINE_CONFIG } from './url-manifest';

interface SnapshotSessionOptions {
  forceRescan?: boolean;
  pageState?: PageStateMap;
  urlManifest?: UrlManifest;
  quarantineConfig?: QuarantineConfig;
  initialTimeoutStreak?: number;
}

interface PageProbeResult {
  unchanged: boolean;
  reason: string;
  etag: string | null;
  lastModified: string | null;
  contentHash: string | null;
  assetFingerprintHash: string | null;
  /**
   * Raw HTML body retrieved during the GET probe, when the server exposes no
   * cache-validation headers (ETag / Last-Modified).  Present only when a GET
   * request was actually issued; null otherwise.  For non-SPA pages this is
   * equivalent to the fully-rendered HTML, so the scan loop can reuse it
   * directly and avoid an extra `activePage.content()` round-trip.
   */
  fetchedHtml: string | null;
  /**
   * HTTP status code when the server returned a non-ok response (e.g. 404, 410).
   * Null for successful responses.
   */
  httpErrorStatus: number | null;
  /**
   * Base MIME type when the resource is not an HTML document (e.g. 'application/pdf').
   * Null for HTML resources or when the content type is absent.
   */
  nonHtmlContentType: string | null;
  /** CDN detection result captured from the HEAD probe response headers. */
  cdnDetection?: CdnDetectionResult;
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

  private static readonly DEFAULT_SAME_SITE_DELAY_MS = 1500;
  private static readonly DEFAULT_DELAY_JITTER_MS = 750;
  private static readonly DEFAULT_TIMEOUT_BACKOFF_THRESHOLD = 2;
  private static readonly DEFAULT_TIMEOUT_BACKOFF_STEP_MS = 10000;
  private static readonly DEFAULT_TIMEOUT_BACKOFF_MAX_MS = 60000;

  /**
   * Orchestrates the browser session lifecycle to scrape target pages and generate snapshots.
   * Returns scan reports and the CDN provider detected for this target (if any).
   */
  public static async executeSnapshotSession(
    target: TargetConfig,
    urlQueue: string[],
    options: SnapshotSessionOptions = {}
  ): Promise<{ reports: Partial<PageScanReport>[]; cdnProvider: string | null }> {
    
    // Ensure local snapshot directory cache layout exists
    if (!fs.existsSync(this.SNAPSHOT_DIR)) {
      fs.mkdirSync(this.SNAPSHOT_DIR, { recursive: true });
    }

    console.log(`🚀 Starting scan session for target: ${target.id}`);
    const engine = this.selectEngineForTarget(target.id);
    let browser: Browser | null = null;

    const reports: Partial<PageScanReport>[] = [];
    const settings = target.settings;
    const pageState = options.pageState;
    const urlManifest = options.urlManifest;
    const quarantineConfig = options.quarantineConfig ?? DEFAULT_QUARANTINE_CONFIG;
    const forceRescan = options.forceRescan === true;
    const timeoutOverrideMs = this.readDelaySetting('VITAL_MAX_TIMEOUT_MS', 0);
    const effectiveMaxTimeoutMs = timeoutOverrideMs > 0
      ? Math.min(settings.maxTimeoutMs, timeoutOverrideMs)
      : settings.maxTimeoutMs;
    const auditScope = String(process.env.VITAL_AUDIT_SCOPE || 'full').toLowerCase();
    const accessibilityOnly = auditScope === 'accessibility' || auditScope === 'a11y';
    const navigationWaitUntil: 'networkidle' | 'domcontentloaded' = accessibilityOnly ? 'domcontentloaded' : 'networkidle';
    const accessibilitySettleDelayMs = accessibilityOnly
      ? this.readDelaySetting('VITAL_A11Y_SETTLE_DELAY_MS', Math.max(settings.postLoadDelay, 1500))
      : 0;

    // Resolve throttle profile: explicit profile setting → CDN auto-detection → env vars → defaults.
    // CDN detection is deferred to the first probe and applied from the second request onward.
    let detectedCdn: CdnDetectionResult = { provider: null, confidence: 'LOW', detectedHeaders: [] };
    const explicitThrottleProfile = settings.throttle_profile ?? null;
    // Resolve initial throttle profile from explicit setting (CDN not yet detected)
    let resolvedThrottle: ThrottleProfile = CdnDetector.resolveThrottleProfile(detectedCdn, explicitThrottleProfile);
    // After first probe the resolved throttle is updated; expose it to callers via detectedCdnProvider below.
    let cdnProviderApplied: string | null = null;

    // sameSiteDelayMs and delayJitterMs: env vars override the CDN-derived profile.
    const envSameSiteDelayMs = this.readDelaySetting('VITAL_SAME_SITE_DELAY_MS', -1);
    const envDelayJitterMs = this.readDelaySetting('VITAL_DELAY_JITTER_MS', -1);

    const getSameSiteDelayMs = () =>
      envSameSiteDelayMs >= 0 ? envSameSiteDelayMs : resolvedThrottle.sameSiteDelayMs;
    const getDelayJitterMs = () =>
      envDelayJitterMs >= 0 ? envDelayJitterMs : resolvedThrottle.jitterMs;

    const timeoutBackoffThreshold = this.readDelaySetting('VITAL_TIMEOUT_BACKOFF_THRESHOLD', this.DEFAULT_TIMEOUT_BACKOFF_THRESHOLD);
    const timeoutBackoffStepMs = this.readDelaySetting('VITAL_TIMEOUT_BACKOFF_STEP_MS', this.DEFAULT_TIMEOUT_BACKOFF_STEP_MS);
    const timeoutBackoffMaxMs = this.readDelaySetting('VITAL_TIMEOUT_BACKOFF_MAX_MS', this.DEFAULT_TIMEOUT_BACKOFF_MAX_MS);
    let previousHost: string | null = null;
    let consecutiveTimeouts = Math.max(0, options.initialTimeoutStreak ?? 0);
    // One BrowserContext per hostname so the HTTP cache is shared across pages of the same domain.
    // Contexts are created on first visit and closed together after all URLs are processed.
    const contextPool = new Map<string, BrowserContext>();

    if (!accessibilityOnly) {
      await LighthouseWorker.launchChrome();
    }

    try {
    for (const url of urlQueue) {
      const currentHost = this.safeHost(url);
      const sameHostAsPrevious = Boolean(previousHost && currentHost && previousHost === currentHost);
      const sameSiteDelayMs = sameHostAsPrevious ? getSameSiteDelayMs() : 0;
      const delayJitterMs = sameHostAsPrevious ? getDelayJitterMs() : 0;
      const timeoutBackoffMs = this.computeTimeoutBackoff(
        consecutiveTimeouts,
        timeoutBackoffThreshold,
        timeoutBackoffStepMs,
        timeoutBackoffMaxMs
      );
      const totalDelayMs = sameSiteDelayMs + timeoutBackoffMs;

      if (totalDelayMs > 0 || delayJitterMs > 0) {
        const jitterMs = delayJitterMs > 0 ? Math.floor(Math.random() * delayJitterMs) : 0;
        const effectiveDelayMs = totalDelayMs + jitterMs;
        const requestScopeSuffix = sameHostAsPrevious ? ' before next same-site request' : ' before next request';
        const timeoutSuffix = timeoutBackoffMs > 0
          ? ` (includes ${timeoutBackoffMs}ms timeout backoff after ${consecutiveTimeouts} consecutive timeout(s))`
          : '';
        const jitterSuffix = jitterMs > 0 ? ` + ${jitterMs}ms jitter` : '';
        console.log(`⏸️ Politeness pause for ${target.id}: waiting ${effectiveDelayMs}ms${requestScopeSuffix}${timeoutSuffix}${jitterSuffix}.`);
        await this.sleep(effectiveDelayMs);
      }

      previousHost = currentHost;
      const emulation = this.selectEmulationProfile(target.id, url);
      const probe = await this.probePageChange(url, pageState?.[url], effectiveMaxTimeoutMs, emulation.userAgent);

      // Update CDN detection and throttle profile from the first successful probe.
      if (probe.cdnDetection && cdnProviderApplied === null) {
        detectedCdn = probe.cdnDetection;
        resolvedThrottle = CdnDetector.resolveThrottleProfile(detectedCdn, explicitThrottleProfile);
        cdnProviderApplied = detectedCdn.provider;
        if (detectedCdn.provider) {
          console.log(
            `🌐 CDN detected for ${target.id}: ${detectedCdn.provider} ` +
              `(headers: ${detectedCdn.detectedHeaders.join(', ')}). ` +
              `Applying "${resolvedThrottle.label}" throttle profile ` +
              `(${resolvedThrottle.sameSiteDelayMs}ms base + ${resolvedThrottle.jitterMs}ms jitter).`
          );
        }
      }
      
      const baseReport: Partial<PageScanReport> = {
        url,
        timestamp: new Date().toISOString(),
        status: 'COMPLETED',
        errorMessage: null,
        pageTitle: null,
        scanContext: {
          browserFamily: emulation.family,
          viewportLabel: emulation.viewportLabel,
          viewport: {
            width: emulation.viewport.width,
            height: emulation.viewport.height
          },
          colorScheme: emulation.colorScheme
        },
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
        if (urlManifest) {
          UrlManifestStore.recordScanOutcome(urlManifest, url, 'SKIPPED_UNCHANGED', probe.contentHash, new Date().toISOString(), quarantineConfig);
        }

        reports.push(baseReport);
        continue;
      }

      // Non-HTML resources (PDFs, ZIPs, binaries) cannot be accessibility-scanned.
      if (probe.nonHtmlContentType) {
        baseReport.status = 'SKIPPED_NON_HTML';
        baseReport.errorMessage = `Non-HTML content (${probe.nonHtmlContentType}) is not scannable for accessibility.`;
        console.log(`⏭️ Skipping non-HTML resource (${probe.nonHtmlContentType}): ${url}`);

        if (pageState) {
          this.writePageState(pageState, url, probe, false, pageState[url]?.lastScannedAt || '');
        }

        reports.push(baseReport);
        continue;
      }

      // HTTP error pages (4xx/5xx) — record without launching the browser.
      if (probe.httpErrorStatus) {
        baseReport.status = 'NOT_FOUND';
        baseReport.errorMessage = `HTTP ${probe.httpErrorStatus} — the page is not accessible.`;
        console.log(`⚠️ Skipping HTTP ${probe.httpErrorStatus} page: ${url}`);

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

      let page: Page | null = null;
      const scannedAt = new Date().toISOString();

      try {
        // Defer browser launch until a URL actually needs scanning (all-unchanged batches
        // skip this entirely). Also reuse the context per hostname so the browser's HTTP
        // cache (JS bundles, CSS, fonts) is shared across pages of the same domain.
        // The user-agent is fixed at context-creation time; viewport and colorScheme are
        // applied per-page to preserve emulation variety.
        if (!browser) {
          console.log(`🚀 Launching headless browser (${engine}) for target: ${target.id}`);
          browser = await this.launchBrowser(engine);
        }
        const poolKey = currentHost ?? '__unknown__';
        let context = contextPool.get(poolKey);
        if (!context) {
          context = await browser.newContext({
            userAgent: emulation.userAgent,
            viewport: emulation.viewport,
            colorScheme: emulation.colorScheme
          });
          contextPool.set(poolKey, context);
        }
        page = await context.newPage();
        await page.setViewportSize(emulation.viewport);
        await page.emulateMedia({ colorScheme: emulation.colorScheme });
        page.setDefaultNavigationTimeout(effectiveMaxTimeoutMs);
        page.setDefaultTimeout(effectiveMaxTimeoutMs);
        const activePage = page;
        await this.runWithTimeout(async () => {
          // 1. Navigation with strict maxTimeoutMs boundary
          await activePage.goto(url, {
            waitUntil: navigationWaitUntil,
            timeout: effectiveMaxTimeoutMs
          });

          // 2. Hydration settle buffer (let client-side state finish mutating the DOM).
          // Accessibility-only runs can produce transient false positives when axe executes
          // immediately at domcontentloaded, so apply a short settle delay there too.
          if (accessibilityOnly && accessibilitySettleDelayMs > 0) {
            console.log(`⏱️ Applying accessibility settle buffer of ${accessibilitySettleDelayMs}ms before live audits...`);
            await activePage.waitForTimeout(accessibilitySettleDelayMs);
          } else if (!accessibilityOnly && settings.postLoadDelay > 0) {
            console.log(`⏱️ Applying load buffer of ${settings.postLoadDelay}ms for dynamic scripts...`);
            await activePage.waitForTimeout(settings.postLoadDelay);
          }

          // 3. Extract fully rendered HTML string state.
          // When probePageChange already issued a GET (non-SPA pages with no
          // cache-validation headers), reuse its response body to avoid an
          // extra activePage.content() IPC round-trip and redundant hash
          // computation.  Fall back to activePage.content() when unavailable.
          const hydratedHtml = probe.fetchedHtml ?? await activePage.content();
          const contentHash = probe.fetchedHtml ? probe.contentHash! : this.hashContent(hydratedHtml);
          const assetFingerprintHash = probe.fetchedHtml ? probe.assetFingerprintHash! : this.computeAssetFingerprint(hydratedHtml, url);

          // 4. Write snapshot to disk early so Alfa and Wappalyzer can read the local file
          //    instead of re-fetching the page over HTTP.
          const safeFilename = this.sanitizeUrlToFilename(url);
          const snapshotPath = path.join(this.SNAPSHOT_DIR, safeFilename);
          fs.writeFileSync(snapshotPath, hydratedHtml, 'utf8');
          console.log(`💾 Snapshot safely cached to disk: tmp/html-snapshots/${safeFilename}`);

          if (!accessibilityOnly) {
            // 5. Detect CMS/framework tooling footprint for page profile reporting.
            //    Pass the local snapshot so Wappalyzer reads from disk rather than HTTP.
            baseReport.technologyStack = await TechnologyWorker.detectTechnologyStack(url);

            // 6. Generate offline local analysis metrics from DOM snapshot
            baseReport.offlineAudits = OfflineWorker.processSnapshot(hydratedHtml);
          }

          // 7. Run Live browser evaluations in memory (Axe Core Automation)
          console.log(`🧪 Launching live accessibility evaluations for: ${url}`);
          baseReport.pageTitle = await activePage.title();
          baseReport.liveAudits = await LiveWorker.runLiveAudits(activePage);

          // 7b. Alfa — always runs alongside axe for independent ACT-rules cross-check.
          // Siteimprove Alfa and Deque axe use different rule sets; running both improves
          // issue coverage. Alfa audits the local HTML snapshot to avoid a redundant HTTP fetch.
          baseReport.alfaAudits = await AlfaWorker.runAlfaAudits(url, undefined, undefined, snapshotPath);

          // 7c. Merge alfa violations into liveAudits so the dashboard and reports can
          // show and filter findings by source engine (axe vs alfa).
          if (baseReport.liveAudits && baseReport.alfaAudits) {
            const alfaViolations = AlfaWorker.toA11yViolations(baseReport.alfaAudits);
            baseReport.liveAudits.accessibilityViolations = [
              ...baseReport.liveAudits.accessibilityViolations,
              ...alfaViolations
            ];
          }

          if (!accessibilityOnly) {
            // 8. Compare impact of suspicious third-party scripts by re-auditing with JavaScript disabled
            if (baseReport.offlineAudits) {
              baseReport.thirdPartyImpact = await ThirdPartyImpactWorker.evaluate({
                browser: browser!,
                url,
                maxTimeoutMs: effectiveMaxTimeoutMs,
                postLoadDelay: settings.postLoadDelay,
                htmlSnapshot: hydratedHtml,
                technologyStack: baseReport.technologyStack || [],
                offlineAudits: baseReport.offlineAudits,
                baselineLiveAudits: baseReport.liveAudits
              });
            }
          }

          // 9. Run Lighthouse performance audit against the live URL.
          if (!accessibilityOnly) {
            const lighthouse = await LighthouseWorker.auditLiveUrl(url, effectiveMaxTimeoutMs);
            if (baseReport.liveAudits) {
              baseReport.liveAudits.lighthouse = lighthouse;
            }
          }

          baseReport.status = 'COMPLETED';
          consecutiveTimeouts = 0;

          if (pageState) {
            this.writePageState(pageState, url, { ...probe, contentHash, assetFingerprintHash }, true, scannedAt);
          }
          if (urlManifest) {
            UrlManifestStore.recordScanOutcome(urlManifest, url, 'COMPLETED', contentHash, scannedAt, quarantineConfig);
          }
        }, effectiveMaxTimeoutMs);

      } catch (error: any) {
        baseReport.status = 'FAILED';
        
        if (this.isTimeoutError(error)) {
          baseReport.status = 'TIMEOUT';
          baseReport.errorMessage = `Page scan exceeded strict ${effectiveMaxTimeoutMs / 1000}s limit and was cancelled.`;
          consecutiveTimeouts += 1;
        } else {
          baseReport.errorMessage = error.message;
          consecutiveTimeouts = 0;
        }

        console.warn(`⚠️ Skipping assessment loop for ${url}: ${baseReport.errorMessage}`);

        if (pageState) {
          this.writePageState(pageState, url, probe, false, scannedAt);
        }
        if (urlManifest) {
          const manifestStatus = baseReport.status as 'TIMEOUT' | 'FAILED';
          UrlManifestStore.recordScanOutcome(urlManifest, url, manifestStatus, null, scannedAt, quarantineConfig);
          const entry = urlManifest[url];
          if (entry?.cooldownUntil) {
            console.warn(
              `🚫 URL quarantined after ${entry.consecutiveFailures} consecutive failure(s): ${url} ` +
                `(cooldown until ${entry.cooldownUntil})`
            );
          }
        }
      } finally {
        if (page) {
          // Guard against page.close() hanging when a long-running page.evaluate() (e.g.
          // from axe-core) is still in-flight inside Chrome after runWithTimeout fires.
          // Without this deadline the scan loop stalls until the 58-minute job limit kills it.
          await this.closeWithDeadline(page.close.bind(page), 10_000, `page.close for ${url}`);
        }
        // Context is kept alive in the pool for reuse by the next same-domain page.
        if (baseReport.status === 'SKIPPED_UNCHANGED' || baseReport.status === 'COMPLETED') {
          consecutiveTimeouts = 0;
        }
        reports.push(baseReport);
      }
    }
    } finally {
      
      await LighthouseWorker.killChrome();
      // Close all pooled contexts before shutting down the browser.
      await Promise.all(
        Array.from(contextPool.values()).map(ctx =>
          this.closeWithDeadline(ctx.close.bind(ctx), 10_000, 'context.close').catch(() => {})
        )
      );
      
      if (browser) {
        await this.closeWithDeadline(browser.close.bind(browser), 10_000, `browser.close for ${target.id}`);
        console.log(`🏁 Browser session terminated for ${target.id}. Total Snapshots generated: ${reports.filter(r => r.status === 'COMPLETED').length}`);
      } else {
        console.log(`⚡ Scan session completed for ${target.id} without launching a browser (all pages unchanged). Total Snapshots generated: 0`);
      }
    }
    return { reports, cdnProvider: cdnProviderApplied };
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
    maxTimeoutMs: number,
    userAgent?: string
  ): Promise<PageProbeResult> {
    const timeoutMs = Math.min(maxTimeoutMs, 15000);

    try {
      const headResponse = await this.fetchWithTimeout(url, { method: 'HEAD' }, timeoutMs, userAgent);

      // Detect non-ok HTTP status (e.g. 404, 410, 503) and surface it so the
      // scan loop can skip browser navigation for unreachable pages.
      // Exception: 403 is treated as inconclusive — CDNs commonly block lightweight
      // probes while still serving pages to real browsers.  Return a "proceed"
      // result so the scan loop falls through to full browser navigation.
      if (!headResponse.ok) {
        if (headResponse.status === 403) {
          return {
            unchanged: false,
            reason: 'HTTP 403 probe — CDN may be blocking lightweight requests; will attempt browser navigation.',
            httpErrorStatus: null,
            nonHtmlContentType: null,
            etag: null,
            lastModified: null,
            contentHash: previousState?.contentHash ?? null,
            assetFingerprintHash: previousState?.assetFingerprintHash ?? null,
            fetchedHtml: null
          };
        }

        return {
          unchanged: false,
          reason: `HTTP ${headResponse.status} response from server.`,
          httpErrorStatus: headResponse.status,
          nonHtmlContentType: null,
          etag: null,
          lastModified: null,
          contentHash: previousState?.contentHash ?? null,
          assetFingerprintHash: previousState?.assetFingerprintHash ?? null,
          fetchedHtml: null
        };
      }

      // Detect non-HTML content (PDFs, ZIPs, binaries, etc.) so the scan loop
      // can skip accessibility scanning, which is only meaningful for HTML pages.
      const rawContentType = headResponse.headers.get('content-type') ?? '';
      const baseContentType = rawContentType.split(';')[0].trim().toLowerCase();
      if (baseContentType && !baseContentType.includes('html')) {
        return {
          unchanged: false,
          reason: `Non-HTML content type detected: ${baseContentType}`,
          httpErrorStatus: null,
          nonHtmlContentType: baseContentType,
          etag: null,
          lastModified: null,
          contentHash: null,
          assetFingerprintHash: null,
          fetchedHtml: null
        };
      }

      const etag = headResponse.headers.get('etag');
      const lastModified = headResponse.headers.get('last-modified');

      // Capture all response headers for CDN fingerprinting.
      const responseHeaderMap: Record<string, string> = {};
      headResponse.headers.forEach((value, key) => {
        responseHeaderMap[key] = value;
      });
      const cdnDetection = CdnDetector.detect(responseHeaderMap);

      if (previousState) {
        if (etag && previousState.etag && etag === previousState.etag) {
          return {
            unchanged: true,
            reason: 'Skipped unchanged page based on matching ETag.',
            httpErrorStatus: null,
            nonHtmlContentType: null,
            etag,
            lastModified,
            contentHash: previousState.contentHash,
            assetFingerprintHash: previousState.assetFingerprintHash,
            fetchedHtml: null,
            cdnDetection
          };
        }

        if (lastModified && previousState.lastModified && lastModified === previousState.lastModified) {
          return {
            unchanged: true,
            reason: 'Skipped unchanged page based on matching Last-Modified header.',
            httpErrorStatus: null,
            nonHtmlContentType: null,
            etag,
            lastModified,
            contentHash: previousState.contentHash,
            assetFingerprintHash: previousState.assetFingerprintHash,
            fetchedHtml: null,
            cdnDetection
          };
        }
      }

      if (!etag && !lastModified && previousState?.contentHash) {
        try {
          const getResponse = await this.fetchWithTimeout(url, { method: 'GET' }, timeoutMs, userAgent);
          if (!getResponse.ok) {
            throw new Error(`GET probe returned ${getResponse.status}`);
          }
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
              httpErrorStatus: null,
              nonHtmlContentType: null,
              etag,
              lastModified,
              contentHash,
              assetFingerprintHash,
              fetchedHtml: null,
              cdnDetection
            };
          }

          // Page has changed: carry the GET response body forward so the scan
          // loop can reuse it instead of re-fetching via the browser.
          return {
            unchanged: false,
            reason: 'Page changed based on HTML + asset fingerprint hash comparison.',
            httpErrorStatus: null,
            nonHtmlContentType: null,
            etag,
            lastModified,
            contentHash,
            assetFingerprintHash,
            fetchedHtml: html,
            cdnDetection
          };
        } catch {
          // Fall through to changed=true when lightweight fetch fails.
        }
      }

      return {
        unchanged: false,
        reason: 'Page appears changed or no prior state available.',
        httpErrorStatus: null,
        nonHtmlContentType: null,
        etag,
        lastModified,
        contentHash: previousState?.contentHash ?? null,
        assetFingerprintHash: previousState?.assetFingerprintHash ?? null,
        fetchedHtml: null,
        cdnDetection
      };
    } catch {
      return {
        unchanged: false,
        reason: 'Change probe failed; scanning page to avoid missing updates.',
        httpErrorStatus: null,
        nonHtmlContentType: null,
        etag: previousState?.etag ?? null,
        lastModified: previousState?.lastModified ?? null,
        contentHash: previousState?.contentHash ?? null,
        assetFingerprintHash: previousState?.assetFingerprintHash ?? null,
        fetchedHtml: null
      };
    }
  }

  private static async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, userAgent?: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': userAgent ?? 'VitalCore/1.0 (+https://github.com/mgifford/vital-core)'
        }
      });

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

    // Hold a reference to the operation promise so we can attach a no-op
    // rejection handler when the timeout fires first, preventing any late
    // rejection from operationPromise itself becoming an unhandled rejection.
    //
    // Note: this does NOT cover rejections from Promises that are internal to
    // the operation but not part of its returned Promise chain (e.g. Lighthouse
    // calls checkForQuiet via a fire-and-forget setTimeout pattern).  Those
    // are suppressed by the global unhandledRejection handler in src/index.ts.
    const operationPromise = operation();

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
      return await Promise.race([operationPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      // Suppress any rejection from operationPromise itself that arrives after
      // the timeout already fired.  This is safe: if operationPromise won the
      // race we already returned its value (or re-threw its error) above, so
      // attaching an extra handler here is a no-op from the caller's perspective.
      operationPromise.catch(() => {});
    }
  }

  /**
   * Calls `closeFn()` and resolves once it completes or the deadline elapses — whichever
   * comes first.  Errors from `closeFn` are silently swallowed so that a stalled
   * Playwright close operation (e.g. page.close() blocked on a long-running
   * page.evaluate() from axe-core) can never prevent the session from continuing.
   */
  private static async closeWithDeadline(closeFn: () => Promise<void>, deadlineMs: number, label: string): Promise<void> {
    const deadline = new Promise<void>(resolve => setTimeout(resolve, deadlineMs));
    const closeOp = closeFn().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️ ${label} rejected: ${msg}`);
    });
    await Promise.race([closeOp, deadline]);
  }

  private static isTimeoutError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const candidate = error as { name?: unknown; message?: unknown };
    const name = typeof candidate.name === 'string' ? candidate.name : '';
    const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : '';
    return name === 'TimeoutError' || message.includes('timeout');
  }

  private static computeTimeoutBackoff(
    consecutiveTimeouts: number,
    threshold: number,
    stepMs: number,
    maxMs: number
  ): number {
    if (consecutiveTimeouts < threshold) {
      return 0;
    }

    const multiplier = consecutiveTimeouts - threshold + 1;
    return Math.min(multiplier * stepMs, maxMs);
  }

  private static readDelaySetting(envName: string, fallback: number): number {
    const raw = process.env[envName];
    if (!raw) {
      return fallback;
    }

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return fallback;
    }

    return parsed;
  }

  private static safeHost(url: string): string | null {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  private static async sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
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
