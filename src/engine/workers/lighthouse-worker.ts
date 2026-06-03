interface LighthouseSummary {
  performanceScore: number | null;
  energyEstimateKwh: number | null;
  firstContentfulPaintMs: number | null;
  largestContentfulPaintMs: number | null;
  speedIndexMs: number | null;
  accessibilityScore: number | null;
  seoScore: number | null;
  bestPracticesScore: number | null;
  /** Experimental: agentic browsing pass ratio 0–100, or null when unavailable. */
  agenticScore: number | null;
}

type ChromeHandle = { port: number; kill: () => Promise<void> | void };

export class LighthouseWorker {
  private static persistentChrome: ChromeHandle | null = null;
  private static readonly primaryCategories = ['performance', 'accessibility', 'best-practices', 'seo', 'agentic-browsing'];
  private static readonly stableCategories = ['performance', 'accessibility', 'best-practices', 'seo'];

  /**
   * Launches a single shared Chrome instance to be reused across multiple
   * Lighthouse audits. Call once before auditing a batch of pages and pair
   * with {@link killChrome} when the batch is complete.
   *
   * If a previously-launched instance is cached but no longer responsive
   * (e.g. it crashed between scan cycles), the stale handle is discarded and
   * a fresh Chrome process is started.
   */
  public static async launchChrome(): Promise<void> {
    if (this.persistentChrome) {
      if (await this.isChromeAlive(this.persistentChrome.port)) {
        return;
      }
      console.warn(
        `⚠️ Persistent Chrome on port ${this.persistentChrome.port} is unresponsive. Discarding stale handle and relaunching...`
      );
      this.persistentChrome = null;
    }

    try {
      const chromeLauncherModule = await import('chrome-launcher');
      this.persistentChrome = await chromeLauncherModule.launch({
        chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox']
      });
      console.log(`🌐 Persistent Lighthouse Chrome launched on port ${this.persistentChrome.port}`);
    } catch (error: any) {
      const message = error?.message ? String(error.message) : 'Unknown error';
      console.warn(`⚠️ Failed to launch persistent Lighthouse Chrome: ${message}`);
    }
  }

  /**
   * Probes whether the Chrome DevTools endpoint on the given port is still
   * accepting connections.  Returns true when Chrome responds within 2 s.
   */
  private static async isChromeAlive(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(2000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Kills the shared Chrome instance previously started by {@link launchChrome}.
   */
  public static async killChrome(): Promise<void> {
    if (!this.persistentChrome) {
      return;
    }

    try {
      await this.persistentChrome.kill();
      console.log('🛑 Persistent Lighthouse Chrome terminated.');
    } catch (error: any) {
      const message = error?.message ? String(error.message) : 'Unknown error';
      console.warn(`⚠️ Error while killing persistent Lighthouse Chrome: ${message}`);
    } finally {
      this.persistentChrome = null;
    }
  }

  public static async auditLiveUrl(url: string, maxTimeoutMs: number): Promise<LighthouseSummary> {
    // Use the persistent Chrome instance when available; otherwise launch a
    // temporary one so that standalone / test calls still work correctly.
    const usingPersistent = this.persistentChrome !== null;
    let chrome: ChromeHandle | null = usingPersistent ? this.persistentChrome : null;

    try {
      const lighthouseModule = await import('lighthouse');
      const lighthouse = lighthouseModule.default;

      if (!usingPersistent) {
        const chromeLauncherModule = await import('chrome-launcher');
        chrome = await chromeLauncherModule.launch({
          chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox']
        });
      }

      const result = await lighthouse(url, {
        port: chrome!.port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: this.primaryCategories,
        maxWaitForLoad: Math.max(5000, Math.min(maxTimeoutMs, 60000))
      });

      const cats = result?.lhr?.categories;
      const normalizeScore = (raw: unknown): number | null =>
        typeof raw === 'number' ? Math.round(raw * 100) : null;

      const performanceScore = normalizeScore(cats?.['performance']?.score);
      const accessibilityScore = normalizeScore(cats?.['accessibility']?.score);
      const seoScore = normalizeScore(cats?.['seo']?.score);
      const bestPracticesScore = normalizeScore(cats?.['best-practices']?.score);
      // agentic-browsing is experimental; score is a pass ratio (0–1) or null
      const agenticScore = normalizeScore(cats?.['agentic-browsing']?.score);

      const firstContentfulPaintMs = this.readAuditMetric(result?.lhr?.audits?.['first-contentful-paint']?.numericValue);
      const largestContentfulPaintMs = this.readAuditMetric(result?.lhr?.audits?.['largest-contentful-paint']?.numericValue);
      const speedIndexMs = this.readAuditMetric(result?.lhr?.audits?.['speed-index']?.numericValue);

      return {
        performanceScore,
        energyEstimateKwh: null,
        firstContentfulPaintMs,
        largestContentfulPaintMs,
        speedIndexMs,
        accessibilityScore,
        seoScore,
        bestPracticesScore,
        agenticScore
      };
    } catch (error: any) {
      const message = error?.message ? String(error.message) : 'Unknown Lighthouse execution error.';

      if (this.shouldRetryLighthouseAudit(message)) {
        console.warn(`⚠️ Lighthouse audit hit a trace-engine timing bug for ${url}. Retrying once with a fresh Chrome...`);

        try {
          if (chrome && !usingPersistent) {
            await chrome.kill();
          }

          const chromeLauncherModule = await import('chrome-launcher');
          const retryChrome = await chromeLauncherModule.launch({
            chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox']
          });

          try {
            const lighthouseModule = await import('lighthouse');
            const lighthouse = lighthouseModule.default;
            const retryResult = await lighthouse(url, {
              port: retryChrome.port,
              output: 'json',
              logLevel: 'error',
              onlyCategories: this.stableCategories,
              maxWaitForLoad: Math.max(5000, Math.min(maxTimeoutMs, 60000))
            });

            const cats = retryResult?.lhr?.categories;
            const normalizeScore = (raw: unknown): number | null =>
              typeof raw === 'number' ? Math.round(raw * 100) : null;

            return {
              performanceScore: normalizeScore(cats?.['performance']?.score),
              energyEstimateKwh: null,
              firstContentfulPaintMs: this.readAuditMetric(retryResult?.lhr?.audits?.['first-contentful-paint']?.numericValue),
              largestContentfulPaintMs: this.readAuditMetric(retryResult?.lhr?.audits?.['largest-contentful-paint']?.numericValue),
              speedIndexMs: this.readAuditMetric(retryResult?.lhr?.audits?.['speed-index']?.numericValue),
              accessibilityScore: normalizeScore(cats?.['accessibility']?.score),
              seoScore: normalizeScore(cats?.['seo']?.score),
              bestPracticesScore: normalizeScore(cats?.['best-practices']?.score),
              agenticScore: null
            };
          } finally {
            await retryChrome.kill();
          }
        } catch (retryError: any) {
          const retryMessage = retryError?.message ? String(retryError.message) : 'Unknown Lighthouse execution error.';
          console.warn(`⚠️ Lighthouse retry also failed for ${url}: ${retryMessage}`);
        }
      }

      console.warn(`⚠️ Lighthouse audit failed for ${url}: ${message}`);
      return {
        performanceScore: null,
        energyEstimateKwh: null,
        firstContentfulPaintMs: null,
        largestContentfulPaintMs: null,
        speedIndexMs: null,
        accessibilityScore: null,
        seoScore: null,
        bestPracticesScore: null,
        agenticScore: null
      };
    } finally {
      // Only kill Chrome when we launched a temporary instance for this call.
      if (!usingPersistent && chrome) {
        await chrome.kill();
      }
    }
  }

  private static readAuditMetric(value: unknown): number | null {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return null;
    }

    return Math.round(value);
  }

  private static shouldRetryLighthouseAudit(message: string): boolean {
    return /TraceEngineResult|performance mark|mark has not been set/i.test(message);
  }
}