import { describe, expect, it } from 'vitest';
import { NormalizedFindingSchema } from '../../src/types/normalized-finding';
import { A11yViolation, PageAlfaAudit } from '../../src/types/site-quality-spec';
import { NormalizedFindingAdapter } from '../../src/engine/reporters/normalized-finding-adapter';

describe('NormalizedFindingAdapter', () => {
  it('maps axe violations into canonical normalized findings', () => {
    const violations: A11yViolation[] = [
      {
        id: 'image-alt',
        severity: 'serious',
        description: 'Images must have alternate text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
        impactedCriteria: ['wcag2a', '1.1.1', 'section508-501'],
        instances: [
          {
            html: '<img src="hero.jpg">',
            target: ['img.hero'],
            failureSummary: 'Element does not have an alt attribute.'
          }
        ]
      }
    ];

    const findings = NormalizedFindingAdapter.fromAxeViolations('https://example.gov', violations);

    expect(findings.length).toBe(1);
    const parsed = NormalizedFindingSchema.parse(findings[0]);
    expect(parsed.sourceEngines).toEqual(['axe']);
    expect(parsed.canonicalRuleKey).toBe('axe:image-alt');
  });

  it('maps alfa outcomes into canonical normalized findings', () => {
    const alfaAudits: PageAlfaAudit = {
      executed: true,
      findingsCount: 1,
      errorMessage: null,
      rawResults: {
        outcomes: [
          {
            rule: 'text-alt',
            title: 'Text Alternative',
            message: 'Image lacks a text alternative',
            severity: 'serious',
            target: ['img.hero'],
            html: '<img src="hero.jpg">',
            failureSummary: 'Provide a meaningful alt attribute.'
          }
        ]
      }
    };

    const findings = NormalizedFindingAdapter.fromAlfaAudit('https://example.gov', alfaAudits);

    expect(findings.length).toBe(1);
    const parsed = NormalizedFindingSchema.parse(findings[0]);
    expect(parsed.sourceEngines).toEqual(['alfa']);
    expect(parsed.canonicalRuleKey).toBe('alfa:text-alt');
  });
});