import { Page } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { A11yViolation } from '../../types/site-quality-spec';

export class LiveWorker {
  /**
   * Executes in-context browser checks before closing the active viewport page
   */
  public static async runLiveAudits(page: Page) {
    const axeBuilder = new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'section508']);

    const rawResults = await axeBuilder.analyze();

    // Map raw axe outputs to our spec-driven ACCESSIBILITY.md bug structure
    const mappedViolations: A11yViolation[] = rawResults.violations.map(v => ({
      id: v.id,
      severity: this.normalizeImpact(v.impact ?? null),
      description: v.description,
      helpUrl: v.helpUrl,
      impactedCriteria: v.tags.filter(tag => tag.includes('wcag') || tag.includes('508')),
      wcagVersion: this.classifyWcagVersion(v.tags),
      instances: v.nodes.map(node => ({
        html: node.html,
        target: node.target as string[],
        failureSummary: node.failureSummary ?? ''
      }))
    }));

    return {
      lighthouse: null,
      accessibilityViolations: mappedViolations
    };
  }

  /**
   * Returns the minimum WCAG version that first introduced this criterion.
   * WCAG 2.1 adds new SCs on top of 2.0; 2.2 adds new SCs on top of 2.1.
   * Tags are exclusive per version in axe-core: wcag22aa = 2.2 addition,
   * wcag21aa = 2.1 addition, wcag2aa = 2.0 original.
   */
  public static classifyWcagVersion(tags: string[]): '2.0' | '2.1' | '2.2' | 'section508' | 'best-practice' {
    const t = tags.map(s => String(s || '').toLowerCase());
    if (t.some(s => s.startsWith('wcag22'))) return '2.2';
    if (t.some(s => s.startsWith('wcag21'))) return '2.1';
    if (t.some(s => s === 'wcag2a' || s === 'wcag2aa' || s === 'wcag2aaa')) return '2.0';
    if (t.some(s => s.includes('508'))) return 'section508';
    return 'best-practice';
  }

  private static normalizeImpact(impact: string | null): 'critical' | 'serious' | 'moderate' | 'minor' {
    if (impact === 'critical' || impact === 'serious' || impact === 'moderate' || impact === 'minor') {
      return impact;
    }
    return 'moderate';
  }
}
