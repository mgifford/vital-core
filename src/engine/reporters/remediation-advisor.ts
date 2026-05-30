import * as fs from 'fs';
import * as path from 'path';

export type SupplementalRemediation = {
  source: 'curated-purple-ai';
  confidence: 'HIGH' | 'MEDIUM';
  advice: string;
  ruleId: string;
  matchedLabel: string;
  catalogLastUpdated: string | null;
};

type PurpleCatalog = {
  lastUpdated?: string;
  [ruleId: string]: unknown;
};

type PurpleRuleResults = Record<string, string>;

/**
 * Optional advisory layer that reads Purple-AI rule mappings.
 * Primary remediation remains axe/deque guidance already present in findings.
 */
export class RemediationAdvisor {
  private static readonly DEFAULT_PURPLE_AI_DIR = path.resolve(process.cwd(), 'tools/submodules/purple-ai');
  private static readonly ROLE_AWARE_RULES = new Set([
    'aria-allowed-attr',
    'aria-hidden-focus',
    'aria-input-field-name',
    'aria-required-attr',
    'aria-required-children',
    'aria-required-parent',
    'aria-roles',
    'aria-toggle-field-name',
    'aria-valid-attr',
    'aria-valid-attr-value',
    'aria-allowed-role'
  ]);

  private readonly baseDir: string;
  private readonly catalog: PurpleCatalog | null;
  private readonly resultsCache = new Map<string, PurpleRuleResults | null>();

  constructor() {
    this.baseDir = path.resolve(process.env.VITAL_PURPLE_AI_DIR || RemediationAdvisor.DEFAULT_PURPLE_AI_DIR);
    this.catalog = this.loadCatalog();
  }

  public getSupplemental(ruleId: string, htmlSnippet: string): SupplementalRemediation | null {
    if (!this.catalog) {
      return null;
    }

    const labels = this.catalog[ruleId];
    if (!Array.isArray(labels) || labels.length === 0) {
      return null;
    }

    const ruleResults = this.loadRuleResults(ruleId);
    if (!ruleResults) {
      return null;
    }

    const currentLabel = this.createBasicHtmlLabel(ruleId, htmlSnippet);
    const exactAdvice = currentLabel ? ruleResults[currentLabel] : undefined;
    if (exactAdvice) {
      return {
        source: 'curated-purple-ai',
        confidence: 'HIGH',
        advice: exactAdvice,
        ruleId,
        matchedLabel: currentLabel,
        catalogLastUpdated: this.getCatalogLastUpdated()
      };
    }

    const fuzzy = this.findFuzzyLabelMatch(labels, ruleResults, htmlSnippet);
    if (!fuzzy) {
      return null;
    }

    return {
      source: 'curated-purple-ai',
      confidence: 'MEDIUM',
      advice: fuzzy.advice,
      ruleId,
      matchedLabel: fuzzy.label,
      catalogLastUpdated: this.getCatalogLastUpdated()
    };
  }

  private loadCatalog(): PurpleCatalog | null {
    const catalogPath = path.join(this.baseDir, 'catalog.json');
    if (!fs.existsSync(catalogPath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(catalogPath, 'utf8');
      const parsed = JSON.parse(raw) as PurpleCatalog;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  private loadRuleResults(ruleId: string): PurpleRuleResults | null {
    if (this.resultsCache.has(ruleId)) {
      return this.resultsCache.get(ruleId) || null;
    }

    const resultPath = path.join(this.baseDir, 'results', `${ruleId}.json`);
    if (!fs.existsSync(resultPath)) {
      this.resultsCache.set(ruleId, null);
      return null;
    }

    try {
      const raw = fs.readFileSync(resultPath, 'utf8');
      const parsed = JSON.parse(raw) as PurpleRuleResults;
      const valid = parsed && typeof parsed === 'object' ? parsed : null;
      this.resultsCache.set(ruleId, valid);
      return valid;
    } catch {
      this.resultsCache.set(ruleId, null);
      return null;
    }
  }

  private findFuzzyLabelMatch(
    labels: unknown[],
    ruleResults: PurpleRuleResults,
    htmlSnippet: string
  ): { label: string; advice: string } | null {
    const currentTokens = new Set(this.extractLabelTokens(htmlSnippet));
    if (currentTokens.size === 0) {
      return null;
    }

    let bestLabel: string | null = null;
    let bestAdvice: string | null = null;
    let bestScore = 0;

    for (const rawLabel of labels) {
      if (typeof rawLabel !== 'string') {
        continue;
      }
      const advice = ruleResults[rawLabel];
      if (!advice) {
        continue;
      }

      const labelTokens = rawLabel.split('_').filter(Boolean);
      const matches = labelTokens.filter(token => currentTokens.has(token)).length;
      if (matches >= 3 && matches > bestScore) {
        bestScore = matches;
        bestLabel = rawLabel;
        bestAdvice = advice;
      }
    }

    return bestLabel && bestAdvice ? { label: bestLabel, advice: bestAdvice } : null;
  }

  private createBasicHtmlLabel(ruleId: string, htmlSnippet: string): string {
    const tokens = this.extractLabelTokens(htmlSnippet);
    if (tokens.length === 0) {
      return '';
    }

    if (RemediationAdvisor.ROLE_AWARE_RULES.has(ruleId)) {
      const roleMatch = htmlSnippet.match(/role\s*=\s*"[^"]*"/i)?.[0];
      if (roleMatch) {
        return `${tokens[0]}_${roleMatch.replace(/\s+/g, '')}`;
      }
    }

    return tokens.join('_');
  }

  private extractLabelTokens(htmlSnippet: string): string[] {
    const tokens = htmlSnippet.match(/((?<=[<])\s*([a-zA-Z][^\s>/]*)\b)|([\w-]+)\s*(?==\s*["'][^"']*["'])/g);
    return tokens ? tokens.map(token => token.trim()).filter(Boolean) : [];
  }

  private getCatalogLastUpdated(): string | null {
    if (!this.catalog || typeof this.catalog.lastUpdated !== 'string') {
      return null;
    }
    return this.catalog.lastUpdated;
  }
}