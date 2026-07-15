import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateFindings } from '../../src/lib/findings.js';

// Base report shared across tests.
const BASE_REPORT = {
  pattern_id: 'VS-new',
  tool: 'axe-core',
  rule_id: 'image-alt',
  summary: 'Missing alt (WCAG 1.1.1)',
  wcag_sc: '1.1.1',
  severity: 'serious',
  frequency: { pages_affected: 5 },
  affected_pages: ['https://example.gov/new1', 'https://example.gov/new2'],
};

test('findings: ledger tracks first/last-seen and is idempotent per week', () => {
  const ledger = { domain: 'x', findings: {} };
  const reportA = {
    pattern_id: 'VS-aaa', tool: 'axe-core', rule_id: 'image-alt',
    summary: 'Images need alt (WCAG 1.1.1)', wcag_sc: '1.1.1', severity: 'critical',
    frequency: { pages_affected: 5 },
  };
  const reportB = {
    pattern_id: 'VS-bbb', tool: 'alfa', rule_id: 'sia-r12',
    summary: 'Button name (WCAG 4.1.2)', wcag_sc: '4.1.2', severity: 'moderate',
    frequency: { pages_affected: 2 },
  };

  updateFindings(ledger, '2026-W23', [reportA, reportB]);
  assert.equal(ledger.findings['VS-aaa'].firstSeen, '2026-W23');
  assert.equal(ledger.findings['VS-aaa'].weeksSeen, 1);

  updateFindings(ledger, '2026-W24', [reportA]);
  assert.equal(ledger.findings['VS-aaa'].firstSeen, '2026-W23');
  assert.equal(ledger.findings['VS-aaa'].lastSeen, '2026-W24');
  assert.equal(ledger.findings['VS-aaa'].weeksSeen, 2);
  assert.equal(ledger.findings['VS-bbb'].lastSeen, '2026-W23', 'resolved finding keeps last-seen');

  updateFindings(ledger, '2026-W24', [reportA]);
  assert.equal(ledger.findings['VS-aaa'].weeksSeen, 2, 're-run same week is idempotent');
});

// ---------------------------------------------------------------------------
// Issue #159: coverage-expansion detection
// ---------------------------------------------------------------------------

test('findings: no _coverageNew when prevCoveredUrls is absent (backward compat)', () => {
  const ledger = { domain: 'x', findings: {} };
  updateFindings(ledger, '2026-W25', [BASE_REPORT]);
  assert.equal(ledger.findings['VS-new']._coverageNew, undefined,
    'omitting prevCoveredUrls preserves original behavior — no coverage flag');
});

test('findings: _coverageNew is true when no affected page was previously sampled', () => {
  const ledger = { domain: 'x', findings: {} };
  const prevCoveredUrls = new Set(['https://example.gov/old1', 'https://example.gov/old2']);
  updateFindings(ledger, '2026-W25', [BASE_REPORT], { prevCoveredUrls });
  assert.equal(ledger.findings['VS-new']._coverageNew, true,
    'all affected pages are new — should be flagged as coverage expansion');
});

test('findings: _coverageNew absent when at least one affected page was previously sampled', () => {
  const ledger = { domain: 'x', findings: {} };
  const prevCoveredUrls = new Set(['https://example.gov/old1', 'https://example.gov/new1']);
  updateFindings(ledger, '2026-W25', [BASE_REPORT], { prevCoveredUrls });
  assert.equal(ledger.findings['VS-new']._coverageNew, undefined,
    'one affected page was in prev coverage — genuinely new, no coverage flag');
});

test('findings: _coverageNew is cleared once the finding appears a second week', () => {
  const ledger = { domain: 'x', findings: {} };
  const prevCoveredUrls = new Set(['https://example.gov/old1']);
  updateFindings(ledger, '2026-W24', [BASE_REPORT], { prevCoveredUrls });
  assert.equal(ledger.findings['VS-new']._coverageNew, true, 'flagged in W24');
  updateFindings(ledger, '2026-W25', [BASE_REPORT]);
  assert.equal(ledger.findings['VS-new']._coverageNew, undefined, 'flag cleared in W25');
  assert.equal(ledger.findings['VS-new'].weeksSeen, 2);
});

test('findings: _coverageNew skipped when no affected_pages list provided', () => {
  const ledger = { domain: 'x', findings: {} };
  const reportNoPages = { ...BASE_REPORT, affected_pages: undefined };
  const prevCoveredUrls = new Set(['https://example.gov/old1']);
  updateFindings(ledger, '2026-W25', [reportNoPages], { prevCoveredUrls });
  assert.equal(ledger.findings['VS-new']._coverageNew, undefined,
    'cannot determine coverage without an affected_pages list — no false flag');
});

// ---------------------------------------------------------------------------
// Issue #222: coverage-lost detection
// ---------------------------------------------------------------------------

const DISAPPEARING_REPORT = {
  pattern_id: 'VS-gone',
  tool: 'axe-core',
  rule_id: 'color-contrast',
  summary: 'Low contrast text (WCAG 1.4.3)',
  wcag_sc: '1.4.3',
  severity: 'serious',
  frequency: { pages_affected: 2 },
  affected_pages: ['https://example.gov/p1', 'https://example.gov/p2'],
};

test('findings: _coverageLost is true when a disappearing finding\'s pages were not re-covered', () => {
  const ledger = { domain: 'x', findings: {} };
  updateFindings(ledger, '2026-W24', [DISAPPEARING_REPORT]);
  const thisWeekCoveredUrls = new Set(['https://example.gov/other']);
  updateFindings(ledger, '2026-W25', [], { thisWeekCoveredUrls, prevWeek: '2026-W24' });
  assert.equal(ledger.findings['VS-gone']._coverageLost, true,
    'neither prior page was re-covered — disappearance is not a confirmed fix');
  assert.equal(ledger.findings['VS-gone'].lastSeen, '2026-W24',
    'lastSeen does not advance for a coverage-lost finding — it was never seen this week');
});

test('findings: _coverageLost is NOT set when a disappearing finding\'s page was re-covered (real fix)', () => {
  const ledger = { domain: 'x', findings: {} };
  updateFindings(ledger, '2026-W24', [DISAPPEARING_REPORT]);
  const thisWeekCoveredUrls = new Set(['https://example.gov/p1']);
  updateFindings(ledger, '2026-W25', [], { thisWeekCoveredUrls, prevWeek: '2026-W24' });
  assert.equal(ledger.findings['VS-gone']._coverageLost, undefined,
    'one prior page WAS re-covered and found clean — genuinely fixed, no coverage-lost flag');
});

test('findings: _coverageLost is never set when thisWeekCoveredUrls/prevWeek are omitted (C-01 regression guard)', () => {
  const ledger = { domain: 'x', findings: {} };
  updateFindings(ledger, '2026-W24', [DISAPPEARING_REPORT]);
  updateFindings(ledger, '2026-W25', []);
  assert.equal(ledger.findings['VS-gone']._coverageLost, undefined,
    'omitting the new coverage options reproduces original behavior exactly — no forced migration');
  assert.equal(ledger.findings['VS-gone'].lastSeen, '2026-W24');
});

test('findings: _coverageLost is cleared when a flagged finding reappears in a later week', () => {
  const ledger = { domain: 'x', findings: {} };
  updateFindings(ledger, '2026-W24', [DISAPPEARING_REPORT]);
  const thisWeekCoveredUrls = new Set(['https://example.gov/other']);
  updateFindings(ledger, '2026-W25', [], { thisWeekCoveredUrls, prevWeek: '2026-W24' });
  assert.equal(ledger.findings['VS-gone']._coverageLost, true, 'flagged in W25');

  updateFindings(ledger, '2026-W26', [DISAPPEARING_REPORT]);
  assert.equal(ledger.findings['VS-gone']._coverageLost, undefined, 'flag cleared on reappearance');
  assert.equal(ledger.findings['VS-gone'].lastSeen, '2026-W26');
});
