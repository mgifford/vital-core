import Sitemapper from 'sitemapper';
import picomatch from 'picomatch';
import { TargetConfig } from '../types/profile';
import { PrioritySeedStore } from './priority-seeds';
import type { PageStateMap } from './reporters/page-state-cache';

const NON_HTML_EXTENSION_PATTERN = /\.(?:png|jpe?g|gif|webp|svg|ico|pdf|doc|docx|xml|xlsx|xls|pptx?|zip|gz|mp4|mp3|woff2?|ttf|eot|json|csv)$/i;
const RSS_FEED_PATTERN = /\/(feed|rss|atom)(?:\/|$|\?)/i;

export class TargetDiscoveryEngine {
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
    } = {}
  ): Promise<string[]> {
    let sitemapUrls: string[] = [];
    const includeSubdomains = target.settings?.include_subdomains ?? false;
    const canonicalBaseHost = this.canonicalizeHost(new URL(target.base_url).hostname);
    const pageState = options.pageState ?? {};
    const previouslyScannedUrls = options.previouslyScannedUrls ?? new Set<string>(Object.keys(pageState));
    const skipPreviouslyScanned = options.skipPreviouslyScanned ?? true;
    const revalidateAfterDays = options.revalidateAfterDays ?? 7;
    const updatedWithinDays = options.updatedWithinDays ?? 7;
    
    // 1. Safe Sitemap Crawling
    if (target.sitemap_url) {
      console.log(`📡 Fetching sitemap data for ${target.name} from: ${target.sitemap_url}`);
      const mapper = new Sitemapper({
        url: target.sitemap_url,
        timeout: 15000 // 15 seconds max allotment for sitemap retrieval
      });

      try {
        const response = await mapper.fetch();
        sitemapUrls = response.sites || [];
        console.log(`📦 Discovered ${sitemapUrls.length} raw URLs within remote sitemap.`);
      } catch (error: any) {
        // Resiliency Guard: A corrupted or blocked sitemap should never crash the runner
        console.warn(`⚠️ Warning: Unable to parse sitemap for ${target.id}: ${error.message}. Falling back to priority seed URLs.`);
      }
    }

    // 2. Glob Filter Matrix Evaluation
    const normalizedUrls = sitemapUrls
      .map(url => this.normalizeUrl(url))
      .filter((url): url is string => Boolean(url))
      .filter(url => this.isLikelyHtmlUrl(url))
      .filter(url => this.isWithinHostScope(url, canonicalBaseHost, includeSubdomains));

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

      return this.isDueForRevalidation(pageState[url], revalidateAfterDays);
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
    
    // Force target specific high-priority nodes to the front of the line
    if (target.priority_urls && target.priority_urls.length > 0) {
      target.priority_urls
        .map(url => this.normalizeUrl(url))
        .filter((url): url is string => Boolean(url))
        .filter(url => this.isLikelyHtmlUrl(url))
        .filter(url => this.isWithinHostScope(url, canonicalBaseHost, includeSubdomains))
        .filter(url => shouldIncludeUrl(url))
        .forEach(url => uniqueUrlSet.add(url));
    }

    // 4. Optional execution ceiling + template-aware sitemap sampling
    const ceilingLimit = target.settings?.max_pages ?? null;
    const hasCeilingLimit = typeof ceilingLimit === 'number';
    if (hasCeilingLimit && uniqueUrlSet.size >= ceilingLimit) {
      const priorityOnlyQueue = Array.from(uniqueUrlSet).slice(0, ceilingLimit);
      console.log(`✂️ Truncating active queue from ${uniqueUrlSet.size} to ${ceilingLimit} pages (per max_pages limit).`);
      return priorityOnlyQueue;
    }

    const remainingSlots = hasCeilingLimit
      ? Math.max(ceilingLimit - uniqueUrlSet.size, 0)
      : Number.POSITIVE_INFINITY;
    const templateSampleCap = target.settings?.sitemap_template_sample_cap ?? null;
    const useStochasticSampling = target.settings?.sitemap_sample_stochastic ?? true;

    const candidateSitemapUrls = filteredUrls.filter(url => shouldIncludeUrl(url));

    const sampledSitemapUrls = this.sampleSitemapUrls(
      candidateSitemapUrls,
      remainingSlots,
      templateSampleCap ?? Number.POSITIVE_INFINITY,
      useStochasticSampling,
      previouslyScannedUrls
    );
    sampledSitemapUrls.forEach(url => uniqueUrlSet.add(url));

    const finalMergedQueue = Array.from(uniqueUrlSet);

    return finalMergedQueue;
  }

  private static sampleSitemapUrls(
    sitemapUrls: string[],
    remainingSlots: number,
    templateSampleCap: number,
    useStochasticSampling: boolean,
    previouslyScannedUrls: Set<string>
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
      const unseen = orderedUrls.filter(url => !previouslyScannedUrls.has(url));
      const seen = orderedUrls.filter(url => previouslyScannedUrls.has(url));

      return {
        key,
        urls: [...unseen, ...seen]
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

    const lastChecked = Date.parse(entry.lastCheckedAt || '');
    if (!Number.isFinite(lastChecked)) {
      return true;
    }

    const ageMs = Date.now() - lastChecked;
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
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.toLowerCase();
      if (NON_HTML_EXTENSION_PATTERN.test(pathname)) {
        return false;
      }

      if (RSS_FEED_PATTERN.test(pathname)) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
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
