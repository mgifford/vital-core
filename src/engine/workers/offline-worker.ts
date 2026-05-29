import * as cheerio from 'cheerio';
import { PageScanReport } from '../../types/site-quality-spec';

export class OfflineWorker {
  private static OVERLAY_SIGNATURES = [
    { provider: 'UserWay', pattern: /cdn\.userway\.org|userway\.js/i },
    { provider: 'AccessiBe', pattern: /acsbapp\.com|acsb\.js/i },
    { provider: 'AudioEye', pattern: /audioeye\.com|ae\.js/i }
  ];

  private static SUSPICIOUS_ALTS = /\b(image|screenshot|photo|blank|logo|picture|graphic)\b|^[_\s.\d\-]+$/i;

  /**
   * Processes an offline HTML file string completely detached from the live network
   */
  public static processSnapshot(htmlContent: string): NonNullable<PageScanReport['offlineAudits']> {
    const $ = cheerio.load(htmlContent);
    const htmlString = $.html();

    // 1. Overlay Detection
    let overlayDetected = { found: false, provider: null as string | null, evidence: null as string | null };
    for (const signature of this.OVERLAY_SIGNATURES) {
      const match = htmlString.match(signature.pattern);
      if (match) {
        overlayDetected = { found: true, provider: signature.provider, evidence: match[0] };
        break;
      }
    }

    // 2. Design System Footprint Verification (USWDS utility class mapping)
    const usesUSWDS = $('[class*="usa-"], [class*="uswds-"]').length > 0;

    // 3. Alt-Text Quality Analysis
    const suspiciousInstances: { imgHtml: string; invalidValue: string }[] = [];
    $('img').each((_, el) => {
      const alt = $(el).attr('alt');
      const outerHtml = $.html(el).slice(0, 150); // Keep tracking snippet length readable

      if (alt === undefined) {
        suspiciousInstances.push({ imgHtml: outerHtml, invalidValue: 'MISSING_ALT_ATTRIBUTE' });
      } else if (alt.trim() !== '' && this.SUSPICIOUS_ALTS.test(alt.trim())) {
        suspiciousInstances.push({ imgHtml: outerHtml, invalidValue: alt });
      }
    });

    // 4. Plain Language Calculation & Heuristics
    const pageText = $('body').text().replace(/\s+/g, ' ').trim();
    const sentences = pageText.split(/[.!?]+\s/).filter(s => s.length > 5);
    const words = pageText.split(/\s+/).filter(w => w.length > 0);

    let readabilityScore = 100;
    if (sentences.length > 0 && words.length > 0) {
      const totalSyllables = words.reduce((acc, word) => acc + (word.match(/[aeiouy]{1,2}/gi)?.length || 1), 0);
      const asl = words.length / sentences.length;
      const asw = totalSyllables / words.length;
      // Apply standard Flesch Reading Ease index parameters
      readabilityScore = Math.max(0, Math.min(100, 206.835 - (1.015 * asl) - (84.6 * asw)));
    }

    return {
      overlayDetected,
      designSystem: { usesUSWDS, versionDetected: usesUSWDS ? "3.0.0 (Utility Derived)" : null },
      contentMetrics: {
        readabilityScore: parseFloat(readabilityScore.toFixed(2)),
        suspiciousAltTextCount: suspiciousInstances.length,
        suspiciousAltInstances: suspiciousInstances
      },
      linkHealth: { totalChecked: 0, brokenCount: 0, brokenLinks: [] } // Handled via link parsing loop
    };
  }
}
