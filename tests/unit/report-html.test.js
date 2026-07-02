import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderAccessibilityPage, renderDomainReport } from '../../src/report-html.js';

test('renderDomainReport shows two score trend charts for accessibility and Lighthouse', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const series = [
    {
      week: '2026-W24',
      pagesScanned: 10,
      pagesAudited: 10,
      generatedAt: '2026-06-08T00:00:00.000Z',
      axe: { medianViolations: 4, pagesScanned: 10, pagesWithViolations: 8, rules: {} },
      alfa: { medianFailures: 12, pagesScanned: 4, pagesWithFailures: 3 },
      sustainability: { medianBytes: 204800, medianRequests: 12 },
      plainLanguage: { medianReadingEase: 63 },
      lighthouse: {
        medianPerformance: 71,
        metrics: {
          firstContentfulPaintMs: 1300,
          largestContentfulPaintMs: 2450,
          speedIndexMs: 3100,
          totalBlockingTimeMs: 160,
          cumulativeLayoutShift: 0.14,
        },
      },
      coverage: { axe: 10, alfa: 4, 'plain-language': 3, sustainability: 4, lighthouse: 2 },
    },
    {
      week: '2026-W25',
      pagesScanned: 11,
      pagesAudited: 11,
      generatedAt: '2026-06-15T00:00:00.000Z',
      axe: { medianViolations: 3, pagesScanned: 11, pagesWithViolations: 7, rules: {} },
      alfa: { medianFailures: 10, pagesScanned: 4, pagesWithFailures: 2 },
      sustainability: { medianBytes: 189440, medianRequests: 10 },
      plainLanguage: { medianReadingEase: 65 },
      lighthouse: {
        medianPerformance: 76,
        metrics: {
          firstContentfulPaintMs: 1180,
          largestContentfulPaintMs: 2210,
          speedIndexMs: 2800,
          totalBlockingTimeMs: 120,
          cumulativeLayoutShift: 0.11,
        },
      },
      coverage: { axe: 11, alfa: 4, 'plain-language': 4, sustainability: 4, lighthouse: 2 },
    },
  ];

  const html = renderDomainReport(
    target,
    series[1],
    series[0],
    null,
    series,
    [],
    { byRule: {}, bugsAll: null },
    null
  );

  assert.match(html, /Score trends/);
  assert.match(html, /Accessibility score \(0-100\)/);
  assert.match(html, /Google Lighthouse score \(median\)/);
  assert.doesNotMatch(html, /Largest Contentful Paint \(median\)/);
  assert.doesNotMatch(html, /Median page weight \(KB\)/);
});

test('renderAccessibilityPage shows engine and rule id in bug summaries', () => {
  const target = { key: 'www.example.gov', domain: 'www.example.gov' };
  const summary = {
    week: '2026-W25',
    pagesScanned: 4,
    axe: { rules: { 'image-alt': { count: 2, pages: 2, help: 'Images must have alt text', helpUrl: 'https://example.gov/axe/image-alt', tags: ['wcag111'], examplePages: ['https://example.gov/a'], affectedPages: [{ url: 'https://example.gov/a', instances: 2 }], instances: [{ url: 'https://example.gov/a', target: 'img', html: '<img>' }], impact: 'serious' } } },
    alfa: { rules: { 'sia-r12': { count: 1, pages: 1, ruleUrl: 'https://example.gov/alfa/sia-r12', examplePages: ['https://example.gov/b'], affectedPages: [{ url: 'https://example.gov/b', instances: 1 }], instances: [{ url: 'https://example.gov/b', target: 'a', html: '<a>' }], impact: 'serious' } } },
    consensus: null,
  };
  const bugs = [
    {
      instance_id: 'VS-12345678',
      pattern_id: 'VS-12345678',
      url: 'https://example.gov/a',
      xpath: 'img',
      wcag_sc: '1.1.1',
      wcag_name: 'Non-text Content',
      wcag_level: 'A',
      wcag_version: '2.0',
      wcag_category: 'WCAG 2.0 A',
      rule_id: 'image-alt',
      rule_label: 'Images must have alternative text',
      engine_key: 'axe-core',
      tool: 'axe-core 4.11.0',
      rule_url: 'https://example.gov/axe/image-alt',
      severity: 'Critical',
      frequency: { instances: 2, pages_affected: 2, total_pages_scanned: 4 },
      summary: 'Images must have alternative text (WCAG 1.1.1)',
      description: 'Images must have alternative text. Detected by axe-core rule image-alt on 2 of 4 scanned pages (2 instances).',
      examples: [],
      example_pages: ['https://example.gov/a'],
      affected_pages: ['https://example.gov/a'],
      impact: { groups: [], summary: 'Affects vision users.' },
      testing_environment: 'Automated: axe-core 4.11.0, headless Chromium (Playwright). Manual AT verification: Not captured by automated scan — requires manual testing.',
      steps_to_reproduce: ['Open https://example.gov/a.', 'Locate the affected element.', 'Confirm the axe-core finding for rule image-alt against WCAG 1.1.1 Non-text Content.'],
      remediation_tip: null,
      suggested_fix: 'See remediation guidance: https://example.gov/axe/image-alt',
      default_visible: true,
      priority_tier: 0,
    },
  ];

  const html = renderAccessibilityPage(target, summary, bugs, { byRule: {}, bugsAll: null }, { keyPages: [] });

  assert.match(html, /<span class="engine-badge" data-engine="axe-core">axe<\/span>/);
  assert.match(html, /<span class="rule-badge">image-alt<\/span>/);
  assert.match(html, /Images must have alternative text/);
});