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
      const raw = outcome as Record<string, unknown>;
      const ruleId = this.extractRuleId(raw);
      if (!ruleId) continue;
      const wcagArr = Array.isArray(raw.wcag) ? (raw.wcag as unknown[]).map(String) : [];
      const section508Arr = Array.isArray(raw.section508) ? (raw.section508 as unknown[]).map(String) : [];
      const impactedCriteria = [...wcagArr, ...section508Arr];
      const wcagVersion = LiveWorker.classifyWcagVersion(wcagArr);

      const rawHelpUrl = this.extractHelpUrl(raw);
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
          description: this.extractPreferredText(raw.description, raw.message, raw.title, ruleId),
          helpUrl,
          impactedCriteria,
          wcagVersion,
          instances: []
        });
      }

      const group = ruleMap.get(ruleId)!;
      group.instances.push({
        html: this.extractPreferredText(raw.html),
        target: this.extractTargetSelectors(raw.target),
        failureSummary: this.extractPreferredText(raw.failureSummary, raw.message)
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

  private static extractRuleId(raw: Record<string, unknown>): string {
    const direct = this.extractPreferredText(raw.rule, raw.id);
    if (direct && direct !== '[object Object]') {
      return this.normalizeRuleIdentifier(direct);
    }

    const ruleObj = raw.rule;
    if (ruleObj && typeof ruleObj === 'object') {
      const candidate = this.extractPreferredText(
        (ruleObj as Record<string, unknown>).id,
        (ruleObj as Record<string, unknown>).name,
        (ruleObj as Record<string, unknown>).uri,
        (ruleObj as Record<string, unknown>).rule
      );
      return this.normalizeRuleIdentifier(candidate);
    }

    return '';
  }

  private static extractHelpUrl(raw: Record<string, unknown>): string {
    const direct = this.extractPreferredText(raw.helpUrl);
    if (direct && this.isHttpUrl(direct)) {
      return direct;
    }

    const ruleObj = raw.rule;
    if (ruleObj && typeof ruleObj === 'object') {
      const fromRule = this.extractPreferredText((ruleObj as Record<string, unknown>).uri);
      if (fromRule && this.isHttpUrl(fromRule)) {
        return fromRule;
      }
    }

    return '';
  }

  private static extractTargetSelectors(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map(item => this.extractPreferredText(item)).filter(Boolean);
    }

    const single = this.extractPreferredText(value);
    return single ? [single] : [];
  }

  private static extractPreferredText(...candidates: unknown[]): string {
    for (const candidate of candidates) {
      const text = this.toText(candidate);
      if (text) {
        return text;
      }
    }
    return '';
  }

  private static toText(value: unknown): string {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed && trimmed !== '[object Object]' ? trimmed : '';
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (!value || typeof value !== 'object') {
      return '';
    }

    const obj = value as Record<string, unknown>;
    const nested = this.extractPreferredText(obj.value, obj.name, obj.id, obj.uri, obj.message, obj.title, obj.description);
    if (nested) {
      return nested;
    }

    try {
      const json = JSON.stringify(value);
      return json === '{}' ? '' : json;
    } catch {
      return '';
    }
  }

  private static normalizeRuleIdentifier(rawRuleId: string): string {
    const normalized = rawRuleId.trim();
    if (!normalized) {
      return '';
    }

    if (this.isHttpUrl(normalized)) {
      try {
        const parsed = new URL(normalized);
        const tail = parsed.pathname.split('/').filter(Boolean).pop();
        return tail || normalized;
      } catch {
        return normalized;
      }
    }

    return normalized;
  }

  private static isHttpUrl(value: string): boolean {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
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