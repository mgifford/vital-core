import { Page } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { A11yViolation } from '../../types/site-quality-spec';

export class LiveWorker {
  /**
   * Executes in-context browser checks before closing the active viewport page
   */
  public static async runLiveAudits(page: Page) {
    const axeBuilder = new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'section508']);

    const rawResults = await axeBuilder.analyze();

    // Map raw axe outputs to our spec-driven ACCESSIBILITY.md bug structure
    const mappedViolations: A11yViolation[] = rawResults.violations.map(v => ({
      id: v.id,
      severity: this.normalizeImpact(v.impact ?? null),
      description: v.description,
      helpUrl: v.helpUrl,
      impactedCriteria: v.tags.filter(tag => tag.includes('wcag') || tag.includes('508')),
      instances: v.nodes.map(node => ({
        html: node.html,
        target: node.target as string[],
        failureSummary: node.failureSummary ?? ''
      }))
    }));

    return {
      lighthouse: {
        performanceScore: 100, // Placeholder target for Phase 5 runner wrapper integration
        energyEstimateKwh: 0.25
      },
      accessibilityViolations: mappedViolations
    };
  }

  private static normalizeImpact(impact: string | null): 'critical' | 'serious' | 'moderate' | 'minor' {
    if (impact === 'critical' || impact === 'serious' || impact === 'moderate' || impact === 'minor') {
      return impact;
    }
    return 'moderate';
  }
}
