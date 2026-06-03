import Sitemapper from 'sitemapper';
import picomatch from 'picomatch';
import { TargetConfig } from '../types/profile';
import { PrioritySeedStore } from './priority-seeds';
import type { PageStateMap } from './reporters/page-state-cache';
import { UrlManifest, UrlManifestStore } from './url-manifest';
import fs from 'fs';

const NON_HTML_EXTENSION_PATTERN = /\.(?:png|jpe?g|gif|webp|svg|ico|pdf|doc|docx|xml|xlsx|xls|pptx?|zip|gz|mp4|mp3|woff2?|ttf|eot|json|csv)$/i;
const RSS_FEED_PATTERN = /\/(feed|rss|atom)(?:\/|$|\?)/i;

export interface DiscoveryNonHtmlExclusion {
  targetId: string;
  url: string;
  reason: string;
  source: 'sitemap';
  excludedAt: string;
}

export class TargetDiscoveryEngine {
  private static nonHtmlExclusions: DiscoveryNonHtmlExclusion[] = [];

  /**
   * Discovers and prioritizes URLs to scan for a given target configuration.
   * @param target The validated target configuration profile
   */
  public static async discoverUrls(
    target: TargetConfig,
    options: {
      pageState?: PageStateMap;
      previouslyScannedUrls?: Set<string>;
      skipPreviouslyScanned?: boolean;
      revalidateAfterDays?: number;
      updatedWithinDays?: number;
      updatedRecheckHours?: number;
      urlManifest?: UrlManifest;
      rescanWindowDays?: number;
      includeQuarantined?: boolean;
    } = {}
  ): Promise<{ urls: string[]; skippedRecentlyScanned: number; skippedQuarantined: number }> {
    let sitemapUrls: string[] = [];
    const includeSubdomains = target.settings?.include_subdomains ?? false;
    const canonicalBaseHost = this.canonicalizeHost(new URL(target.base_url).hostname);
    const pageState = options.pageState ?? {};
    const previouslyScannedUrls = options.previouslyScannedUrls ?? new Set<string>(Object.keys(pageState));
    const skipPreviouslyScanned = options.skipPreviouslyScanned ?? true;
    const revalidateAfterDays = options.revalidateAfterDays ?? 7;
    const updatedWithinDays = options.updatedWithinDays ?? 7;
    const updatedRecheckHours = options.updatedRecheckHours ?? 12;
    const urlManifest = options.urlManifest ?? {};
    const rescanWindowDays = options.rescanWindowDays ?? revalidateAfterDays;
    const includeQuarantined = options.includeQuarantined ?? false;
    
    // 1. Safe Sitemap Crawling
    if (target.sitemap_url) {
      console.log(`📡 Fetching sitemap data for ${target.name} from: ${target.sitemap_url}`);
      sitemapUrls = await this.fetchSitemapResiliently(target);
    }

    // 2. Glob Filter Matrix Evaluation
    const normalizedUrls: string[] = [];
    sitemapUrls
      .map(url => this.normalizeUrl(url))
      .filter((url): url is string => Boolean(url))
      .forEach(url => {
        const htmlClassification = this.classifyHtmlUrl(url);
        if (!htmlClassification.isHtml) {
          this.recordNonHtmlExclusion(target.id, url, htmlClassification.reason || 'Non-HTML resource');
          return;
        }

        if (!this.isWithinHostScope(url, canonicalBaseHost, includeSubdomains)) {
          return;
        }

        normalizedUrls.push(url);
      });

    let filteredUrls = normalizedUrls;
    if (target.include_paths && target.include_paths.length > 0) {
      console.log(`🎛️ Filtering sitemap links against ${target.include_paths.length} path constraints...`);
      
      // Compile glob matches into a unified test configuration
      const isMatch = picomatch(target.include_paths);
      filteredUrls = normalizedUrls.filter(url => {
        try {
          const pathname = new URL(url).pathname;
          return isMatch(pathname) || isMatch(url);
        } catch {
          return isMatch(url);
        }
      });
      
      console.log(`🎯 Post-filter calculation: ${filteredUrls.length} URLs matched constraints.`);
    }

    // 3. Strategic Merge & Deduplication Array Sequence
    // We instantiate a Set with priority items first to preserve execution ordering
    const uniqueUrlSet = new Set<string>();

    const shouldIncludeUrl = (url: string): boolean => {
      if (!skipPreviouslyScanned) {
        return true;
      }

      if (!previouslyScannedUrls.has(url)) {
        return true;
      }

      // Always re-queue pages that exist in pageState but were never successfully scanned.
      if (!pageState[url]?.lastScannedAt) {
        return true;
      }

      if (this.isDueForRevalidation(pageState[url], revalidateAfterDays)) {
        return true;
      }

      // Recently updated pages are useful to revisit, but only after a cooldown
      // so they do not dominate every incremental run.
      return (
        this.wasUpdatedWithinWindow(pageState[url], updatedWithinDays) &&
        this.hasElapsedUpdatedRecheckCooldown(pageState[url], updatedRecheckHours)
      );
    };

    const isRecentlyUpdatedUrl = (url: string): boolean => {
      return this.wasUpdatedWithinWindow(pageState[url], updatedWithinDays);
    };

    // Always scan recently updated URLs first when we have metadata from prior checks.
    filteredUrls
      .filter(url => shouldIncludeUrl(url))
      .filter(url => isRecentlyUpdatedUrl(url))
      .forEach(url => uniqueUrlSet.add(url));

    // Insert monthly-seeded top-task URLs from DuckDuckGo before broad sitemap crawl output.
    const seededUrls = PrioritySeedStore.getSeedUrls(target);
    if (seededUrls.length > 0) {
      seededUrls
        .map(url => this.normalizeUrl(url))
        .filter((url): url is string => Boolean(url))
        .filter(url => this.isLikelyHtmlUrl(url))
        .filter(url => this.isWithinHostScope(url, canonicalBaseHost, includeSubdomains))
        .filter(url => shouldIncludeUrl(url))
        .forEach(url => uniqueUrlSet.add(url));
    }
    
    // Force target specific high‑priority nodes to the front of the queue.
    // Priority URLs now respect normal freshness checks (skipPreviouslyScanned, revalidation, etc.)
    // but still honor the quarantine cooldown to avoid hammering failing URLs.
    if (target.priority_urls && target.priority_urls.length > 0) {
      target.priority_urls
        .map(url => this.normalizeUrl(url))
        .filter((url): url is string => Boolean(url))
        .filter(url => this.isLikelyHtmlUrl(url))
        .filter(url => this.isWithinHostScope(url, canonicalBaseHost, includeSubdomains))
        // Apply the same inclusion predicate used for other URLs (skipPreviouslyScanned, revalidation, etc.)
        .filter(url => shouldIncludeUrl(url))
        .filter(url => {
          if (includeQuarantined) return true;
          const entry = urlManifest[url];
          return !entry || !UrlManifestStore.isQuarantined(entry);
        })
        .forEach(url => uniqueUrlSet.add(url));
    }

    // 4. Optional execution ceiling + template-aware sitemap sampling
    const ceilingLimit = target.settings?.max_pages ?? null;
    const hasCeilingLimit = typeof ceilingLimit === 'number';
    if (hasCeilingLimit && uniqueUrlSet.size >= ceilingLimit) {
      const priorityOnlyQueue = Array.from(uniqueUrlSet).slice(0, ceilingLimit);
      console.log(`✂️ Truncating active queue from ${uniqueUrlSet.size} to ${ceilingLimit} pages (per max_pages limit).`);
      return { urls: priorityOnlyQueue, skippedRecentlyScanned: 0, skippedQuarantined: 0 };
    }

    const remainingSlots = hasCeilingLimit
      ? Math.max(ceilingLimit - uniqueUrlSet.size, 0)
      : Number.POSITIVE_INFINITY;
    const templateSampleCap = target.settings?.sitemap_template_sample_cap ?? null;
    const useStochasticSampling = target.settings?.sitemap_sample_stochastic ?? true;
    const uniquePageFocus = target.settings?.unique_page_focus ?? false;
    const effectiveTemplateSampleCap = uniquePageFocus
      ? 1
      : (templateSampleCap ?? Number.POSITIVE_INFINITY);

    const candidateSitemapUrls = filteredUrls.filter(url => shouldIncludeUrl(url));

    const sampledSitemapUrls = this.sampleSitemapUrls(
      candidateSitemapUrls,
      remainingSlots,
      effectiveTemplateSampleCap,
      useStochasticSampling,
      previouslyScannedUrls,
      urlManifest
    );
    sampledSitemapUrls.forEach(url => uniqueUrlSet.add(url));

    let finalQueue = Array.from(uniqueUrlSet);

    // 5. Manifest-based filtering: remove URLs that are quarantined or recently succeeded.
    // This is a discovery-phase optimization — it eliminates even the lightweight probe
    // HTTP request that would otherwise confirm them as unchanged.
    let skippedRecentlyScanned = 0;
    let skippedQuarantined = 0;

    if (Object.keys(urlManifest).length > 0) {
      if (!includeQuarantined) {
        const { active, quarantined } = UrlManifestStore.partitionByQuarantine(urlManifest, finalQueue);
        if (quarantined.length > 0) {
          skippedQuarantined = quarantined.length;
          console.log(
            `🚫 Skipping ${quarantined.length} quarantined URL(s) for ${target.id} ` +
              `(repeated failures; cooldown active). Use --include-quarantined to override.`
          );
        }
        finalQueue = active;
      }

      if (skipPreviouslyScanned && rescanWindowDays > 0) {
        const { needsScan, recentlySucceeded } = UrlManifestStore.partitionByRecency(
          urlManifest,
          finalQueue,
          rescanWindowDays
        );
        if (recentlySucceeded.length > 0) {
          skippedRecentlyScanned = recentlySucceeded.length;
          console.log(
            `⏭️ Skipping ${recentlySucceeded.length} URL(s) for ${target.id} ` +
              `already succeeded within the last ${rescanWindowDays} day(s) ` +
              `(set VITAL_RESCAN_WINDOW_DAYS=0 or FORCE_RESCAN=true to override).`
          );
        }
        finalQueue = needsScan;
      }
    }

    return { urls: finalQueue, skippedRecentlyScanned, skippedQuarantined };
  }

  public static consumeNonHtmlExclusions(): DiscoveryNonHtmlExclusion[] {
    const snapshot = [...this.nonHtmlExclusions];
    this.nonHtmlExclusions = [];
    return snapshot;
  }

  public static resetNonHtmlExclusionsForTesting(): void {
    this.nonHtmlExclusions = [];
  }

  private static async fetchSitemapResiliently(target: TargetConfig): Promise<string[]> {
    // Support local file:// sitemaps for offline testing
    if (target.sitemap_url && target.sitemap_url.startsWith('file://')) {
      try {
        const filePath = target.sitemap_url.replace('file://', '');
        const raw = fs.readFileSync(filePath, 'utf-8');
        // Simple <loc> extraction – sufficient for typical sitemaps
        const locRegex = /<loc>([^<]+)<\/loc>/gi;
        const urls: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = locRegex.exec(raw)) !== null) {
          urls.push(match[1].trim());
        }
        console.log(`📦 Loaded ${urls.length} URLs from local sitemap ${filePath}.`);
        return urls;
      } catch (e) {
        console.warn(`⚠️ Failed to read local sitemap at ${target.sitemap_url}: ${e instanceof Error ? e.message : e}`);
        // Fall back to remote handling below
      }
    }

    const mapper = new Sitemapper({
      url: target.sitemap_url!,
      timeout: 15000
    });

    try {
      const response = await mapper.fetch();
      if (response.sites && response.sites.length > 0) {
        console.log(`📦 Discovered ${response.sites.length} raw URLs within remote sitemap.`);
        return response.sites;
      }
      console.warn(
        `⚠️ Sitemap returned 0 URLs for ${target.id} (${target.sitemap_url}). ` +
        `Falling back to DuckDuckGo site: query.`
      );
    } catch (error: any) {
      console.warn(`⚠️ Warning: Unable to parse sitemap for ${target.id}: ${error.message}. Falling back to DuckDuckGo site: query.`);
    }

    return await PrioritySeedStore.fetchLiveUrls(target, 30);
  }

  private static sampleSitemapUrls(
    sitemapUrls: string[],
    remainingSlots: number,
    templateSampleCap: number,
    useStochasticSampling: boolean,
    previouslyScannedUrls: Set<string>,
    urlManifest: UrlManifest
  ): string[] {
    if (remainingSlots <= 0 || sitemapUrls.length === 0) {
      return [];
    }

    const groups = new Map<string, string[]>();
    for (const url of sitemapUrls) {
      const key = this.inferTemplateKey(url);
      const bucket = groups.get(key) || [];
      bucket.push(url);
      groups.set(key, bucket);
    }

    const groupEntries = Array.from(groups.entries()).map(([key, urls]) => {
      const orderedUrls = useStochasticSampling ? this.stableShuffle(urls) : [...urls];

      // Four-tier ordering: (a) no manifest entry → (b) null lastSuccessAt →
      // (c/d) has lastSuccessAt, oldest first (never-scanned URLs surface first).
      const noEntry = orderedUrls.filter(url => !urlManifest[url]);
      const nullSuccess = orderedUrls.filter(url => urlManifest[url] && !urlManifest[url].lastSuccessAt);
      const hasSuccess = orderedUrls
        .filter(url => urlManifest[url]?.lastSuccessAt)
        .sort((a, b) => {
          const ta = Date.parse(urlManifest[a].lastSuccessAt!);
          const tb = Date.parse(urlManifest[b].lastSuccessAt!);
          return ta - tb; // oldest first
        });

      return {
        key,
        urls: [...noEntry, ...nullSuccess, ...hasSuccess]
      };
    });

    const seed = process.env.VITAL_SAMPLING_SEED || '';
    const orderedGroups = useStochasticSampling
      ? [...groupEntries].sort(
          (a, b) =>
            this.hashString(`${seed}:group:${a.key}`) -
            this.hashString(`${seed}:group:${b.key}`)
        )
      : groupEntries;

    const perGroupOrdered = orderedGroups.map(entry => entry.urls);

    const picked: string[] = [];
    const perGroupCounts = new Array<number>(perGroupOrdered.length).fill(0);
    let progressed = true;

    while (picked.length < remainingSlots && progressed) {
      progressed = false;
      for (let i = 0; i < perGroupOrdered.length; i += 1) {
        if (picked.length >= remainingSlots) {
          break;
        }
        if (perGroupCounts[i] >= templateSampleCap) {
          continue;
        }
        const bucket = perGroupOrdered[i];
        const idx = perGroupCounts[i];
        if (idx >= bucket.length) {
          continue;
        }

        picked.push(bucket[idx]);
        perGroupCounts[i] += 1;
        progressed = true;
      }
    }

    return picked;
  }

  private static inferTemplateKey(url: string): string {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname
        .split('/')
        .filter(Boolean)
        .map(segment => this.normalizeTemplateSegment(segment));

      if (segments.length === 0) {
        return '/';
      }

      const capped = segments.length > 3
        ? [...segments.slice(0, 2), ':tail']
        : segments;

      return '/' + capped.join('/');
    } catch {
      return '/unknown';
    }
  }

  private static normalizeTemplateSegment(segment: string): string {
    const token = segment.toLowerCase();
    if (/^\d+$/.test(token)) {
      return ':num';
    }
    if (/^[0-9a-f]{8,}$/.test(token)) {
      return ':id';
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)) {
      return ':uuid';
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(token) || /^\d{4}\/\d{2}\/\d{2}$/.test(token)) {
      return ':date';
    }
    if ((token.includes('-') && token.split('-').length >= 4) || /[a-z].*\d|\d.*[a-z]/.test(token)) {
      return ':slug';
    }
    return token;
  }

  private static stableShuffle(urls: string[]): string[] {
    const salt = process.env.VITAL_SAMPLING_SEED || `${new Date().toISOString().slice(0, 10)}:daily`;
    return [...urls].sort((a, b) => this.hashString(`${salt}:${a}`) - this.hashString(`${salt}:${b}`));
  }

  private static isDueForRevalidation(entry: PageStateMap[string] | undefined, revalidateAfterDays: number): boolean {
    if (!entry) {
      return true;
    }

    // Use the most recent of lastCheckedAt and lastScannedAt so that a page
    // recently fully scanned is not re-queued just because lastCheckedAt is
    // stale (e.g. after history cache restoration from an older backup).
    const lastChecked = Date.parse(entry.lastCheckedAt || '');
    const lastScanned = Date.parse(entry.lastScannedAt || '');
    const mostRecentActivity = Math.max(
      Number.isFinite(lastChecked) ? lastChecked : 0,
      Number.isFinite(lastScanned) ? lastScanned : 0
    );

    if (mostRecentActivity === 0) {
      return true;
    }

    const ageMs = Date.now() - mostRecentActivity;
    return ageMs >= revalidateAfterDays * 24 * 60 * 60 * 1000;
  }

  private static wasUpdatedWithinWindow(entry: PageStateMap[string] | undefined, updatedWithinDays: number): boolean {
    if (!entry?.lastModified) {
      return false;
    }

    const lastModified = Date.parse(entry.lastModified);
    if (!Number.isFinite(lastModified)) {
      return false;
    }

    const ageMs = Date.now() - lastModified;
    return ageMs >= 0 && ageMs <= updatedWithinDays * 24 * 60 * 60 * 1000;
  }

  private static hasElapsedUpdatedRecheckCooldown(
    entry: PageStateMap[string] | undefined,
    updatedRecheckHours: number
  ): boolean {
    if (!entry) {
      return true;
    }

    if (!Number.isFinite(updatedRecheckHours) || updatedRecheckHours <= 0) {
      return true;
    }

    const lastChecked = Date.parse(entry.lastCheckedAt || '');
    if (!Number.isFinite(lastChecked)) {
      return true;
    }

    const ageMs = Date.now() - lastChecked;
    return ageMs >= updatedRecheckHours * 60 * 60 * 1000;
  }

  private static hashString(value: string): number {
    let hash = 5381;
    for (let i = 0; i < value.length; i += 1) {
      hash = ((hash << 5) + hash) + value.charCodeAt(i);
      hash |= 0;
    }
    return hash >>> 0;
  }

  private static normalizeUrl(rawUrl: string): string | null {
    try {
      const parsed = new URL(rawUrl);
      if (!/^https?:$/i.test(parsed.protocol)) {
        return null;
      }

      parsed.hash = '';
      return parsed.toString();
    } catch {
      return null;
    }
  }

  private static isLikelyHtmlUrl(url: string): boolean {
    return this.classifyHtmlUrl(url).isHtml;
  }

  private static classifyHtmlUrl(url: string): { isHtml: boolean; reason: string | null } {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.toLowerCase();
      if (NON_HTML_EXTENSION_PATTERN.test(pathname)) {
        return { isHtml: false, reason: 'Excluded non-HTML extension from sitemap URL' };
      }

      if (RSS_FEED_PATTERN.test(pathname)) {
        return { isHtml: false, reason: 'Excluded RSS/feed endpoint from sitemap URL' };
      }

      return { isHtml: true, reason: null };
    } catch {
      return { isHtml: false, reason: 'Excluded malformed URL from sitemap URL list' };
    }
  }

  private static recordNonHtmlExclusion(targetId: string, url: string, reason: string): void {
    this.nonHtmlExclusions.push({
      targetId,
      url,
      reason,
      source: 'sitemap',
      excludedAt: new Date().toISOString()
    });
  }

  private static isWithinHostScope(url: string, canonicalBaseHost: string, includeSubdomains: boolean): boolean {
    try {
      const host = this.canonicalizeHost(new URL(url).hostname);
      if (includeSubdomains) {
        return host === canonicalBaseHost || host.endsWith(`.${canonicalBaseHost}`);
      }

      return host === canonicalBaseHost;
    } catch {
      return false;
    }
  }

  private static canonicalizeHost(hostname: string): string {
    return hostname.toLowerCase().replace(/\.$/, '');
  }
}
