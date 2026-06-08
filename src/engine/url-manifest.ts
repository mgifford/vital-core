import * as fs from 'fs';
import * as path from 'path';

/**
 * Subset of page scan outcome statuses tracked in the URL manifest.
 * Matches the status values in PageScanReport for consistency.
 */
export type UrlScanStatus = 'COMPLETED' | 'TIMEOUT' | 'FAILED' | 'WAF_BLOCKED' | 'SKIPPED_UNCHANGED';

/**
 * Persistent per-URL scan lifecycle record stored in the URL manifest.
 */
export interface UrlManifestEntry {
  /** Canonical URL string (same as the manifest key). */
  url: string;
  /** ISO timestamp of when this URL was first added to the manifest. */
  discoveredAt: string;
  /** ISO timestamp of the most recent scan attempt (any outcome). */
  lastAttemptedAt: string | null;
  /** ISO timestamp of the last COMPLETED or SKIPPED_UNCHANGED outcome. */
  lastSuccessAt: string | null;
  /** Outcome of the most recent scan attempt. */
  lastStatus: UrlScanStatus | null;
  /** Number of consecutive TIMEOUT / FAILED / WAF_BLOCKED outcomes without a success. */
  consecutiveFailures: number;
  /** ISO timestamp until which this URL is quarantined and excluded from scans. */
  cooldownUntil: string | null;
  /** SHA-256 hash of the last successfully scanned page content. */
  contentHash: string | null;
}

/** Per-target URL manifest: maps URL string → entry. */
export type UrlManifest = Record<string, UrlManifestEntry>;

/** Configuration for the quarantine escalation thresholds. */
export interface QuarantineConfig {
  /** Number of consecutive failures that trigger the initial (light) cooldown. Default: 2. */
  lightThreshold: number;
  /** Number of consecutive failures that trigger the extended (hard) cooldown. Default: 4. */
  hardThreshold: number;
  /** Duration in hours for the light quarantine tier. Default: 48 hours. */
  lightCooldownHours: number;
  /** Duration in hours for the hard quarantine tier. Default: 168 hours (7 days). */
  hardCooldownHours: number;
}

export const DEFAULT_QUARANTINE_CONFIG: QuarantineConfig = {
  lightThreshold: 2,
  hardThreshold: 4,
  lightCooldownHours: 48,
  hardCooldownHours: 168
};

const VALID_STATUSES: ReadonlySet<string> = new Set([
  'COMPLETED',
  'TIMEOUT',
  'FAILED',
  'WAF_BLOCKED',
  'SKIPPED_UNCHANGED'
]);

function isValidStatus(value: unknown): value is UrlScanStatus {
  return typeof value === 'string' && VALID_STATUSES.has(value);
}

/**
 * Persistent per-domain (per-target) URL manifest store.
 *
 * The manifest file is kept at `dist/runs/{targetId}/url-manifest.json`.
 * It records the scan lifecycle for every URL discovered for a target,
 * enabling:
 *   - Discovery-phase exclusion of recently-succeeded URLs (avoiding wasted probes)
 *   - Quarantine of URLs with repeated timeouts/failures
 *   - Per-domain observability (scan status dashboard)
 */
export class UrlManifestStore {
  private static getManifestPath(targetId: string): string {
    return path.resolve(process.cwd(), 'dist', 'runs', targetId, 'url-manifest.json');
  }

  /**
   * Loads the manifest for a given target from disk. Returns an empty map if
   * the file does not exist or cannot be parsed.
   */
  public static load(targetId: string): UrlManifest {
    this.restoreCachedManifest(targetId);

    const manifestPath = this.getManifestPath(targetId);
    if (!fs.existsSync(manifestPath)) {
      return {};
    }

    try {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }

      const manifest: UrlManifest = {};
      for (const [url, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          continue;
        }
        const v = value as Record<string, unknown>;
        manifest[url] = {
          url: typeof v.url === 'string' ? v.url : url,
          discoveredAt: typeof v.discoveredAt === 'string' ? v.discoveredAt : new Date().toISOString(),
          lastAttemptedAt: typeof v.lastAttemptedAt === 'string' ? v.lastAttemptedAt : null,
          lastSuccessAt: typeof v.lastSuccessAt === 'string' ? v.lastSuccessAt : null,
          lastStatus: isValidStatus(v.lastStatus) ? v.lastStatus : null,
          consecutiveFailures: typeof v.consecutiveFailures === 'number' && v.consecutiveFailures >= 0
            ? Math.floor(v.consecutiveFailures)
            : 0,
          cooldownUntil: typeof v.cooldownUntil === 'string' ? v.cooldownUntil : null,
          contentHash: typeof v.contentHash === 'string' ? v.contentHash : null
        };
      }
      return manifest;
    } catch {
      return {};
    }
  }

  /**
   * Persists the manifest for a given target to disk.
   */
  public static save(targetId: string, manifest: UrlManifest): void {
    const manifestPath = this.getManifestPath(targetId);
    const dir = path.dirname(manifestPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  /**
   * If VITAL_HISTORY_CACHE_DIR is set and the target's manifest has not yet
   * been written to dist/runs/{targetId}/url-manifest.json, copies the cached
   * version from the history cache.  Mirrors PageStateCache.restoreCachedState().
   */
  private static restoreCachedManifest(targetId: string): void {
    const historyCacheDir = process.env.VITAL_HISTORY_CACHE_DIR;
    if (!historyCacheDir) {
      return;
    }

    const cachedPath = path.resolve(
      process.cwd(), historyCacheDir, 'runs', targetId, 'url-manifest.json'
    );
    if (!fs.existsSync(cachedPath)) {
      return;
    }

    const manifestPath = this.getManifestPath(targetId);
    const dir = path.dirname(manifestPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(manifestPath)) {
      fs.copyFileSync(cachedPath, manifestPath);
    }
  }

  /**
   * Ensures that all supplied URLs have an entry in the manifest.
   * New entries are created with `discoveredAt = now`; existing entries are unchanged.
   */
  public static ensureEntries(manifest: UrlManifest, urls: string[], now: string): void {
    for (const url of urls) {
      if (!manifest[url]) {
        manifest[url] = {
          url,
          discoveredAt: now,
          lastAttemptedAt: null,
          lastSuccessAt: null,
          lastStatus: null,
          consecutiveFailures: 0,
          cooldownUntil: null,
          contentHash: null
        };
      }
    }
  }

  /**
   * Updates a URL's manifest entry after a scan attempt.
   *
   * - Successful outcomes (COMPLETED, SKIPPED_UNCHANGED) reset `consecutiveFailures` and
   *   update `lastSuccessAt`.
   * - Failure outcomes (TIMEOUT, FAILED, WAF_BLOCKED) increment `consecutiveFailures` and
   *   apply a quarantine cooldown when the failure count crosses the configured thresholds.
   */
  public static recordScanOutcome(
    manifest: UrlManifest,
    url: string,
    status: UrlScanStatus,
    contentHash: string | null,
    now: string,
    config: QuarantineConfig = DEFAULT_QUARANTINE_CONFIG
  ): void {
    const previous = manifest[url];
    const entry: UrlManifestEntry = previous ?? {
      url,
      discoveredAt: now,
      lastAttemptedAt: null,
      lastSuccessAt: null,
      lastStatus: null,
      consecutiveFailures: 0,
      cooldownUntil: null,
      contentHash: null
    };

    entry.lastAttemptedAt = now;
    entry.lastStatus = status;

    const isSuccess = status === 'COMPLETED' || status === 'SKIPPED_UNCHANGED';
    const isFailure = status === 'TIMEOUT' || status === 'FAILED' || status === 'WAF_BLOCKED';

    if (isSuccess) {
      entry.lastSuccessAt = now;
      entry.consecutiveFailures = 0;
      entry.cooldownUntil = null;
      if (contentHash) {
        entry.contentHash = contentHash;
      }
    } else if (isFailure) {
      entry.consecutiveFailures += 1;
      entry.cooldownUntil = this.computeCooldown(entry.consecutiveFailures, now, config);
    }

    manifest[url] = entry;
  }

  /**
   * Returns true if the given entry is currently in a quarantine cooldown period.
   */
  public static isQuarantined(entry: UrlManifestEntry): boolean {
    if (!entry.cooldownUntil) {
      return false;
    }
    const until = Date.parse(entry.cooldownUntil);
    return Number.isFinite(until) && Date.now() < until;
  }

  /**
   * Splits a list of URLs into those that are active (not quarantined) and those
   * that are currently in a quarantine cooldown.
   */
  public static partitionByQuarantine(
    manifest: UrlManifest,
    urls: string[]
  ): { active: string[]; quarantined: string[] } {
    const active: string[] = [];
    const quarantined: string[] = [];
    for (const url of urls) {
      const entry = manifest[url];
      if (entry && this.isQuarantined(entry)) {
        quarantined.push(url);
      } else {
        active.push(url);
      }
    }
    return { active, quarantined };
  }

  /**
   * Splits a list of URLs into those that need scanning (no recent success within
   * `windowDays`) and those that were recently succeeded and can be skipped.
   */
  public static partitionByRecency(
    manifest: UrlManifest,
    urls: string[],
    windowDays: number
  ): { needsScan: string[]; recentlySucceeded: string[] } {
    const needsScan: string[] = [];
    const recentlySucceeded: string[] = [];
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    for (const url of urls) {
      const entry = manifest[url];
      if (!entry?.lastSuccessAt) {
        needsScan.push(url);
        continue;
      }
      const lastSuccessMs = Date.parse(entry.lastSuccessAt);
      if (!Number.isFinite(lastSuccessMs)) {
        needsScan.push(url);
        continue;
      }
      const ageMs = now - lastSuccessMs;
      if (ageMs >= 0 && ageMs <= windowMs) {
        recentlySucceeded.push(url);
      } else {
        needsScan.push(url);
      }
    }

    return { needsScan, recentlySucceeded };
  }

  /**
   * Returns the latest successful scan timestamp recorded for a target.
   */
  public static latestSuccessfulScanAt(manifest: UrlManifest): string | null {
    let latestSuccessAt: string | null = null;

    for (const entry of Object.values(manifest)) {
      if (!entry?.lastSuccessAt) {
        continue;
      }

      const successMs = Date.parse(entry.lastSuccessAt);
      if (!Number.isFinite(successMs)) {
        continue;
      }

      if (!latestSuccessAt || successMs > Date.parse(latestSuccessAt)) {
        latestSuccessAt = entry.lastSuccessAt;
      }
    }

    return latestSuccessAt;
  }

  /**
   * Counts the number of URLs in the manifest that are currently quarantined.
   */
  public static countQuarantined(manifest: UrlManifest): number {
    return Object.values(manifest).filter(e => this.isQuarantined(e)).length;
  }

  private static computeCooldown(
    consecutiveFailures: number,
    now: string,
    config: QuarantineConfig
  ): string | null {
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) {
      return null;
    }

    if (consecutiveFailures >= config.hardThreshold) {
      return new Date(nowMs + config.hardCooldownHours * 60 * 60 * 1000).toISOString();
    }

    if (consecutiveFailures >= config.lightThreshold) {
      return new Date(nowMs + config.lightCooldownHours * 60 * 60 * 1000).toISOString();
    }

    return null;
  }
}
