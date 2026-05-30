import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PageAlfaAudit } from '../../types/site-quality-spec';

type ExecRunner = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number }
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);

export class AlfaWorker {
  private static readonly DEFAULT_TIMEOUT_MS = 45000;
  private static readonly DEFAULT_MAX_BUFFER = 2 * 1024 * 1024;

  public static async runAlfaAudits(
    url: string,
    command = process.env.VITAL_ALFA_CMD || 'alfa',
    runner: ExecRunner = execFileAsync as ExecRunner
  ): Promise<PageAlfaAudit> {
    const commandAttempts = this.buildCommandAttempts(command, url);

    for (const attempt of commandAttempts) {
      try {
        const { stdout } = await runner(attempt.file, attempt.args, {
          timeout: this.DEFAULT_TIMEOUT_MS,
          maxBuffer: this.DEFAULT_MAX_BUFFER
        });

        const rawResults = this.parseJson(stdout);
        return {
          executed: true,
          findingsCount: this.estimateFindingsCount(rawResults),
          errorMessage: null,
          rawResults
        };
      } catch {
        // Try the next command signature.
      }
    }

    const message = `Alfa scan skipped for ${url}: command '${command}' unavailable or failed.`;
    console.warn(`⚠️ ${message}`);

    return {
      executed: false,
      findingsCount: null,
      errorMessage: message,
      rawResults: null
    };
  }

  private static buildCommandAttempts(command: string, url: string): Array<{ file: string; args: string[] }> {
    const attempts: Array<{ file: string; args: string[] }> = [
      { file: command, args: ['--format', 'json', url] },
      { file: command, args: ['audit', '--format', 'json', url] }
    ];

    if (command === 'alfa') {
      attempts.push(
        { file: 'npx', args: ['--yes', '@siteimprove/alfa-cli', '--format', 'json', url] },
        { file: 'npx', args: ['--yes', '@siteimprove/alfa-cli', 'audit', '--format', 'json', url] }
      );
    }

    return attempts;
  }

  private static parseJson(stdout: string): unknown {
    const text = String(stdout || '').trim();
    const objectStart = text.indexOf('{');
    const arrayStart = text.indexOf('[');

    let start = -1;
    if (objectStart >= 0 && arrayStart >= 0) {
      start = Math.min(objectStart, arrayStart);
    } else if (objectStart >= 0) {
      start = objectStart;
    } else if (arrayStart >= 0) {
      start = arrayStart;
    }

    if (start < 0) {
      throw new Error('Alfa output did not include JSON payload.');
    }

    return JSON.parse(text.slice(start));
  }

  private static estimateFindingsCount(rawResults: unknown): number | null {
    if (Array.isArray(rawResults)) {
      return rawResults.length;
    }

    if (!rawResults || typeof rawResults !== 'object') {
      return null;
    }

    const payload = rawResults as Record<string, unknown>;
    const collectionKeys = ['outcomes', 'results', 'violations', 'issues', 'findings'];

    for (const key of collectionKeys) {
      const value = payload[key];
      if (Array.isArray(value)) {
        return value.length;
      }
    }

    return null;
  }
}