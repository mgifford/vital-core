import Sitemapper from 'sitemapper';
import picomatch from 'picomatch';
import { TargetConfig } from '../types/profile';
import { PrioritySeedStore } from './priority-seeds';

const NON_HTML_EXTENSION_PATTERN = /\.(?:png|jpe?g|gif|webp|svg|ico|pdf|doc|docx|xml|xlsx|xls|pptx?|zip|gz|mp4|mp3|woff2?|ttf|eot|json|csv)$/i;
const RSS_FEED_PATTERN = /\/(feed|rss|atom)(?:\/|$|\?)/i;

export class TargetDiscoveryEngine {
  /**
   * Discovers and prioritizes URLs to scan for a given target configuration.
   * @param target The validated target configuration profile
   */
  public static async discoverUrls(target: TargetConfig): Promise<string[]> {
    let sitemapUrls: string[] = [];
    const includeSubdomains = target.settings?.include_subdomains ?? false;
    const canonicalBaseHost = this.canonicalizeHost(new URL(target.base_url).hostname);
    
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

    // Insert monthly-seeded top-task URLs from DuckDuckGo before broad sitemap crawl output.
    const seededUrls = PrioritySeedStore.getSeedUrls(target);
    if (seededUrls.length > 0) {
      seededUrls
        .map(url => this.normalizeUrl(url))
        .filter((url): url is string => Boolean(url))
        .filter(url => this.isLikelyHtmlUrl(url))
        .filter(url => this.isWithinHostScope(url, canonicalBaseHost, includeSubdomains))
        .forEach(url => uniqueUrlSet.add(url));
    }
    
    // Force target specific high-priority nodes to the front of the line
    if (target.priority_urls && target.priority_urls.length > 0) {
      target.priority_urls
        .map(url => this.normalizeUrl(url))
        .filter((url): url is string => Boolean(url))
        .filter(url => this.isLikelyHtmlUrl(url))
        .filter(url => this.isWithinHostScope(url, canonicalBaseHost, includeSubdomains))
        .forEach(url => uniqueUrlSet.add(url));
    }

    // Append standard sitemap results down the chain
    filteredUrls.forEach(url => uniqueUrlSet.add(url));

    const finalMergedQueue = Array.from(uniqueUrlSet);

    // 4. Maximum Execution Ceiling Throttling Guard
    const ceilingLimit = target.settings?.max_pages ?? 25;
    if (finalMergedQueue.length > ceilingLimit) {
      console.log(`✂️ Truncating active queue from ${finalMergedQueue.length} to ${ceilingLimit} pages (per max_pages limit).`);
      return finalMergedQueue.slice(0, ceilingLimit);
    }

    return finalMergedQueue;
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
