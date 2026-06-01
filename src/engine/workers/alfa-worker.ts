import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { A11yViolation, PageAlfaAudit } from '../../types/site-quality-spec';
import { LiveWorker } from './live-worker';

type ExecRunner = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number }
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);

export class AlfaWorker {
  private static readonly DEFAULT_TIMEOUT_MS = 45000;
  private static readonly DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

  public static async runAlfaAudits(
    url: string,
    command = process.env.VITAL_ALFA_CMD || 'alfa',
    runner: ExecRunner = execFileAsync as ExecRunner,
    htmlSnapshotPath?: string
  ): Promise<PageAlfaAudit> {
    const auditTarget = htmlSnapshotPath ? `file://${htmlSnapshotPath}` : url;
    const commandAttempts = this.buildCommandAttempts(command, auditTarget);
    const attemptErrors: string[] = [];

    for (const attempt of commandAttempts) {
      try {
        const { stdout, stderr } = await runner(attempt.file, attempt.args, {
          timeout: this.DEFAULT_TIMEOUT_MS,
          maxBuffer: this.DEFAULT_MAX_BUFFER
        });

        if (stderr && stderr.trim()) {
          console.debug(`[alfa] stderr from '${attempt.file}': ${stderr.trim().slice(0, 500)}`);
        }

        const rawResults = this.parseJson(stdout);
        return {
          executed: true,
          findingsCount: this.estimateFindingsCount(rawResults),
          errorMessage: null,
          rawResults
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        attemptErrors.push(`[${attempt.file}]: ${msg.slice(0, 300)}`);
        // Try the next command signature.
      }
    }

    const detail = attemptErrors.map((e, i) => `  attempt ${i + 1}: ${e}`).join('\n');
    const message = `Alfa scan skipped for ${url}: command '${command}' unavailable or failed.`;
    console.warn(`⚠️ ${message}\n${detail}`);

    return {
      executed: false,
      findingsCount: null,
      errorMessage: message,
      rawResults: null
    };
  }

  private static buildCommandAttempts(command: string, url: string): Array<{ file: string; args: string[] }> {
    // alfa CLI requires the 'audit' subcommand and '--format json' (not '-f json').
    // @siteimprove/alfa-formatter-json must be installed for JSON output to work.
    const alfaArgs = ['audit', '--format', 'json', '--outcome', 'failed', '--timeout', '30000', url];
    const attempts: Array<{ file: string; args: string[] }> = [
      { file: command, args: alfaArgs }
    ];

    // Fallback: try the local node_modules binary when command is unresolvable
    const localBin = path.resolve(process.cwd(), 'node_modules/.bin/alfa');
    if (command !== localBin) {
      attempts.push({ file: localBin, args: alfaArgs });
    }

    if (command === 'alfa' || command === localBin) {
      attempts.push(
        { file: 'npx', args: ['--yes', '@siteimprove/alfa-cli', ...alfaArgs] }
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

  /**
   * Converts an alfa audit's raw results into the normalized A11yViolation[] format.
   * Violations are grouped by rule ID so each rule produces a single A11yViolation
   * entry with one instance per failing element, matching the axe output shape.
   */
  public static toA11yViolations(alfaAudit: PageAlfaAudit): A11yViolation[] {
    if (!alfaAudit || !alfaAudit.executed || !alfaAudit.rawResults) {
      return [];
    }

    const outcomes = this.extractOutcomes(alfaAudit.rawResults);

    // Group by rule ID — A11yViolation has one entry per rule with multiple instances.
    const ruleMap = new Map<string, {
      id: string;
      severity: 'critical' | 'serious' | 'moderate' | 'minor';
      description: string;
      helpUrl: string;
      impactedCriteria: string[];
      wcagVersion: '2.0' | '2.1' | '2.2' | 'section508' | 'best-practice';
      instances: Array<{ html: string; target: string[]; failureSummary: string }>;
    }>();

    for (const outcome of outcomes) {
      const ruleId = String((outcome as Record<string, unknown>).rule || (outcome as Record<string, unknown>).id || '').trim();
      if (!ruleId) continue;

      const raw = outcome as Record<string, unknown>;
      const wcagArr = Array.isArray(raw.wcag) ? (raw.wcag as unknown[]).map(String) : [];
      const section508Arr = Array.isArray(raw.section508) ? (raw.section508 as unknown[]).map(String) : [];
      const impactedCriteria = [...wcagArr, ...section508Arr];
      const wcagVersion = LiveWorker.classifyWcagVersion(wcagArr);

      const rawHelpUrl = typeof raw.helpUrl === 'string' ? raw.helpUrl.trim() : '';
      let helpUrl: string;
      try {
        new URL(rawHelpUrl);
        helpUrl = rawHelpUrl;
      } catch {
        helpUrl = `https://alfa.siteimprove.com/rules/${encodeURIComponent(ruleId)}`;
      }

      if (!ruleMap.has(ruleId)) {
        ruleMap.set(ruleId, {
          id: ruleId,
          severity: this.normalizeAlfaSeverity(raw.severity),
          description: String(raw.description || raw.message || raw.title || ruleId),
          helpUrl,
          impactedCriteria,
          wcagVersion,
          instances: []
        });
      }

      const group = ruleMap.get(ruleId)!;
      group.instances.push({
        html: String(raw.html || ''),
        target: Array.isArray(raw.target) ? (raw.target as unknown[]).map(String) : [],
        failureSummary: String(raw.failureSummary || raw.message || '')
      });
    }

    return Array.from(ruleMap.values()).map(group => ({
      ...group,
      sourceEngine: 'alfa' as const
    }));
  }

  private static extractOutcomes(rawResults: unknown): unknown[] {
    if (Array.isArray(rawResults)) {
      return rawResults;
    }

    if (!rawResults || typeof rawResults !== 'object') {
      return [];
    }

    const payload = rawResults as Record<string, unknown>;
    if (Array.isArray(payload.outcomes)) return payload.outcomes;
    if (Array.isArray(payload.results)) return payload.results;
    return [];
  }

  private static normalizeAlfaSeverity(value: unknown): 'critical' | 'serious' | 'moderate' | 'minor' {
    const s = String(value || '').toLowerCase();
    if (s === 'critical' || s === 'serious' || s === 'moderate' || s === 'minor') return s;
    return 'moderate';
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