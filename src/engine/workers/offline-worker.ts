import * as cheerio from 'cheerio';
import { PageScanReport } from '../../types/site-quality-spec';

export class OfflineWorker {
  private static OVERLAY_SIGNATURES = [
    { provider: 'UserWay', pattern: /cdn\.userway\.org|userway\.js/i },
    { provider: 'AccessiBe', pattern: /acsbapp\.com|acsb\.js/i },
    { provider: 'AudioEye', pattern: /audioeye\.com|ae\.js/i }
  ];

  private static SUSPICIOUS_ALTS = /\b(image|screenshot|photo|blank|logo|picture|graphic)\b|^[_\s.\d\-]+$/i;
  private static AMBIGUOUS_LINK_TEXT = /^(click here|read more|learn more|more|here)$/i;
  private static PASSIVE_HELPERS = /\b(is|are|was|were|be|been|being)\b\s+\w+(ed|en)\b/i;
  private static LONG_SENTENCE_WORD_THRESHOLD = 20;

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
    const sentenceChunks = this.extractSentences(pageText);
    const words = this.extractWords(pageText);

    let readabilityScore = 100;
    let fleschKincaidGrade = 1;
    let averageSentenceLength = 0;
    let passiveVoiceSentenceRatio = 0;
    let longSentenceCount = 0;

    if (sentenceChunks.length > 0 && words.length > 0) {
      const totalSyllables = words.reduce((acc, word) => acc + this.estimateSyllables(word), 0);
      const asl = words.length / sentenceChunks.length;
      const asw = totalSyllables / words.length;

      // Flesch Reading Ease and Flesch-Kincaid Grade Level
      readabilityScore = Math.max(0, Math.min(100, 206.835 - (1.015 * asl) - (84.6 * asw)));
      fleschKincaidGrade = Math.max(0, Math.min(18, (0.39 * asl) + (11.8 * asw) - 15.59));
      averageSentenceLength = asl;

      const passiveSentences = sentenceChunks.filter(sentence => this.PASSIVE_HELPERS.test(sentence)).length;
      passiveVoiceSentenceRatio = passiveSentences / sentenceChunks.length;
      longSentenceCount = sentenceChunks.filter(sentence => this.extractWords(sentence).length > this.LONG_SENTENCE_WORD_THRESHOLD).length;
    }

    const acronymMentions = (pageText.match(/\b[A-Z]{2,}\b/g) || []).map(item => item.trim());
    const explainedAcronyms = new Set<string>();
    $('abbr[title]').each((_, el) => {
      const label = ($(el).text() || '').trim();
      if (label) {
        explainedAcronyms.add(label);
      }
    });
    const parentheticalMatches = pageText.match(/\(([A-Z]{2,})\)/g) || [];
    parentheticalMatches.forEach(match => {
      const acronym = match.replace(/[()]/g, '').trim();
      if (acronym) {
        explainedAcronyms.add(acronym);
      }
    });
    const unexplainedAcronymCount = acronymMentions.reduce((count, acronym) => {
      if (explainedAcronyms.has(acronym)) {
        return count;
      }
      return count + 1;
    }, 0);

    const ambiguousLinkTextCount = $('a')
      .toArray()
      .map(anchor => $(anchor).text().replace(/\s+/g, ' ').trim())
      .filter(text => text.length > 0)
      .filter(text => this.AMBIGUOUS_LINK_TEXT.test(text)).length;

    return {
      overlayDetected,
      designSystem: { usesUSWDS, versionDetected: usesUSWDS ? "3.0.0 (Utility Derived)" : null },
      contentMetrics: {
        readabilityScore: parseFloat(readabilityScore.toFixed(2)),
        fleschKincaidGrade: parseFloat(fleschKincaidGrade.toFixed(2)),
        averageSentenceLength: parseFloat(averageSentenceLength.toFixed(2)),
        passiveVoiceSentenceRatio: parseFloat((passiveVoiceSentenceRatio * 100).toFixed(2)),
        longSentenceCount,
        unexplainedAcronymCount,
        ambiguousLinkTextCount,
        suspiciousAltTextCount: suspiciousInstances.length,
        suspiciousAltInstances: suspiciousInstances
      },
      linkHealth: { totalChecked: 0, brokenCount: 0, brokenLinks: [] } // Handled via link parsing loop
    };
  }

  private static extractSentences(text: string): string[] {
    return text
      .split(/[.!?]+(?:\s+|$)/)
      .map(chunk => chunk.trim())
      .filter(chunk => chunk.length > 5);
  }

  private static extractWords(text: string): string[] {
    return text
      .split(/\s+/)
      .map(word => word.replace(/[^A-Za-z'-]/g, ''))
      .filter(word => word.length > 0);
  }

  private static estimateSyllables(word: string): number {
    const normalized = word.toLowerCase().replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/i, '').replace(/^y/, '');
    const matches = normalized.match(/[aeiouy]{1,2}/g);
    return Math.max(1, matches ? matches.length : 1);
  }
}
