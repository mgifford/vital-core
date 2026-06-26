import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBugReports } from '../../src/lib/bug-report.js';

function makeSummary(pagesAffected) {
  return {
    pagesScanned: 20,
    domain: 'www.example.gov',
    axe: {
      rules: {
        'image-alt': {
          pages: pagesAffected,
          count: 3,
          impact: 'serious',
          help: 'Images must have alternative text',
          tags: ['wcag111'],
          instances: [{ url: 'https://www.example.gov/a', target: 'img', html: '<img>' }],
          examplePages: ['https://www.example.gov/a'],
          affectedPages: [{ url: 'https://www.example.gov/a', instances: 3 }],
        },
      },
    },
    alfa: { rules: {} },
    deprecatedHtml: { rules: {} },
  };
}

function bug(pagesAffected, threshold) {
  const target = { key: 'www.example.gov', domain: 'www.example.gov', reporting: {} };
  if (threshold !== undefined) target.reporting.template_page_threshold = threshold;
  return buildBugReports(target, makeSummary(pagesAffected))[0];
}

test('pages_affected=1 → content', () => {
  assert.equal(bug(1).likely_source, 'content');
});

test('pages_affected=2 → content (upper boundary)', () => {
  assert.equal(bug(2).likely_source, 'content');
});

test('pages_affected=3 → unknown (between boundaries)', () => {
  assert.equal(bug(3).likely_source, 'unknown');
});

test('pages_affected=9 → unknown (below default threshold)', () => {
  assert.equal(bug(9).likely_source, 'unknown');
});

test('pages_affected=10 → template (at default threshold)', () => {
  assert.equal(bug(10).likely_source, 'template');
});

test('pages_affected=11 → template (above default threshold)', () => {
  assert.equal(bug(11).likely_source, 'template');
});

test('custom threshold=5: pages_affected=5 → template', () => {
  assert.equal(bug(5, 5).likely_source, 'template');
});

test('custom threshold=5: pages_affected=4 → unknown', () => {
  assert.equal(bug(4, 5).likely_source, 'unknown');
});
