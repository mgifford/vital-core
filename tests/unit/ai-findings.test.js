import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAiFindings } from '../../src/lib/ai-findings.js';

// Minimal fakes — enough to exercise the logic without real scan data.
const FAKE_TARGET = {
  domain: 'example.gov',
  key: 'example.gov',
  priority_urls: ['https://example.gov/'],
};

const FAKE_SUMMARY = {
  domain: 'example.gov',
  week: '2026-W25',
  generatedAt: '2026-06-19T00:00:00.000Z',
  pagesScanned: 100,
  axe: { rules: {}, medianViolations: 0, pagesWithViolations: 0 },
  alfa: { rules: {}, medianFailures: 0, pagesWithFailures: 0 },
  deprecatedHtml: { rules: {} },
  techFindings: { associations: [] },
  thirdParty: { vendors: [] },
};

const FAKE_BUG = {
  pattern_id: 'VS-aabbccdd',
  instance_id: 'VS-11223344',
  rule_id: 'color-contrast',
  rule_label: 'Elements must meet minimum color contrast ratio thresholds',
  engine_key: 'axe-core',
  tool: 'axe-core 4.12',
  wcag_sc: '1.4.3',
  wcag_name: 'Contrast (Minimum)',
  wcag_level: 'AA',
  wcag_version: '2.0',
  wcag_category: 'WCAG 2.0 AA',
  rule_url: 'https://dequeuniversity.com/rules/axe/4.12/color-contrast',
  severity: 'High',
  frequency: { instances: 42, pages_affected: 30, total_pages_scanned: 100 },
  summary: 'Contrast (Minimum) (WCAG 1.4.3)',
  description: 'Elements must meet minimum color contrast ratio thresholds.',
  examples: [
    { url: 'https://example.gov/', xpath: 'h1 > span', html_snippet: '<span style="color:#ccc">hello</span>' },
    { url: 'https://example.gov/about', xpath: 'p.meta', html_snippet: '<p class="meta" style="color:#aaa">meta</p>' },
  ],
  example_pages: ['https://example.gov/', 'https://example.gov/about'],
  affected_pages: ['https://example.gov/', 'https://example.gov/about', 'https://example.gov/contact'],
  impact: { groups: [], summary: 'Not captured.' },
  testing_environment: 'Automated: axe-core, headless Chromium.',
  steps_to_reproduce: ['Open https://example.gov/'],
  remediation_tip: 'Increase contrast ratio to at least 4.5:1.',
  suggested_fix: 'See https://dequeuniversity.com/rules/axe/4.12/color-contrast',
  first_seen: '2026-W24',
  last_seen: '2026-W25',
  weeks_seen: 2,
};

const FAKE_LEDGER = {
  domain: 'example.gov',
  findings: {
    'VS-aabbccdd': {
      engine: 'axe-core', ruleId: 'color-contrast',
      severity: 'High', firstSeen: '2026-W24', lastSeen: '2026-W25',
      weeksSeen: 2, lastPagesAffected: 20, _weeks: ['2026-W24', '2026-W25'],
    },
  },
};

const FAKE_PREV_SUMMARY = {
  week: '2026-W24',
  pagesScanned: 80,
  axe: { rules: { 'color-contrast': { count: 20, pages: 20, impact: 'serious' } } },
  alfa: { rules: {} },
};

const FAKE_INV = { totalKnownPages: 500, pagesWithKnownIssues: 120, scannedThisWeek: 100 };

// ---

test('buildAiFindings returns null-safe result for empty bugs', () => {
  const doc = buildAiFindings(FAKE_TARGET, FAKE_SUMMARY, [], FAKE_LEDGER, [FAKE_SUMMARY], FAKE_INV, '/tmp');
  assert.ok(doc, 'should return a document even with no bugs');
  assert.equal(doc.schema_version, '0.1');
  assert.equal(doc.findings.length, 0);
  assert.ok(doc.metadata.notes.some((n) => n.includes('No accessibility findings')), 'should note empty findings');
});

test('buildAiFindings returns null-safe result for null summary', () => {
  const doc = buildAiFindings(FAKE_TARGET, null, [], FAKE_LEDGER, [], FAKE_INV, '/tmp');
  assert.ok(doc._warnings?.length > 0, 'should have warnings for null summary');
});

test('buildAiFindings populates all top-level keys', () => {
  const doc = buildAiFindings(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG], FAKE_LEDGER, [FAKE_PREV_SUMMARY, FAKE_SUMMARY], FAKE_INV, '/tmp');
  for (const key of ['schema_version', 'site', 'scan_week', 'generated_at', 'source_files', 'summary', 'top_risks', 'findings', 'clusters', 'technology_findings', 'third_party_findings', 'metadata']) {
    assert.ok(key in doc, `missing top-level key: ${key}`);
  }
});

test('buildAiFindings summary counts are accurate', () => {
  const doc = buildAiFindings(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG], FAKE_LEDGER, [FAKE_PREV_SUMMARY, FAKE_SUMMARY], FAKE_INV, '/tmp');
  assert.equal(doc.summary.pages_known, 500);
  assert.equal(doc.summary.pages_scanned_this_week, 100);
  assert.equal(doc.summary.findings, 1);
});

test('finding has stable fingerprint and required fields', () => {
  const doc = buildAiFindings(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG], FAKE_LEDGER, [FAKE_PREV_SUMMARY, FAKE_SUMMARY], FAKE_INV, '/tmp');
  const f = doc.findings[0];
  assert.ok(f.finding_id, 'has finding_id');
  assert.ok(f.fingerprint, 'has fingerprint');
  assert.match(f.fingerprint, /^[0-9a-f]{8}$/, 'fingerprint is 8-char hex');
  assert.ok(f.trend, 'has trend block');
  assert.ok(['new','persistent','worsening','improving'].includes(f.trend.status), 'valid trend status');
  assert.ok(['p1','p2','p3','p4'].includes(f.priority), 'valid priority');
  assert.ok(['high','medium','low'].includes(f.confidence), 'valid confidence');
});

test('fingerprint is stable across calls', () => {
  const doc1 = buildAiFindings(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG], FAKE_LEDGER, [FAKE_PREV_SUMMARY, FAKE_SUMMARY], FAKE_INV, '/tmp');
  const doc2 = buildAiFindings(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG], FAKE_LEDGER, [FAKE_PREV_SUMMARY, FAKE_SUMMARY], FAKE_INV, '/tmp');
  assert.equal(doc1.findings[0].fingerprint, doc2.findings[0].fingerprint, 'fingerprint must be deterministic');
});

test('trend is worsening when pages increased', () => {
  const doc = buildAiFindings(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG], FAKE_LEDGER, [FAKE_PREV_SUMMARY, FAKE_SUMMARY], FAKE_INV, '/tmp');
  // previous=20, current=30 → worsening
  assert.equal(doc.findings[0].trend.status, 'worsening');
  assert.equal(doc.findings[0].trend.affected_pages_previous, 20);
  assert.equal(doc.findings[0].trend.affected_pages_current, 30);
});

test('html fragments are deduplicated and fingerprinted', () => {
  const bugWithDupFragments = {
    ...FAKE_BUG,
    examples: [
      { url: 'https://example.gov/', xpath: 'h1', html_snippet: '<span style="color:#ccc">hello</span>' },
      { url: 'https://example.gov/a', xpath: 'h2', html_snippet: '<span style="color:#ccc">hello</span>' }, // same normalised
      { url: 'https://example.gov/b', xpath: 'p',  html_snippet: '<p class="foo">different</p>' },
    ],
  };
  const doc = buildAiFindings(FAKE_TARGET, FAKE_SUMMARY, [bugWithDupFragments], FAKE_LEDGER, [FAKE_PREV_SUMMARY, FAKE_SUMMARY], FAKE_INV, '/tmp');
  const frags = doc.findings[0].html_fragments;
  // Two distinct normalised fragments (span, p) — not three
  assert.equal(frags.length, 2, 'duplicate fragments should be deduplicated');
  for (const frag of frags) {
    assert.ok(frag.fingerprint, 'each fragment has a fingerprint');
    assert.match(frag.fingerprint, /^[0-9a-f]{8}$/, 'fragment fingerprint is 8-char hex');
  }
});

test('on_key_page is true when affected URL matches priority_urls', () => {
  const doc = buildAiFindings(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG], FAKE_LEDGER, [FAKE_PREV_SUMMARY, FAKE_SUMMARY], FAKE_INV, '/tmp');
  // FAKE_BUG has 'https://example.gov/' in example_pages, FAKE_TARGET has it in priority_urls
  assert.equal(doc.findings[0].on_key_page, true);
});

test('clusters.by_wcag_criterion groups findings by WCAG SC', () => {
  const doc = buildAiFindings(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG], FAKE_LEDGER, [FAKE_PREV_SUMMARY, FAKE_SUMMARY], FAKE_INV, '/tmp');
  const wcag = doc.clusters.by_wcag_criterion;
  assert.ok(Array.isArray(wcag), 'by_wcag_criterion is an array');
  const cl = wcag.find((c) => c.wcag_sc === '1.4.3');
  assert.ok(cl, 'cluster for WCAG 1.4.3 exists');
  assert.ok(cl.findings.includes('VS-aabbccdd'), 'cluster contains the finding');
});
