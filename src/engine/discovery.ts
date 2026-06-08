import Sitemapper from 'sitemapper';
import picomatch from 'picomatch';
import { TargetConfig } from '../types/profile';
import { PrioritySeedStore } from './priority-seeds';
import type { PageStateMap } from './reporters/page-state-cache';
import { UrlManifest, UrlManifestStore } from './url-manifest';
import fs from 'fs';
import path from 'path';

const NON_HTML_EXTENSION_PATTERN = /\.(?:png|jpe?g|gif|webp|svg|ico|pdf|doc|docx|xml|xlsx|xls|pptx?|zip|gz|mp4|mp3|woff2?|ttf|eot|json|csv)$/i;
const RSS_FEED_PATTERN = /\/(feed|rss|atom)(?:\/|$|\?)/i;

export interface DiscoveryNonHtmlExclusion {
  targetId: string;
  url: string;
  reason: string;
  source: 'sitemap';
  excludedAt: string;
}

export type DiscoveryQueueSource = 'recently_updated' | 'duckduckgo_seed' | 'priority_url' | 'stale_weekly_rescan' | 'sitemap_sample';

const DISCOVERY_QUEUE_SOURCE_PRIORITY: DiscoveryQueueSource[] = [
  'recently_updated',
  'duckduckgo_seed',
  'priority_url',
  'stale_weekly_rescan',
  'sitemap_sample'
];

export interface DiscoveryQueueEntry {
  url: string;
  source: DiscoveryQueueSource;
  reason: string;
  templateKey: string;
  lastSuccessAt: string | null;
  lastModified: string | null;
  selectedAt?: string;
  sourcesSeen?: DiscoveryQueueSource[];
}

export interface DiscoveryQueueSummary {
  targetId: string;
  selectedAt: string;
  queuedUrls: number;
  skippedRecentlyScanned: number;
  skippedQuarantined: number;
  queueComposition: DiscoveryQueueComposition;
}

export interface DiscoveryQueueComposition {
  recently_updated: number;
  duckduckgo_seed: number;
  priority_url: number;
  stale_weekly_rescan: number;
  sitemap_sample: number;
}

export function countDiscoveryQueueComposition(entries: DiscoveryQueueEntry[]): DiscoveryQueueComposition {
  return entries.reduce<DiscoveryQueueComposition>(
    (counts, entry) => {
      counts[entry.source] += 1;
      return counts;
    },
    {
      recently_updated: 0,
      duckduckgo_seed: 0,
      priority_url: 0,
      stale_weekly_rescan: 0,
      sitemap_sample: 0
    }
  );
}

function getDiscoveryQueueSourceRank(source: DiscoveryQueueSource): number {
  const rank = DISCOVERY_QUEUE_SOURCE_PRIORITY.indexOf(source);
  return rank === -1 ? Number.POSITIVE_INFINITY : rank;
}

export class TargetDiscoveryEngine {
  private static nonHtmlExclusions: DiscoveryNonHtmlExclusion[] = [];
  private static readonly SITEMAP_FETCH_TIMEOUT_MS = 15000;
  private static readonly SITEMAP_FALLBACK_MAX_SITEMAPS = 500;
  private static readonly SITEMAP_FALLBACK_MAX_URLS = 200000;

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
  ): Promise<{ urls: string[]; skippedRecentlyScanned: number; skippedQuarantined: number; queueEntries: DiscoveryQueueEntry[]; queueComposition: DiscoveryQueueComposition }> {
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
    const selectedAt = new Date().toISOString();
    const previousSuccessfulRunAt = UrlManifestStore.latestSuccessfulScanAt(urlManifest);
    
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

    if (sitemapUrls.length > 0 && filteredUrls.length === 0) {
      console.log(
        `⚠️ Sitemap for ${target.id} yielded ${sitemapUrls.length} URL(s) but none survived filters or freshness checks. ` +
          `Falling back to DuckDuckGo site query to seed a crawl.`
      );

      const liveFallbackUrls = await PrioritySeedStore.fetchLiveUrls(target, 30);
      if (liveFallbackUrls.length > 0) {
        const fallbackNormalizedUrls: string[] = [];
        liveFallbackUrls
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

            fallbackNormalizedUrls.push(url);
          });

        filteredUrls = fallbackNormalizedUrls;
        console.log(`🦆 DuckDuckGo fallback added ${filteredUrls.length} candidate URL(s) for ${target.id}.`);
      }
    }

    // 3. Strategic merge & deduplication.
    // Keep the highest-priority source when a URL is discovered from multiple paths.
    const queueEntriesByUrl = new Map<string, DiscoveryQueueEntry>();

    const upsertQueueEntry = (
      url: string,
      source: DiscoveryQueueSource,
      reason: string
    ): void => {
      const existing = queueEntriesByUrl.get(url);
      if (!existing) {
        queueEntriesByUrl.set(url, {
          url,
          source,
          reason,
          templateKey: this.inferTemplateKey(url),
          lastSuccessAt: urlManifest[url]?.lastSuccessAt ?? null,
          lastModified: pageState[url]?.lastModified ?? null,
          selectedAt,
          sourcesSeen: [source]
        });
        return;
      }

      const sourcesSeen = new Set<DiscoveryQueueSource>(existing.sourcesSeen ?? [existing.source]);
      sourcesSeen.add(source);

      if (getDiscoveryQueueSourceRank(source) < getDiscoveryQueueSourceRank(existing.source)) {
        queueEntriesByUrl.set(url, {
          ...existing,
          source,
          reason,
          selectedAt,
          sourcesSeen: Array.from(sourcesSeen)
        });
        return;
      }

      queueEntriesByUrl.set(url, {
        ...existing,
        selectedAt,
        sourcesSeen: Array.from(sourcesSeen)
      });
    };

    const hasPreviousSuccessfulRun = Boolean(previousSuccessfulRunAt && Number.isFinite(Date.parse(previousSuccessfulRunAt)));
    const previousSuccessfulRunMs = hasPreviousSuccessfulRun ? Date.parse(previousSuccessfulRunAt as string) : null;
    const isRecentlyUpdatedUrl = (url: string): boolean => {
      const entry = pageState[url];
      if (!entry?.lastModified) {
        return false;
      }

      const lastModified = Date.parse(entry.lastModified);
      if (!Number.isFinite(lastModified)) {
        return false;
      }

      if (urlManifest[url] || entry) {
        if (previousSuccessfulRunMs !== null) {
          return lastModified > previousSuccessfulRunMs;
        }
      }

      return this.wasUpdatedWithinWindow(entry, updatedWithinDays);
    };

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

    // Always scan recently updated URLs first when we have metadata from prior checks.
    filteredUrls
      .filter(url => shouldIncludeUrl(url))
      .filter(url => isRecentlyUpdatedUrl(url))
      .forEach(url => {
        upsertQueueEntry(
          url,
          'recently_updated',
          previousSuccessfulRunAt
            ? `lastModified ${pageState[url]?.lastModified} is newer than the previous successful run at ${previousSuccessfulRunAt}`
            : `lastModified ${pageState[url]?.lastModified} is newer than the ${updatedWithinDays}-day freshness window`
        );
      });

    // Insert monthly-seeded top-task URLs from DuckDuckGo before broad sitemap crawl output.
    const seededUrls = PrioritySeedStore.getSeedUrls(target);
    if (seededUrls.length > 0) {
      seededUrls
        .map(url => this.normalizeUrl(url))
        .filter((url): url is string => Boolean(url))
        .filter(url => this.isLikelyHtmlUrl(url))
        .filter(url => this.isWithinHostScope(url, canonicalBaseHost, includeSubdomains))
        .filter(url => shouldIncludeUrl(url))
        .forEach(url => {
          upsertQueueEntry(
            url,
            'duckduckgo_seed',
            `DuckDuckGo monthly top-task seed for ${target.id}`
          );
        });
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
        .forEach(url => {
          upsertQueueEntry(
            url,
            'priority_url',
            `Configured priority URL for weekly scan on ${target.id}`
          );
        });
    }

    // 4. Optional execution ceiling + template-aware sitemap sampling
    const ceilingLimit = target.settings?.max_pages ?? null;
    const hasCeilingLimit = typeof ceilingLimit === 'number';
    const staleWeeklyRescanUrls = this.selectStaleWeeklyRescanUrls(
      target.id,
      urlManifest,
      pageState,
      canonicalBaseHost,
      includeSubdomains,
      rescanWindowDays
    );
    staleWeeklyRescanUrls.forEach(url => {
      upsertQueueEntry(
        url,
        'stale_weekly_rescan',
        `Manifest success is older than the ${rescanWindowDays}-day weekly rescan window`
      );
    });

    const currentQueueUrls = Array.from(queueEntriesByUrl.keys());
    if (hasCeilingLimit && currentQueueUrls.length >= ceilingLimit) {
      const priorityOnlyQueue = currentQueueUrls.slice(0, ceilingLimit);
      const queueEntries = priorityOnlyQueue
        .map(url => queueEntriesByUrl.get(url))
        .filter((entry): entry is DiscoveryQueueEntry => Boolean(entry));
      const queueComposition = countDiscoveryQueueComposition(queueEntries);
      const queueSummary = this.buildQueueSummary(target.id, selectedAt, queueEntries, 0, 0);
      this.saveScanQueue(target.id, queueEntries, queueSummary);
      console.log(`✂️ Truncating active queue from ${currentQueueUrls.length} to ${ceilingLimit} pages (per max_pages limit).`);
      return { urls: priorityOnlyQueue, skippedRecentlyScanned: 0, skippedQuarantined: 0, queueEntries, queueComposition };
    }

    const remainingSlots = hasCeilingLimit
      ? Math.max(ceilingLimit - currentQueueUrls.length, 0)
      : Number.POSITIVE_INFINITY;
    const templateSampleCap = target.settings?.sitemap_template_sample_cap ?? null;
    const useStochasticSampling = target.settings?.sitemap_sample_stochastic ?? true;
    const uniquePageFocus = target.settings?.unique_page_focus ?? false;
    const newUrlSampleTarget = target.settings?.sitemap_new_url_sample_target ?? null;
    // unique_page_focus prefers structural diversity first. If a template cap is
    // explicitly configured, respect it; otherwise default to one URL/template.
    const effectiveTemplateSampleCap = uniquePageFocus
      ? (templateSampleCap ?? 1)
      : (templateSampleCap ?? Number.POSITIVE_INFINITY);

    let candidateSitemapUrls = filteredUrls.filter(url => shouldIncludeUrl(url));
    if (candidateSitemapUrls.length === 0 && sitemapUrls.length > 0) {
      console.log(
        `⚠️ Sitemap for ${target.id} produced no queueable URLs after freshness checks. ` +
          `Falling back to DuckDuckGo site query to seed a crawl.`
      );

      const liveFallbackUrls = await PrioritySeedStore.fetchLiveUrls(target, 30);
      if (liveFallbackUrls.length > 0) {
        const fallbackCandidateUrls: string[] = [];
        liveFallbackUrls
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

            if (!shouldIncludeUrl(url)) {
              return;
            }

            fallbackCandidateUrls.push(url);
          });

        if (fallbackCandidateUrls.length > 0) {
          candidateSitemapUrls = fallbackCandidateUrls;
          console.log(`🦆 DuckDuckGo fallback added ${candidateSitemapUrls.length} candidate URL(s) for ${target.id}.`);
        }
      }
    }
    const sampledSitemapUrls = this.sampleSitemapUrls(
      candidateSitemapUrls,
      remainingSlots,
      effectiveTemplateSampleCap,
      useStochasticSampling,
      previouslyScannedUrls,
      urlManifest,
      newUrlSampleTarget
    );
    sampledSitemapUrls.forEach(url => {
      upsertQueueEntry(
        url,
        'sitemap_sample',
        'Template-diverse sitemap sample candidate'
      );
    });

    let finalQueue = Array.from(queueEntriesByUrl.keys());

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
        const recencyFilteredUrls = finalQueue.filter(url => queueEntriesByUrl.get(url)?.source === 'sitemap_sample');
        const preservedUrls = finalQueue.filter(url => queueEntriesByUrl.get(url)?.source !== 'sitemap_sample');
        const { needsScan, recentlySucceeded } = UrlManifestStore.partitionByRecency(
          urlManifest,
          recencyFilteredUrls,
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
        finalQueue = [...preservedUrls, ...needsScan];
      }
    }

    const queueEntries = finalQueue
      .map(url => queueEntriesByUrl.get(url))
      .filter((entry): entry is DiscoveryQueueEntry => Boolean(entry));
    const queueComposition = countDiscoveryQueueComposition(queueEntries);
    const queueSummary = this.buildQueueSummary(target.id, selectedAt, queueEntries, skippedRecentlyScanned, skippedQuarantined);
    this.saveScanQueue(target.id, queueEntries, queueSummary);

    return { urls: finalQueue, skippedRecentlyScanned, skippedQuarantined, queueEntries, queueComposition };
  }

  public static consumeNonHtmlExclusions(): DiscoveryNonHtmlExclusion[] {
    const snapshot = [...this.nonHtmlExclusions];
    this.nonHtmlExclusions = [];
    return snapshot;
  }

  public static resetNonHtmlExclusionsForTesting(): void {
    this.nonHtmlExclusions = [];
  }

  private static saveScanQueue(targetId: string, entries: DiscoveryQueueEntry[], summary: DiscoveryQueueSummary): void {
    const runsDir = path.resolve(process.cwd(), 'dist', 'runs', targetId);
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
    }

    fs.writeFileSync(path.join(runsDir, 'scan-queue.json'), JSON.stringify(entries, null, 2), 'utf8');
    fs.writeFileSync(path.join(runsDir, 'scan-queue-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
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
        `Trying XML traversal fallback before DuckDuckGo site: query.`
      );
    } catch (error: any) {
      console.warn(
        `⚠️ Warning: Unable to parse sitemap for ${target.id}: ${error.message}. ` +
        `Trying XML traversal fallback before DuckDuckGo site: query.`
      );
    }

    const xmlFallbackUrls = await this.fetchSitemapViaXmlTraversal(target.sitemap_url!);
    if (xmlFallbackUrls.length > 0) {
      console.log(`📦 XML fallback discovered ${xmlFallbackUrls.length} raw URLs from sitemap traversal.`);
      return xmlFallbackUrls;
    }

    return await PrioritySeedStore.fetchLiveUrls(target, 30);
  }

  private static async fetchSitemapViaXmlTraversal(sitemapUrl: string): Promise<string[]> {
    const queue: string[] = [sitemapUrl];
    const visited = new Set<string>();
    const discoveredPageUrls = new Set<string>();

    while (queue.length > 0) {
      if (visited.size >= this.SITEMAP_FALLBACK_MAX_SITEMAPS) {
        break;
      }
      if (discoveredPageUrls.size >= this.SITEMAP_FALLBACK_MAX_URLS) {
        break;
      }

      const currentSitemap = queue.shift();
      if (!currentSitemap || visited.has(currentSitemap)) {
        continue;
      }
      visited.add(currentSitemap);

      let xmlText = '';
      try {
        const response = await fetch(currentSitemap, {
          signal: AbortSignal.timeout(this.SITEMAP_FETCH_TIMEOUT_MS),
          headers: {
            'User-Agent': 'vital-core-sitemap-fallback/1.0'
          }
        });
        if (!response.ok) {
          continue;
        }
        xmlText = await response.text();
      } catch {
        continue;
      }

      const locEntries = this.extractLocEntries(xmlText);
      if (locEntries.length === 0) {
        continue;
      }

      const isIndex = /<sitemapindex\b/i.test(xmlText);
      if (isIndex) {
        for (const loc of locEntries) {
          const normalized = this.normalizeUrl(loc);
          if (normalized && !visited.has(normalized)) {
            queue.push(normalized);
          }
        }
        continue;
      }

      for (const loc of locEntries) {
        const normalized = this.normalizeUrl(loc);
        if (!normalized) {
          continue;
        }

        if (this.looksLikeSitemapDocument(normalized)) {
          if (!visited.has(normalized)) {
            queue.push(normalized);
          }
          continue;
        }

        discoveredPageUrls.add(normalized);
        if (discoveredPageUrls.size >= this.SITEMAP_FALLBACK_MAX_URLS) {
          break;
        }
      }
    }

    return Array.from(discoveredPageUrls);
  }

  private static extractLocEntries(xmlText: string): string[] {
    const locRegex = /<loc>([^<]+)<\/loc>/gi;
    const locs: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = locRegex.exec(xmlText)) !== null) {
      const value = String(match[1] || '').trim();
      if (value) {
        locs.push(value);
      }
    }
    return locs;
  }

  private static looksLikeSitemapDocument(url: string): boolean {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.toLowerCase();
      if (pathname.endsWith('.xml') || pathname.endsWith('.xml.gz')) {
        return true;
      }
      return pathname.includes('sitemap');
    } catch {
      return false;
    }
  }

  private static sampleSitemapUrls(
    sitemapUrls: string[],
    remainingSlots: number,
    templateSampleCap: number,
    useStochasticSampling: boolean,
    previouslyScannedUrls: Set<string>,
    urlManifest: UrlManifest,
    newUrlSampleTarget: number | null
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
    const pickPass = (predicate: (url: string) => boolean, maxSelections: number = Number.POSITIVE_INFINITY): void => {
      let selections = 0;
      let progressed = true;
      while (picked.length < remainingSlots && progressed && selections < maxSelections) {
        progressed = false;
        for (let i = 0; i < perGroupOrdered.length; i += 1) {
          if (picked.length >= remainingSlots || selections >= maxSelections) {
            break;
          }
          if (perGroupCounts[i] >= templateSampleCap) {
            continue;
          }
          const bucket = perGroupOrdered[i];
          let idx = perGroupCounts[i];
          while (idx < bucket.length && !predicate(bucket[idx])) {
            idx += 1;
          }
          if (idx >= bucket.length) {
            continue;
          }

          picked.push(bucket[idx]);
          perGroupCounts[i] = idx + 1;
          selections += 1;
          progressed = true;
        }
      }
    };

    const shouldCountAsNew = (url: string): boolean => !urlManifest[url] || !urlManifest[url].lastSuccessAt;
    const newTarget = Number.isFinite(Number(newUrlSampleTarget)) && newUrlSampleTarget !== null
      ? Math.max(0, Math.floor(Number(newUrlSampleTarget)))
      : null;

    if (newTarget !== null) {
      pickPass(url => shouldCountAsNew(url), newTarget);
      pickPass(url => !shouldCountAsNew(url));
      pickPass(url => shouldCountAsNew(url));
    } else {
      pickPass(() => true);
    }

    return picked.slice(0, remainingSlots);
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
    const salt = process.env.VITAL_SAMPLING_SEED || 'vital-core:sampling:v1';
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

  private static buildQueueSummary(
    targetId: string,
    selectedAt: string,
    queueEntries: DiscoveryQueueEntry[],
    skippedRecentlyScanned: number,
    skippedQuarantined: number
  ): DiscoveryQueueSummary {
    return {
      targetId,
      selectedAt,
      queuedUrls: queueEntries.length,
      skippedRecentlyScanned,
      skippedQuarantined,
      queueComposition: countDiscoveryQueueComposition(queueEntries)
    };
  }

  private static selectStaleWeeklyRescanUrls(
    targetId: string,
    urlManifest: UrlManifest,
    pageState: PageStateMap,
    canonicalBaseHost: string,
    includeSubdomains: boolean,
    rescanWindowDays: number
  ): string[] {
    const windowMs = rescanWindowDays * 24 * 60 * 60 * 1000;
    const candidateUrls = Object.values(urlManifest)
      .filter(entry => Boolean(entry?.lastSuccessAt))
      .filter(entry => {
        const lastSuccessMs = Date.parse(entry.lastSuccessAt as string);
        if (!Number.isFinite(lastSuccessMs)) {
          return false;
        }

        const ageMs = Date.now() - lastSuccessMs;
        return ageMs >= windowMs;
      })
      .map(entry => entry.url)
      .filter(url => this.normalizeUrl(url) !== null)
      .filter(url => this.isWithinHostScope(url, canonicalBaseHost, includeSubdomains))
      .filter(url => this.isLikelyHtmlUrl(url))
      .filter(url => !UrlManifestStore.isQuarantined(urlManifest[url]));

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const url of candidateUrls) {
      if (seen.has(url)) {
        continue;
      }

      if (pageState[url]?.lastModified) {
        const lastModified = Date.parse(pageState[url].lastModified as string);
        if (!Number.isFinite(lastModified)) {
          continue;
        }
      }

      seen.add(url);
      deduped.push(url);
    }

    if (deduped.length > 0) {
      console.log(`🗓️  Selected ${deduped.length} stale weekly rescan URL(s) for ${targetId}.`);
    }

    return deduped;
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
