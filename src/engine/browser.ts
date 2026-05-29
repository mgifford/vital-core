import * as fs from 'fs';
import * as path from 'path';
import { chromium, Browser, Page } from 'playwright';
import { TargetConfig } from '../types/profile';
import { PageScanReport } from '../types/site-quality-spec';

export class ResilientBrowserEngine {
  private static SNAPSHOT_DIR = path.resolve(process.cwd(), 'tmp/html-snapshots');

  /**
   * Orchestrates the browser session lifecycle to scrape target pages and generate snapshots.
   */
  public static async executeSnapshotSession(
    target: TargetConfig,
    urlQueue: string[]
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

    for (const url of urlQueue) {
      console.log(`🌐 Navigating to: ${url}`);
      const page: Page = await context.newPage();
      
      const baseReport: Partial<PageScanReport> = {
        url,
        timestamp: new Date().toISOString(),
        status: 'COMPLETED',
        errorMessage: null,
        technologyStack: [],
        liveAudits: null,
        offlineAudits: null
      };

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

        // 4. Clean URL into a cross-platform safe filename
        const safeFilename = this.sanitizeUrlToFilename(url);
        const snapshotPath = path.join(this.SNAPSHOT_DIR, safeFilename);

        fs.writeFileSync(snapshotPath, hydratedHtml, 'utf8');
        console.log(`💾 Snapshot safely cached to disk: tmp/html-snapshots/${safeFilename}`);

        // Track live performance/accessibility audit anchors here if needed in Phase 4
        baseReport.status = 'COMPLETED';

      } catch (error: any) {
        baseReport.status = 'FAILED';
        
        if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
          baseReport.status = 'TIMEOUT';
          baseReport.errorMessage = `Page execution exceeded strict ${settings.maxTimeoutMs / 1000}s limit.`;
        } else {
          baseReport.errorMessage = error.message;
        }

        console.warn(`⚠️ Skipping assessment loop for ${url}: ${baseReport.errorMessage}`);
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
}
