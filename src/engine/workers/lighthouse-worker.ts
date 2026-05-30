import { pathToFileURL } from 'url';

interface LighthouseSummary {
  performanceScore: number | null;
  energyEstimateKwh: number | null;
  firstContentfulPaintMs: number | null;
  largestContentfulPaintMs: number | null;
  speedIndexMs: number | null;
}

export class LighthouseWorker {
  public static async auditCachedSnapshot(snapshotPath: string, maxTimeoutMs: number): Promise<LighthouseSummary> {
    let chrome: { port: number; kill: () => Promise<void> | void } | null = null;

    try {
      const lighthouseModule = await import('lighthouse');
      const chromeLauncherModule = await import('chrome-launcher');

      const lighthouse = lighthouseModule.default;
      const launch = chromeLauncherModule.launch;

      chrome = await launch({
        chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox']
      });

      const targetUrl = pathToFileURL(snapshotPath).href;
      const result = await lighthouse(targetUrl, {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance'],
        maxWaitForLoad: Math.max(5000, Math.min(maxTimeoutMs, 60000))
      });

      const score = result?.lhr?.categories?.performance?.score;
      const normalizedScore = typeof score === 'number' ? Math.round(score * 100) : null;
      const firstContentfulPaintMs = this.readAuditMetric(result?.lhr?.audits?.['first-contentful-paint']?.numericValue);
      const largestContentfulPaintMs = this.readAuditMetric(result?.lhr?.audits?.['largest-contentful-paint']?.numericValue);
      const speedIndexMs = this.readAuditMetric(result?.lhr?.audits?.['speed-index']?.numericValue);

      return {
        performanceScore: normalizedScore,
        energyEstimateKwh: null,
        firstContentfulPaintMs,
        largestContentfulPaintMs,
        speedIndexMs
      };
    } catch (error: any) {
      const message = error?.message ? String(error.message) : 'Unknown Lighthouse execution error.';
      console.warn(`⚠️ Lighthouse audit failed for cached snapshot ${snapshotPath}: ${message}`);
      return {
        performanceScore: null,
        energyEstimateKwh: null,
        firstContentfulPaintMs: null,
        largestContentfulPaintMs: null,
        speedIndexMs: null
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