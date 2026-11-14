import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildWcagEmData, buildWcagEmJson, renderWcagEmHtml, writeWcagEmReport } from '../../src/lib/wcag-em.js';

const summary = {
  week: '2026-W46',
  generatedAt: '2026-11-13T10:00:00.000Z',
  pagesScanned: 120,
  axe: {
    pagesScanned: 120,
    version: '4.14.0',
    rules: {
      'color-contrast': { pages: 12, tags: ['wcag2aa', 'wcag143'], examplePages: ['https://example.org/a'] },
    },
  },
  alfa: { pagesScanned: 40, version: '0.117.0', rules: {} },
};
const target = {
  domain: 'example.org',
  findingPolicy: { conformance: { standard: 'WCAG', version: '2.2', level: 'AA' } },
};

test('WCAG-EM data separates failures from not evaluated and never claims a pass', () => {
  const data = buildWcagEmData(target, summary, '2026-W46');
  assert.equal(data.not_a_conformance_claim, true);
  assert.equal(data.wcag_em_aligned, true);
  assert.equal(data.wcag_em_evaluation_complete, false);
  assert.equal(data.report_tool_native_import, false);
  assert.equal(data.sample.not_wcag_em_sample, true);
  assert.equal(data.evaluation.conformance_target.version, '2.2');
  assert.equal(data.evaluation.conformance_target.level, 'AA');
  assert.equal(data.results.criteria.find((criterion) => criterion.sc === '1.4.3').outcome, 'failed');
  assert.ok(data.results.criteria.every((criterion) => ['failed', 'not_evaluated'].includes(criterion.outcome)), 'no passed/supports outcome');
  assert.ok(data.results.not_evaluated > 20, 'manual outcomes remain unknown');
  assert.equal(data.wcag_em_steps[2].status, 'not_wcag_em');
  assert.match(data.limitations.join(' '), /not a WCAG-EM representative sample/i);
  assert.match(data.limitations.join(' '), /not a native W3C WCAG-EM Report Tool import/i);
});

test('WCAG-EM JSON is structured and HTML uses the same outcomes', () => {
  const data = buildWcagEmData(target, summary, '2026-W46');
  const json = JSON.parse(buildWcagEmJson(target, summary, '2026-W46'));
  assert.equal(json.results.failed, data.results.failed);
  const html = renderWcagEmHtml(target, summary, '2026-W46', data);
  assert.match(html, /DRAFT — automated evidence only/);
  assert.match(html, /not a WCAG-EM conformance evaluation/);
  assert.match(html, /Not evaluated/);
  assert.doesNotMatch(html, /class="outcome (passed|supports)"/);
  assert.match(html, /wcag-em\.json/);
  assert.match(html, /WCAG-EM Report Tool/);
  assert.ok(!html.includes('<script src='), 'no external script');
});

test('writeWcagEmReport writes HTML and JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-wcag-em-'));
  try {
    const result = writeWcagEmReport(dir, target, summary, '2026-W46');
    assert.equal(result.path, 'wcag-em.html');
    assert.ok(fs.existsSync(path.join(dir, 'wcag-em.html')));
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'wcag-em.json'), 'utf8'));
    assert.equal(parsed.results.failed, 1);
    assert.equal(parsed.format, 'vital-wcag-em-draft');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
