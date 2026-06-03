import { A11yViolation, PageAlfaAudit } from '../../types/site-quality-spec';
import { NormalizedFinding } from '../../types/normalized-finding';
import actMapping from '../../data/act-mapping.json';

interface AlfaOutcomeLike {
  rule?: string;
  id?: string;
  title?: string;
  description?: string;
  message?: string;
  severity?: string;
  target?: string[];
  html?: string;
  failureSummary?: string;
  helpUrl?: string;
  wcag?: string[];
  section508?: string[];
}

export class NormalizedFindingAdapter {
  public static fromAxeViolations(pageUrl: string, violations: A11yViolation[]): NormalizedFinding[] {
    return (Array.isArray(violations) ? violations : []).flatMap(violation => {
      const instances = Array.isArray(violation.instances) ? violation.instances : [];
      const actIds = this.axeRuleToActIds(violation.id);

      return instances.map((instance, index) => ({
        canonicalRuleKey: `axe:${violation.id}`,
        pageUrl,
        title: violation.id,
        description: violation.description,
        severity: violation.severity,
        sourceEngines: ['axe'],
        standards: {
          act: actIds,
          wcag: (violation.impactedCriteria || []).filter(tag => /^wcag|^\d+\.\d+\.\d+/.test(tag)),
          section508: (violation.impactedCriteria || []).filter(tag => /^508|^section\s*508/i.test(tag))
        },
        sourceMetadata: [
          {
            engine: 'axe',
            ruleId: violation.id,
            ruleName: violation.id,
            helpUrl: violation.helpUrl,
            impact: violation.severity,
            rawEvidenceRef: `axe://${pageUrl}#${violation.id}-${index}`
          }
        ],
        evidence: [
          {
            sourceEngine: 'axe',
            html: instance.html,
            target: instance.target,
            failureSummary: instance.failureSummary,
            rawEvidenceRef: `axe://${pageUrl}#${violation.id}-${index}`
          }
        ]
      }));
    });
  }

  public static fromAlfaAudit(pageUrl: string, alfaAudit: PageAlfaAudit | null | undefined): NormalizedFinding[] {
    if (!alfaAudit || !alfaAudit.executed || !alfaAudit.rawResults) {
      return [];
    }

    const outcomes = this.extractOutcomes(alfaAudit.rawResults);
    return outcomes.map((outcome, index) => {
      // outcome.rule may be a plain string or a nested object like {id, name, uri}
      const ruleId =
        this.extractTextDeep(outcome.rule) ||
        this.extractTextDeep(outcome.id) ||
        `alfa-rule-${index + 1}`;
      // outcome.description / message / title may also be nested objects
      const description =
        this.extractTextDeep(outcome.description) ||
        this.extractTextDeep(outcome.message) ||
        this.extractTextDeep(outcome.title) ||
        ruleId;
      const severity = this.normalizeSeverity(outcome.severity);
      const actIds = this.alfaRuleToActIds(ruleId);
      const target = Array.isArray(outcome.target) ? outcome.target : [];
      const ruleName = this.extractTextDeep(outcome.title) || null;

      return {
        canonicalRuleKey: `alfa:${ruleId}`,
        pageUrl,
        title: ruleId,
        description,
        severity,
        sourceEngines: ['alfa'],
        standards: {
          act: actIds,
          wcag: Array.isArray(outcome.wcag) ? outcome.wcag : [],
          section508: Array.isArray(outcome.section508) ? outcome.section508 : []
        },
        sourceMetadata: [
          {
            engine: 'alfa',
            ruleId,
            ruleName,
            helpUrl: this.normalizeOptionalUrl(outcome.helpUrl),
            impact: severity,
            rawEvidenceRef: `alfa://${pageUrl}#${ruleId}-${index}`
          }
        ],
        evidence: [
          {
            sourceEngine: 'alfa',
            html: this.extractTextDeep(outcome.html),
            target,
            failureSummary: this.extractTextDeep(outcome.failureSummary) || this.extractTextDeep(outcome.message),
            rawEvidenceRef: `alfa://${pageUrl}#${ruleId}-${index}`
          }
        ]
      };
    });
  }

  /**
   * Safely extracts a string from a value that may be a plain string or a
   * nested Alfa object such as { id, name, uri, message, value, description }.
   * Returns '' instead of '[object Object]'.
   */
  private static extractTextDeep(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (!value || typeof value !== 'object') {
      return '';
    }
    const obj = value as Record<string, unknown>;
    // Walk common Alfa field names for nested text; check 'id' first so rule
    // objects like { id: 'sia-r2', name: 'Image alternative', uri: '...' }
    // resolve to their canonical rule ID rather than their human-readable name.
    for (const key of ['id', 'name', 'value', 'uri', 'message', 'title', 'description']) {
      const candidate = obj[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    return '';
  }

  private static extractOutcomes(rawResults: unknown): AlfaOutcomeLike[] {
    if (Array.isArray(rawResults)) {
      return rawResults as AlfaOutcomeLike[];
    }

    if (!rawResults || typeof rawResults !== 'object') {
      return [];
    }

    const payload = rawResults as Record<string, unknown>;
    const outcomes = payload.outcomes;
    if (Array.isArray(outcomes)) {
      return outcomes as AlfaOutcomeLike[];
    }

    const results = payload.results;
    if (Array.isArray(results)) {
      return results as AlfaOutcomeLike[];
    }

    return [];
  }

  private static normalizeSeverity(value: unknown): 'critical' | 'serious' | 'moderate' | 'minor' {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'critical' || normalized === 'serious' || normalized === 'moderate' || normalized === 'minor') {
      return normalized;
    }
    return 'moderate';
  }

  private static normalizeOptionalUrl(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim() === '') {
      return null;
    }

    try {
      const parsed = new URL(value);
      return parsed.toString();
    } catch {
      return null;
    }
  }

  /** Returns the W3C ACT rule IDs that a given axe rule implements. */
  public static axeRuleToActIds(axeRuleId: string): string[] {
    const lookup = actMapping.axeRuleToActIds as Record<string, string[]>;
    return lookup[axeRuleId] ?? [];
  }

  /** Returns the W3C ACT rule IDs that a given alfa rule implements. */
  public static alfaRuleToActIds(alfaRuleId: string): string[] {
    const lookup = actMapping.alfaRuleToActIds as Record<string, string[]>;
    return lookup[alfaRuleId] ?? [];
  }
}