import * as fs from 'fs';
import * as path from 'path';

export interface PageStateEntry {
  etag: string | null;
  lastModified: string | null;
  contentHash: string | null;
  assetFingerprintHash: string | null;
  lastCheckedAt: string;
  lastScannedAt: string;
}

export type PageStateMap = Record<string, PageStateEntry>;

export class PageStateCache {
  private static get runsDir(): string {
    return path.resolve(process.cwd(), 'dist/runs');
  }

  private static get stateFilePath(): string {
    return path.join(this.runsDir, 'page-state.json');
  }

  public static load(): PageStateMap {
    this.restoreCachedState();

    if (!fs.existsSync(this.stateFilePath)) {
      return {};
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFilePath, 'utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }

      const entries = Object.entries(parsed as Record<string, unknown>);
      const state: PageStateMap = {};

      for (const [url, value] of entries) {
        if (!value || typeof value !== 'object') {
          continue;
        }

        const candidate = value as Record<string, unknown>;
        state[url] = {
          etag: typeof candidate.etag === 'string' ? candidate.etag : null,
          lastModified: typeof candidate.lastModified === 'string' ? candidate.lastModified : null,
          contentHash: typeof candidate.contentHash === 'string' ? candidate.contentHash : null,
          assetFingerprintHash:
            typeof candidate.assetFingerprintHash === 'string' ? candidate.assetFingerprintHash : null,
          lastCheckedAt: typeof candidate.lastCheckedAt === 'string' ? candidate.lastCheckedAt : '',
          lastScannedAt: typeof candidate.lastScannedAt === 'string' ? candidate.lastScannedAt : ''
        };
      }

      return state;
    } catch {
      return {};
    }
  }

  public static save(state: PageStateMap): void {
    if (!fs.existsSync(this.runsDir)) {
      fs.mkdirSync(this.runsDir, { recursive: true });
    }

    fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), 'utf8');
  }

  private static restoreCachedState(): void {
    const historyCacheDir = process.env.VITAL_HISTORY_CACHE_DIR;
    if (!historyCacheDir) {
      return;
    }

    const cachedStatePath = path.resolve(process.cwd(), historyCacheDir, 'runs/page-state.json');
    if (!fs.existsSync(cachedStatePath)) {
      return;
    }

    if (!fs.existsSync(this.runsDir)) {
      fs.mkdirSync(this.runsDir, { recursive: true });
    }

    if (!fs.existsSync(this.stateFilePath)) {
      fs.copyFileSync(cachedStatePath, this.stateFilePath);
    }
  }
}
