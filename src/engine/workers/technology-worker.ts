import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
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
  private static readonly LOCAL_WAPPALYZER_NEXT_PATH = path.resolve(process.cwd(), '.tools', 'wappalyzer-next', 'bin', 'wappalyzer');

  public static async detectTechnologyStack(
    url: string,
    command = process.env.VITAL_WAPPALYZER_CMD || '',
    runner: ExecRunner = execFileAsync as ExecRunner
  ): Promise<TechnologyEntry[]> {
    const attempts = this.buildCommandAttempts(command, url);
    let lastErrorMessage = 'wappalyzer-next command unavailable';

    if (attempts.length === 0) {
      console.warn(`⚠️ Technology fingerprinting skipped for ${url}: ${lastErrorMessage}`);
      return [];
    }

    for (const attempt of attempts) {
      try {
        const { stdout } = await runner(
          attempt.file,
          attempt.args,
          { timeout: this.DEFAULT_TIMEOUT_MS, maxBuffer: this.DEFAULT_MAX_BUFFER }
        );

        return this.parseTechnologyEntries(stdout, url);
      } catch (error: any) {
        const fallbackStdout = this.extractStdout(error);
        if (fallbackStdout) {
          try {
            return this.parseTechnologyEntries(fallbackStdout, url);
          } catch {
            // Keep trying subsequent command attempts.
          }
        }

        lastErrorMessage = error?.message || String(error);
      }
    }

    console.warn(`⚠️ Technology fingerprinting skipped for ${url}: ${lastErrorMessage}`);
    return [];
  }

  private static parseTechnologyEntries(stdout: string, url: string): TechnologyEntry[] {
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
  }

  private static buildCommandAttempts(command: string, url: string): Array<{ file: string; args: string[] }> {
    // full scan is required — balanced returns no results for many gov sites.
    // -oJ without a filename argument writes JSON to stdout.
    const args = ['--scan-type', 'full', '-oJ', '-i', url];
    const attempts: Array<{ file: string; args: string[] }> = [];

    if (command && command.trim() !== '') {
      attempts.push({ file: command, args });
    }

    if (fs.existsSync(this.LOCAL_WAPPALYZER_NEXT_PATH) && command !== this.LOCAL_WAPPALYZER_NEXT_PATH) {
      attempts.push({ file: this.LOCAL_WAPPALYZER_NEXT_PATH, args });
    }

    return attempts;
  }

  private static extractStdout(error: unknown): string {
    if (!error || typeof error !== 'object') {
      return '';
    }

    const maybe = error as { stdout?: unknown };
    return typeof maybe.stdout === 'string' ? maybe.stdout : '';
  }

  private static parseJson(stdout: string): WappalyzerResponse {
    const text = stdout.trim();
    const jsonStart = text.indexOf('{');
    if (jsonStart < 0) {
      throw new Error('wappalyzer-next output did not include JSON payload');
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
