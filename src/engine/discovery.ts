import Sitemapper from 'sitemapper';
import picomatch from 'picomatch';
import { TargetConfig } from '../types/profile';

export class TargetDiscoveryEngine {
  /**
   * Discovers and prioritizes URLs to scan for a given target configuration.
   * @param target The validated target configuration profile
   */
  public static async discoverUrls(target: TargetConfig): Promise<string[]> {
    let sitemapUrls: string[] = [];
    
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
    let filteredUrls = sitemapUrls;
    if (target.include_paths && target.include_paths.length > 0) {
      console.log(`🎛️ Filtering sitemap links against ${target.include_paths.length} path constraints...`);
      
      // Compile glob matches into a unified test configuration
      const isMatch = picomatch(target.include_paths);
      filteredUrls = sitemapUrls.filter(url => isMatch(url));
      
      console.log(`🎯 Post-filter calculation: ${filteredUrls.length} URLs matched constraints.`);
    }

    // 3. Strategic Merge & Deduplication Array Sequence
    // We instantiate a Set with priority items first to preserve execution ordering
    const uniqueUrlSet = new Set<string>();
    
    // Force target specific high-priority nodes to the front of the line
    if (target.priority_urls && target.priority_urls.length > 0) {
      target.priority_urls.forEach(url => uniqueUrlSet.add(url));
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
}
