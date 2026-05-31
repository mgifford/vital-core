import * as fs from 'fs';
import * as path from 'path';
import { load } from 'cheerio';
import { TargetConfig } from '../types/profile';

interface PrioritySeedTarget {
  targetId: string;
  host: string;
  domain: string;
  fetchedAt: string;
  source: 'duckduckgo';
  estimatedIndexedPages: number | null;
  topUrls: string[];
}

export interface PrioritySeedSnapshot {
  generatedAt: string;
  strategy: 'duckduckgo-site-query';
  targets: PrioritySeedTarget[];
}

interface InitializeOptions {
  forceRefresh: boolean;
  maxAgeDays: number;
  perTargetLimit: number;
}

interface InitializeResult {
  generatedAt: string;
  refreshed: boolean;
  sourcePath: string | null;
  targetCount: number;
}

export class PrioritySeedStore {
  private static readonly FILE_NAME = 'top-task-seeds.json';
  private static activeSnapshot: PrioritySeedSnapshot | null = null;

  public static async initialize(targets: TargetConfig[], options?: Partial<InitializeOptions>): Promise<InitializeResult> {
    const settings: InitializeOptions = {
      forceRefresh: options?.forceRefresh ?? false,
      maxAgeDays: options?.maxAgeDays ?? 31,
      perTargetLimit: options?.perTargetLimit ?? 12
    };

    const existing = this.loadSnapshot();
    let refreshed = false;

    if (!existing || settings.forceRefresh || this.isStale(existing.snapshot.generatedAt, settings.maxAgeDays)) {
      const refreshedSnapshot = await this.refreshFromDuckDuckGo(targets, settings.perTargetLimit);
      if (refreshedSnapshot.targets.length > 0) {
        this.activeSnapshot = refreshedSnapshot;
        refreshed = true;
      } else if (existing) {
        this.activeSnapshot = existing.snapshot;
      } else {
        this.activeSnapshot = this.createEmptySnapshot();
      }
    } else {
      this.activeSnapshot = existing.snapshot;
    }

    this.persistToDist();

    return {
      generatedAt: this.activeSnapshot.generatedAt,
      refreshed,
      sourcePath: existing?.sourcePath ?? null,
      targetCount: this.activeSnapshot.targets.length
    };
  }

  public static getSeedUrls(target: TargetConfig): string[] {
    if (!this.activeSnapshot) {
      return [];
    }

    const canonicalHost = this.canonicalizeHost(new URL(target.base_url).hostname);
    const byTargetId = this.activeSnapshot.targets.find(entry => entry.targetId === target.id);
    if (byTargetId) {
      return byTargetId.topUrls;
    }

    const byHost = this.activeSnapshot.targets.find(entry => entry.host === canonicalHost);
    return byHost?.topUrls ?? [];
  }

  public static setActiveSnapshotForTesting(snapshot: PrioritySeedSnapshot | null): void {
    this.activeSnapshot = snapshot;
  }

  /** Returns the currently loaded snapshot, or null if not yet initialised. */
  public static getActiveSnapshot(): PrioritySeedSnapshot | null {
    return this.activeSnapshot;
  }

  /**
   * Performs an on-demand DuckDuckGo site: query for a single target and returns
   * the discovered URLs. Used as a real-time fallback when a sitemap returns 0 URLs.
   */
  public static async fetchLiveUrls(target: TargetConfig, limit = 20): Promise<string[]> {
    const host = this.canonicalizeHost(new URL(target.base_url).hostname);
    const query = encodeURIComponent(`site:${host}`);
    const endpoint = `https://duckduckgo.com/html/?q=${query}`;

    try {
      const response = await fetch(endpoint, {
        headers: {
          'User-Agent': 'vital-core-priority-seed/1.0',
          Accept: 'text/html,application/xhtml+xml'
        }
      });

      if (!response.ok) {
        console.warn(`⚠️ DuckDuckGo fallback query failed for ${target.id}: HTTP ${response.status}`);
        return [];
      }

      const html = await response.text();
      const urls = this.extractDuckDuckGoUrls(html, host).slice(0, limit);
      console.log(`🦆 DuckDuckGo fallback discovered ${urls.length} URLs for ${target.id} (site:${host}).`);
      return urls;
    } catch (error: any) {
      console.warn(`⚠️ DuckDuckGo fallback query failed for ${target.id}: ${error.message}`);
      return [];
    }
  }

  private static loadSnapshot(): { sourcePath: string; snapshot: PrioritySeedSnapshot } | null {
    for (const candidatePath of this.getCandidatePaths()) {
      if (!fs.existsSync(candidatePath)) {
        continue;
      }

      try {
        const raw = JSON.parse(fs.readFileSync(candidatePath, 'utf8')) as {
          generatedAt?: unknown;
          targets?: unknown;
        };

        if (!Array.isArray(raw.targets) || typeof raw.generatedAt !== 'string') {
          continue;
        }

        const rawTargets = raw.targets as unknown[];
        const snapshot: PrioritySeedSnapshot = {
          generatedAt: raw.generatedAt,
          strategy: 'duckduckgo-site-query',
          targets: rawTargets
            .filter((entry): entry is PrioritySeedTarget => {
              if (!entry || typeof entry !== 'object') {
                return false;
              }

              const candidate = entry as Record<string, unknown>;
              return (
                typeof candidate.targetId === 'string' &&
                typeof candidate.host === 'string' &&
                typeof candidate.domain === 'string' &&
                typeof candidate.fetchedAt === 'string' &&
                Array.isArray(candidate.topUrls)
              );
            })
            .map(entry => ({
              ...entry,
              source: 'duckduckgo' as const,
              estimatedIndexedPages:
                typeof entry.estimatedIndexedPages === 'number' && Number.isFinite(entry.estimatedIndexedPages)
                  ? entry.estimatedIndexedPages
                  : null,
              topUrls: entry.topUrls.filter(url => typeof url === 'string')
            }))
        };

        return { sourcePath: candidatePath, snapshot };
      } catch {
        // Ignore malformed cache files and continue.
      }
    }

    return null;
  }

  private static getCandidatePaths(): string[] {
    const paths: string[] = [];
    const explicit = process.env.VITAL_PRIORITY_SEEDS_PATH;
    if (explicit) {
      paths.push(path.resolve(process.cwd(), explicit));
    }

    const historyCacheDir = process.env.VITAL_HISTORY_CACHE_DIR;
    if (historyCacheDir) {
      paths.push(path.resolve(process.cwd(), historyCacheDir, 'runs', this.FILE_NAME));
    }

    paths.push(path.resolve(process.cwd(), 'dist', 'runs', this.FILE_NAME));
    return paths;
  }

  private static isStale(generatedAt: string, maxAgeDays: number): boolean {
    const timestamp = Date.parse(generatedAt);
    if (!Number.isFinite(timestamp)) {
      return true;
    }

    const ageMs = Date.now() - timestamp;
    return ageMs > maxAgeDays * 24 * 60 * 60 * 1000;
  }

  private static async refreshFromDuckDuckGo(targets: TargetConfig[], perTargetLimit: number): Promise<PrioritySeedSnapshot> {
    const generatedAt = new Date().toISOString();
    const results: PrioritySeedTarget[] = [];

    for (const target of targets) {
      const host = this.canonicalizeHost(new URL(target.base_url).hostname);
      const query = encodeURIComponent(`site:${host}`);
      const endpoint = `https://duckduckgo.com/html/?q=${query}`;

      try {
        const response = await fetch(endpoint, {
          headers: {
            'User-Agent': 'vital-core-priority-seed/1.0',
            Accept: 'text/html,application/xhtml+xml'
          }
        });

        if (!response.ok) {
          console.warn(`⚠️ DuckDuckGo seeding failed for ${target.id}: HTTP ${response.status}`);
          results.push({
            targetId: target.id,
            host,
            domain: target.base_url,
            fetchedAt: new Date().toISOString(),
            source: 'duckduckgo',
            estimatedIndexedPages: null,
            topUrls: []
          });
          continue;
        }

        const html = await response.text();
        const topUrls = this.extractDuckDuckGoUrls(html, host).slice(0, perTargetLimit);
        const estimatedIndexedPages = this.extractDuckDuckGoEstimatedResultCount(html);

        results.push({
          targetId: target.id,
          host,
          domain: target.base_url,
          fetchedAt: new Date().toISOString(),
          source: 'duckduckgo',
          estimatedIndexedPages,
          topUrls
        });
      } catch (error: any) {
        console.warn(`⚠️ DuckDuckGo seeding failed for ${target.id}: ${error.message}`);
        results.push({
          targetId: target.id,
          host,
          domain: target.base_url,
          fetchedAt: new Date().toISOString(),
          source: 'duckduckgo',
          estimatedIndexedPages: null,
          topUrls: []
        });
      }
    }

    return {
      generatedAt,
      strategy: 'duckduckgo-site-query',
      targets: results
    };
  }

  private static extractDuckDuckGoUrls(html: string, canonicalHost: string): string[] {
    const $ = load(html);
    const links = new Set<string>();
    const primaryAnchors = $('a.result__a[href]');
    const anchorSet = primaryAnchors.length > 0 ? primaryAnchors : $('a[href]');

    anchorSet.each((_, element) => {
      const href = $(element).attr('href');
      const resolved = this.resolveDuckDuckGoHref(href);
      if (!resolved) {
        return;
      }

      try {
        const parsed = new URL(resolved);
        if (!/^https?:$/i.test(parsed.protocol)) {
          return;
        }

        if (this.canonicalizeHost(parsed.hostname) !== canonicalHost) {
          return;
        }

        parsed.hash = '';
        links.add(parsed.toString());
      } catch {
        // Ignore malformed links.
      }
    });

    return Array.from(links);
  }

  private static extractDuckDuckGoEstimatedResultCount(html: string): number | null {
    const $ = load(html);
    const pageText = $('body').text().replace(/\s+/g, ' ');
    const match = pageText.match(/([0-9][0-9,\.\s]{0,20})\s+results?/i);
    if (!match) {
      return null;
    }

    const digitsOnly = (match[1] || '').replace(/\D+/g, '');
    if (!digitsOnly) {
      return null;
    }

    const parsed = Number(digitsOnly);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private static resolveDuckDuckGoHref(href: string | undefined): string | null {
    if (!href) {
      return null;
    }

    if (/^https?:\/\//i.test(href)) {
      return href;
    }

    if (href.startsWith('//')) {
      return `https:${href}`;
    }

    if (href.startsWith('/l/?')) {
      const wrapped = new URL(href, 'https://duckduckgo.com');
      const uddg = wrapped.searchParams.get('uddg');
      return uddg ? decodeURIComponent(uddg) : null;
    }

    return null;
  }

  private static persistToDist(): void {
    if (!this.activeSnapshot) {
      return;
    }

    const distRunsDir = path.resolve(process.cwd(), 'dist', 'runs');
    if (!fs.existsSync(distRunsDir)) {
      fs.mkdirSync(distRunsDir, { recursive: true });
    }

    const outputPath = path.join(distRunsDir, this.FILE_NAME);
    fs.writeFileSync(outputPath, JSON.stringify(this.activeSnapshot, null, 2), 'utf8');
  }

  private static createEmptySnapshot(): PrioritySeedSnapshot {
    return {
      generatedAt: new Date(0).toISOString(),
      strategy: 'duckduckgo-site-query',
      targets: []
    };
  }

  private static canonicalizeHost(hostname: string): string {
    const normalized = hostname.toLowerCase();
    return normalized.startsWith('www.') ? normalized.slice(4) : normalized;
  }
}