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

export class LighthouseWorker {
  public static async auditLiveUrl(url: string, maxTimeoutMs: number): Promise<LighthouseSummary> {
    let chrome: { port: number; kill: () => Promise<void> | void } | null = null;

    try {
      const lighthouseModule = await import('lighthouse');
      const chromeLauncherModule = await import('chrome-launcher');

      const lighthouse = lighthouseModule.default;
      const launch = chromeLauncherModule.launch;

      chrome = await launch({
        chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox']
      });

      const result = await lighthouse(url, {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo', 'agentic-browsing'],
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
      if (chrome) {
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
}