import { Browser } from 'playwright';
import { PageScanReport } from '../../types/site-quality-spec';
import { LiveWorker } from './live-worker';

type TechEntry = PageScanReport['technologyStack'][number];
type OfflineEntry = NonNullable<PageScanReport['offlineAudits']>;
type LiveEntry = NonNullable<PageScanReport['liveAudits']>;
type ThirdPartyImpact = NonNullable<PageScanReport['thirdPartyImpact']>;
type ProviderAttribution = ThirdPartyImpact['providerAttribution'][number];

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

  private static readonly KNOWN_PROVIDER_PATTERNS: Array<{ provider: string; pattern: RegExp }> = [
    { provider: 'Google Tag Manager', pattern: /googletagmanager\.com|gtm\.js/i },
    { provider: 'Google Analytics', pattern: /google-analytics\.com|analytics\.js|gtag\(/i },
    { provider: 'Adobe Analytics', pattern: /adobedtm\.com|omtrdc\.net|adobe\.com\/analytics/i },
    { provider: 'Zendesk', pattern: /zendesk\.com|zdassets\.com|zendesk/i },
    { provider: 'Intercom', pattern: /intercom\.io|intercomcdn\.com/i },
    { provider: 'Drift', pattern: /drift\.com/i },
    { provider: 'UserWay', pattern: /userway/i },
    { provider: 'AccessiBe', pattern: /accessibe|acsbapp\.com/i },
    { provider: 'AudioEye', pattern: /audioeye/i },
    { provider: 'Cloudflare', pattern: /cloudflare\.com|challenges\.cloudflare\.com/i }
  ];

  private static readonly SIGNAL_WEIGHTS = {
    scriptOrigin: 3,
    technologyLabel: 2,
    overlayEvidence: 3
  } as const;

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
        highRiskRules: [],
        providerAttribution: [],
        likelyIntroducedByProviders: [],
        ruleToLikelyProviders: [],
        ruleToProviderAttribution: []
      };
    }

    const providerAttribution = this.buildProviderAttribution(
      options.htmlSnapshot,
      options.technologyStack,
      options.offlineAudits
    );
    const providers = providerAttribution.map(item => item.provider);

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
      highRiskRules: addedByJs,
      providerAttribution,
      likelyIntroducedByProviders: providers,
      ruleToLikelyProviders: addedByJs.map(ruleId => ({
        ruleId,
        providers
      })),
      ruleToProviderAttribution: addedByJs.map(ruleId => ({
        ruleId,
        providers: providerAttribution.map(item => ({
          provider: item.provider,
          confidence: item.confidence,
          score: item.score
        }))
      }))
    };
  }

  public static extractLikelyProviders(htmlSnapshot: string, technologyStack: TechEntry[]): string[] {
    return this.buildProviderAttribution(htmlSnapshot, technologyStack, null).map(item => item.provider);
  }

  public static buildProviderAttribution(
    htmlSnapshot: string,
    technologyStack: TechEntry[],
    offlineAudits: OfflineEntry | null
  ): ProviderAttribution[] {
    const evidence = new Map<string, { score: number; signals: Set<string> }>();

    const addSignal = (provider: string, signal: string, weight: number) => {
      const existing = evidence.get(provider) ?? { score: 0, signals: new Set<string>() };
      existing.score += weight;
      existing.signals.add(signal);
      evidence.set(provider, existing);
    };

    const scriptSrcMatches = htmlSnapshot.match(/<script[^>]+src=["']([^"']+)["']/gi) ?? [];
    for (const scriptTag of scriptSrcMatches) {
      for (const signature of this.KNOWN_PROVIDER_PATTERNS) {
        if (signature.pattern.test(scriptTag)) {
          addSignal(signature.provider, 'script-origin', this.SIGNAL_WEIGHTS.scriptOrigin);
        }
      }
    }

    for (const tech of technologyStack) {
      for (const signature of this.KNOWN_PROVIDER_PATTERNS) {
        const techLabel = `${tech.name} ${tech.category}`;
        const providerNameMatch = techLabel.toLowerCase().includes(signature.provider.toLowerCase());
        if (signature.pattern.test(techLabel) || providerNameMatch) {
          addSignal(signature.provider, 'technology-label', this.SIGNAL_WEIGHTS.technologyLabel);
        }
      }
    }

    if (offlineAudits?.overlayDetected.found && offlineAudits.overlayDetected.provider) {
      addSignal(offlineAudits.overlayDetected.provider, 'overlay-evidence', this.SIGNAL_WEIGHTS.overlayEvidence);
    }

    const attribution = Array.from(evidence.entries())
      .map(([provider, value]) => ({
        provider,
        score: value.score,
        confidence: this.scoreToConfidence(value.score),
        signals: Array.from(value.signals).sort()
      }))
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.provider.localeCompare(b.provider);
      });

    return attribution;
  }

  private static scoreToConfidence(score: number): ProviderAttribution['confidence'] {
    if (score >= 5) {
      return 'HIGH';
    }
    if (score >= 2) {
      return 'MEDIUM';
    }
    return 'LOW';
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
