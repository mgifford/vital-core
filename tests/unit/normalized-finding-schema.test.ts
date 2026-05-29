import { describe, expect, it } from 'vitest';
import { NormalizedFindingSchema } from '../../src/types/normalized-finding';

describe('NormalizedFindingSchema', () => {
  it('accepts a dual-engine normalized finding with standards references', () => {
    const parsed = NormalizedFindingSchema.parse({
      canonicalRuleKey: 'image-alt',
      pageUrl: 'https://example.gov/home',
      title: 'Image alt text is missing',
      description: 'One or more meaningful images are missing alternative text.',
      severity: 'serious',
      sourceEngines: ['alfa', 'axe'],
      standards: {
        act: ['ACT-R123'],
        wcag: ['1.1.1'],
        section508: ['501']
      },
      sourceMetadata: [
        {
          engine: 'alfa',
          ruleId: 'R1',
          ruleName: 'Image has text alternative',
          helpUrl: null,
          impact: 'serious',
          rawEvidenceRef: 'alfa://run-1/page-2/finding-1'
        },
        {
          engine: 'axe',
          ruleId: 'image-alt',
          ruleName: 'Image elements must have [alt] attributes',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
          impact: 'serious',
          rawEvidenceRef: 'axe://run-1/page-2/violation-3'
        }
      ],
      evidence: [
        {
          sourceEngine: 'axe',
          html: '<img src="hero.jpg">',
          target: ['img.hero'],
          failureSummary: 'Fix any of the following: Element does not have an alt attribute.',
          rawEvidenceRef: 'axe://run-1/page-2/node-1'
        }
      ]
    });

    expect(parsed.canonicalRuleKey).toBe('image-alt');
    expect(parsed.sourceEngines).toEqual(['alfa', 'axe']);
    expect(parsed.standards.wcag).toContain('1.1.1');
  });

  it('rejects findings without provenance metadata', () => {
    const result = NormalizedFindingSchema.safeParse({
      canonicalRuleKey: 'color-contrast',
      pageUrl: 'https://example.gov/home',
      title: 'Insufficient color contrast',
      description: 'Text color contrast is too low.',
      severity: 'serious',
      sourceEngines: ['axe'],
      standards: {
        act: [],
        wcag: ['1.4.3'],
        section508: []
      },
      sourceMetadata: [],
      evidence: []
    });

    expect(result.success).toBe(false);
  });
});
