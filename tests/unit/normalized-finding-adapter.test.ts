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
    // image-alt implements W3C ACT rule 23a2a8
    expect(parsed.standards.act).toContain('23a2a8');
  });

  it('maps alfa outcomes into canonical normalized findings', () => {
    const alfaAudits: PageAlfaAudit = {
      executed: true,
      findingsCount: 1,
      errorMessage: null,
      rawResults: {
        outcomes: [
          {
            // sia-r2 implements W3C ACT rule 23a2a8 (same as axe image-alt)
            rule: 'sia-r2',
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
    expect(parsed.canonicalRuleKey).toBe('alfa:sia-r2');
    // sia-r2 implements W3C ACT rule 23a2a8
    expect(parsed.standards.act).toContain('23a2a8');
  });

  it('handles alfa outcomes where rule and description are nested objects, not plain strings', () => {
    // Alfa CLI can emit rule as { id, name, uri } and description as { message, ... }
    // String() on these would produce '[object Object]' — the fix must deep-extract text.
    const alfaAudits: PageAlfaAudit = {
      executed: true,
      findingsCount: 1,
      errorMessage: null,
      rawResults: {
        outcomes: [
          {
            rule: { id: 'sia-r2', name: 'Image alternative', uri: 'https://alfa.siteimprove.com/rules/sia-r2' } as unknown as string,
            title: { message: 'Text Alternative' } as unknown as string,
            description: { message: 'Image lacks a text alternative' } as unknown as string,
            severity: 'serious',
            target: ['img.logo'],
            html: '<img src="logo.png">',
            failureSummary: 'Provide a meaningful alt attribute.'
          }
        ]
      }
    };

    const findings = NormalizedFindingAdapter.fromAlfaAudit('https://example.gov', alfaAudits);
    expect(findings.length).toBe(1);
    const f = findings[0];
    expect(f.canonicalRuleKey).toBe('alfa:sia-r2');
    expect(f.description).not.toContain('[object Object]');
    expect(f.description).toBe('Image lacks a text alternative');
    expect(f.sourceMetadata[0].ruleName).not.toBe('[object Object]');
    expect(f.sourceMetadata[0].ruleName).toBe('Text Alternative');
  });
});