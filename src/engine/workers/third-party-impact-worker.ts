import { Browser } from 'playwright';
import { PageScanReport } from '../../types/site-quality-spec';
import { LiveWorker } from './live-worker';

type TechEntry = PageScanReport['technologyStack'][number];
type OfflineEntry = NonNullable<PageScanReport['offlineAudits']>;
type LiveEntry = NonNullable<PageScanReport['liveAudits']>;
type ThirdPartyImpact = NonNullable<PageScanReport['thirdPartyImpact']>;

interface EvaluationOptions {
  browser: Browser;
  url: string;
  maxTimeoutMs: number;
  postLoadDelay: number;
  htmlSnapshot: string;
  technologyStack: TechEntry[];
  offlineAudits: OfflineEntry;
  baselineLiveAudits: LiveEntry | null;
}

export class ThirdPartyImpactWorker {
  private static readonly HIGH_RISK_TECH_CATEGORY_MATCHERS = [
    /tag manager/i,
    /analytics/i,
    /advertising/i,
    /ab testing/i,
    /live chat/i,
    /marketing/i,
    /widget/i,
    /consent/i
  ];

  private static readonly HTML_SIGNATURE_MATCHERS: Array<{ reason: string; pattern: RegExp }> = [
    { reason: 'Tag manager present', pattern: /googletagmanager\.com|gtm\.js/i },
    { reason: 'Third-party chat widget present', pattern: /intercom|drift\.com|zendesk|livechat/i },
    { reason: 'Third-party accessibility widget present', pattern: /userway|accessibe|audioeye/i },
    { reason: 'Third-party iframe embeds present', pattern: /<iframe[^>]+src=["']https?:\/\//i }
  ];

  public static findTriggerReasons(
    htmlSnapshot: string,
    technologyStack: TechEntry[],
    offlineAudits: OfflineEntry
  ): string[] {
    const reasons = new Set<string>();

    for (const tech of technologyStack) {
      for (const matcher of this.HIGH_RISK_TECH_CATEGORY_MATCHERS) {
        if (matcher.test(tech.category)) {
          reasons.add(`High-risk technology category detected: ${tech.category} (${tech.name})`);
        }
      }
    }

    for (const signature of this.HTML_SIGNATURE_MATCHERS) {
      if (signature.pattern.test(htmlSnapshot)) {
        reasons.add(signature.reason);
      }
    }

    if (offlineAudits.overlayDetected.found) {
      reasons.add(`Accessibility overlay detected: ${offlineAudits.overlayDetected.provider}`);
    }

    return Array.from(reasons);
  }

  public static async evaluate(options: EvaluationOptions): Promise<ThirdPartyImpact> {
    const triggerReasons = this.findTriggerReasons(options.htmlSnapshot, options.technologyStack, options.offlineAudits);
    const baselineViolations = options.baselineLiveAudits?.accessibilityViolations ?? [];

    if (triggerReasons.length === 0) {
      return {
        evaluated: false,
        triggeredBy: [],
        regressionDetected: false,
        baselineViolationCount: baselineViolations.length,
        jsDisabledViolationCount: baselineViolations.length,
        addedByJavaScriptCount: 0,
        removedByJavaScriptCount: 0,
        highRiskRules: []
      };
    }

    const jsDisabledViolations = await this.scanWithJavaScriptDisabled(
      options.browser,
      options.url,
      options.maxTimeoutMs,
      options.postLoadDelay
    );

    const baselineRuleIds = new Set(baselineViolations.map(v => v.id));
    const jsDisabledRuleIds = new Set(jsDisabledViolations.map(v => v.id));

    const addedByJs = Array.from(baselineRuleIds).filter(id => !jsDisabledRuleIds.has(id));
    const removedByJs = Array.from(jsDisabledRuleIds).filter(id => !baselineRuleIds.has(id));

    return {
      evaluated: true,
      triggeredBy: triggerReasons,
      regressionDetected: addedByJs.length > 0,
      baselineViolationCount: baselineViolations.length,
      jsDisabledViolationCount: jsDisabledViolations.length,
      addedByJavaScriptCount: addedByJs.length,
      removedByJavaScriptCount: removedByJs.length,
      highRiskRules: addedByJs
    };
  }

  private static async scanWithJavaScriptDisabled(
    browser: Browser,
    url: string,
    maxTimeoutMs: number,
    postLoadDelay: number
  ) {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: maxTimeoutMs
      });

      if (postLoadDelay > 0) {
        await page.waitForTimeout(Math.min(postLoadDelay, 1500));
      }

      const liveAudits = await LiveWorker.runLiveAudits(page);
      return liveAudits.accessibilityViolations;
    } catch (error: any) {
      console.warn(`⚠️ JS-disabled comparison skipped for ${url}: ${error.message}`);
      return [];
    } finally {
      await page.close();
      await context.close();
    }
  }
}
