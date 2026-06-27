import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDomainReport, renderArchivePage } from '../../src/report-html.js';

const summary = {
  week: '2026-W25',
  pagesScanned: 20,
  pagesAudited: 20,
  generatedAt: '2026-06-23T00:00:00.000Z',
  axe: { medianViolations: 4, pagesScanned: 20, pagesWithViolations: 12, rules: {} },
  alfa: { medianFailures: 8, pagesScanned: 10, pagesWithFailures: 6 },
  coverage: {},
};

function makeTarget(scoreFormat) {
  const t = { key: 'www.example.gov', domain: 'www.example.gov' };
  if (scoreFormat !== undefined) t.display = { score_format: scoreFormat };
  return t;
}

test('score_format both: shows letter grade and numeric score', () => {
  const html = renderDomainReport(makeTarget('both'), summary, null, null, [summary]);
  assert.match(html, /class="grade grade-[A-F]"/);
  assert.match(html, /class="score"/);
  assert.match(html, /class="scorecard"/);
});

test('score_format letter: shows letter grade, no numeric score span', () => {
  const html = renderDomainReport(makeTarget('letter'), summary, null, null, [summary]);
  assert.match(html, /class="grade grade-[A-F]"/);
  assert.doesNotMatch(html, /class="score"/);
  assert.match(html, /class="scorecard"/);
});

test('score_format percent: shows numeric score span, no letter grade', () => {
  const html = renderDomainReport(makeTarget('percent'), summary, null, null, [summary]);
  assert.doesNotMatch(html, /class="grade grade-[A-F]"/);
  assert.match(html, /class="score"/);
  assert.match(html, /class="scorecard"/);
});

test('score_format none: suppresses scorecard entirely', () => {
  const html = renderDomainReport(makeTarget('none'), summary, null, null, [summary]);
  assert.doesNotMatch(html, /class="scorecard"/);
  assert.doesNotMatch(html, /class="score"/);
});

test('score_format unset: defaults to both', () => {
  const html = renderDomainReport(makeTarget(undefined), summary, null, null, [summary]);
  assert.match(html, /class="grade grade-[A-F]"/);
  assert.match(html, /class="score"/);
});

test('archive page: score_format both shows grade and number', () => {
  const html = renderArchivePage(makeTarget('both'), [summary], '2026-W25');
  assert.match(html, /class="grade grade-[A-F]"/);
  assert.match(html, /\d{2,3}/); // numeric score present
});

test('archive page: score_format none shows n/a', () => {
  const html = renderArchivePage(makeTarget('none'), [summary], '2026-W25');
  assert.doesNotMatch(html, /class="grade/);
  assert.match(html, /n\/a/);
});

test('archive page: score_format letter shows grade but no standalone number', () => {
  const html = renderArchivePage(makeTarget('letter'), [summary], '2026-W25');
  assert.match(html, /class="grade grade-[A-F]"/);
});

test('archive page: score_format percent shows number but no grade span', () => {
  const html = renderArchivePage(makeTarget('percent'), [summary], '2026-W25');
  assert.doesNotMatch(html, /class="grade/);
});
