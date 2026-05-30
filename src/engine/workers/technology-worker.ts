import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PageScanReport } from '../../types/site-quality-spec';

type TechnologyEntry = PageScanReport['technologyStack'][number];

interface WappalyzerTechnology {
  version?: string | null;
  categories?: string[];
  groups?: string[];
}

type WappalyzerResponse = Record<string, Record<string, WappalyzerTechnology>>;

type ExecRunner = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number }
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);

export class TechnologyWorker {
  private static readonly DEFAULT_TIMEOUT_MS = 45000;
  private static readonly DEFAULT_MAX_BUFFER = 2 * 1024 * 1024;

  public static async detectTechnologyStack(
    url: string,
    command = process.env.VITAL_WAPPALYZER_CMD || 'wappalyzer',
    runner: ExecRunner = execFileAsync as ExecRunner
  ): Promise<TechnologyEntry[]> {
    try {
      const { stdout } = await runner(
        command,
        ['-i', url, '--scan-type', 'balanced', '-oJ', '-'],
        { timeout: this.DEFAULT_TIMEOUT_MS, maxBuffer: this.DEFAULT_MAX_BUFFER }
      );

      const parsed = this.parseJson(stdout);
      const technologyMap = this.getUrlResults(parsed, url);
      if (!technologyMap) {
        return [];
      }

      return Object.entries(technologyMap)
        .map(([name, details]) => ({
          name,
          category: this.pickCategory(details),
          version: details.version && details.version.trim() !== '' ? details.version.trim() : null
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error: any) {
      console.warn(`⚠️ Technology fingerprinting skipped for ${url}: ${error.message}`);
      return [];
    }
  }

  private static parseJson(stdout: string): WappalyzerResponse {
    const text = stdout.trim();
    const jsonStart = text.indexOf('{');
    if (jsonStart < 0) {
      throw new Error('wappalyzer output did not include JSON payload');
    }

    return JSON.parse(text.slice(jsonStart)) as WappalyzerResponse;
  }

  private static getUrlResults(parsed: WappalyzerResponse, url: string): Record<string, WappalyzerTechnology> | null {
    const direct = parsed[url];
    if (direct) {
      return direct;
    }

    const withTrailingSlash = parsed[`${url}/`];
    if (withTrailingSlash) {
      return withTrailingSlash;
    }

    const withoutTrailingSlash = parsed[url.replace(/\/$/, '')];
    if (withoutTrailingSlash) {
      return withoutTrailingSlash;
    }

    const first = Object.values(parsed)[0];
    return first ?? null;
  }

  private static pickCategory(details: WappalyzerTechnology): string {
    const category = details.categories?.find(Boolean);
    if (category) {
      return category;
    }

    const group = details.groups?.find(Boolean);
    if (group) {
      return group;
    }

    return 'Unknown';
  }
}
