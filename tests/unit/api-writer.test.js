import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildIndexEntry, buildSnapshot, buildWeekFindings, writeApiFiles, SCHEMA_VERSION } from '../../src/lib/api-writer.js';

const FAKE_TARGET = { domain: 'example.gov', key: 'example.gov' };
const FAKE_SUMMARY = {
  week: '2026-W25',
  pagesScanned: 100,
  componentClusters: {
    design_system: 'cms-ds',
    design_system_theme: 'medicare',
    total_clusters: 12,
    drift_page_count: 1,
    drift_pages: [
      {
        url: 'https://example.gov/b',
        tokens: ['alert-card__body'],
        cluster_ids: ['cc-123'],
        rule_keys: ['axe-core:color-contrast'],
      },
    ],
    top_actions: [
      {
        id: 'cc-123',
        rule_id: 'color-contrast',
        engine_key: 'axe-core',
        severity: 'Serious',
        pages_affected: 10,
        instances: 16,
        action_score: 30,
        representative_selector: '.ds-c-alert a',
        representative_snippet: '<a class="ds-c-alert__link">Read more</a>',
        design_components: ['ds-c-alert'],
        drift: false,
        estimated_fix_impact: { findings: 16, pages: 10 },
      },
    ],
  },
};

const FAKE_BUG = {
  pattern_id: 'VS-abc12345',
  rule_id: 'color-contrast',
  rule_label: 'Elements must have sufficient color contrast',
  engine_key: 'axe-core',
  severity: 'Serious',
  wcag_sc: '1.4.3',
  wcag_level: 'AA',
  frequency: { pages_affected: 10, instances: 5, total_pages_scanned: 100 },
  weeks_seen: 2,
  first_seen: '2026-W24',
  last_seen: '2026-W25',
};

const FAKE_LEDGER = {
  findings: {
    'VS-abc12345': {
      firstSeen: '2026-W24',
      lastSeen: '2026-W25',
      weeksSeen: 2,
      lastPagesAffected: 8,
    },
  },
};

const FAKE_SERIES = [FAKE_SUMMARY];
const FAKE_DIFFS = {};
const FAKE_INV = { totalKnownPages: 500, pagesWithKnownIssues: 50 };

describe('buildIndexEntry', () => {
  test('returns correct domain and key', () => {
    const entry = buildIndexEntry(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG]);
    assert.equal(entry.domain, 'example.gov');
    assert.equal(entry.key, 'example.gov');
  });

  test('returns correct counts for one Serious bug', () => {
    const entry = buildIndexEntry(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG]);
    assert.equal(entry.critical_count, 0);
    assert.equal(entry.serious_count, 1);
    assert.equal(entry.pages_scanned, 100);
  });

  test('returns zero counts for empty bugs array', () => {
    const entry = buildIndexEntry(FAKE_TARGET, FAKE_SUMMARY, []);
    assert.equal(entry.critical_count, 0);
    assert.equal(entry.serious_count, 0);
  });

  test('snapshot_url and findings_url are correct paths', () => {
    const entry = buildIndexEntry(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG]);
    assert.equal(entry.snapshot_url, '/api/v1/example.gov/snapshot.json');
    assert.equal(entry.findings_url, '/api/v1/example.gov/2026-W25/findings.json');
  });
});

describe('buildSnapshot', () => {
  test('includes schema_version 1', () => {
    const snap = buildSnapshot(FAKE_TARGET, FAKE_SERIES, FAKE_DIFFS, FAKE_LEDGER, FAKE_INV, [FAKE_BUG]);
    assert.equal(snap.schema_version, '1');
  });

  test('summary block has severity counts and pages_scanned', () => {
    const snap = buildSnapshot(FAKE_TARGET, FAKE_SERIES, FAKE_DIFFS, FAKE_LEDGER, FAKE_INV, [FAKE_BUG]);
    assert.ok(typeof snap.summary.critical_count === 'number');
    assert.ok(typeof snap.summary.serious_count === 'number');
    assert.equal(snap.summary.pages_scanned, 100);
    assert.equal(snap.summary.serious_count, 1);
  });

  test('does not include top-level pages array', () => {
    const snap = buildSnapshot(FAKE_TARGET, FAKE_SERIES, FAKE_DIFFS, FAKE_LEDGER, FAKE_INV, [FAKE_BUG]);
    assert.ok(!('pages' in snap));
  });

  test('weekly.series is the passed-in series', () => {
    const snap = buildSnapshot(FAKE_TARGET, FAKE_SERIES, FAKE_DIFFS, FAKE_LEDGER, FAKE_INV, [FAKE_BUG]);
    assert.equal(snap.weekly.series[0].week, FAKE_SERIES[0].week);
    assert.equal(snap.weekly.series[0].componentClusters.top_actions[0].representative_snippet, '<a class="ds-c-alert__link">[text omitted]</a>');
    assert.equal(snap.weekly.series[0].componentClusters.top_actions[0].estimated_fix_impact.remediation_task_count, null);
    assert.match(snap.weekly.series[0].componentClusters.top_actions[0].estimated_fix_impact.statement, /number of fixes and ownership are not established/);
    assert.equal(FAKE_SERIES[0].componentClusters.top_actions[0].representative_snippet, '<a class="ds-c-alert__link">Read more</a>', 'the source series stays untouched');
  });

  test('weekly snapshot strips unsafe nested cluster markup and legacy fix claims', () => {
    const unsafe = [{ ...FAKE_SUMMARY, componentClusters: { top_actions: [{ rule_id: 'label', instances: 2, pages_affected: 2, representative_selector: 'text: "PRIVATE"', representative_snippet: '<script>PRIVATE</script><input value="PRIVATE">', estimated_fix_impact: { findings: 2, pages: 2, statement: 'Fix one place, resolve 2 findings.' } }] } }];
    const snap = buildSnapshot(FAKE_TARGET, unsafe, FAKE_DIFFS, FAKE_LEDGER, FAKE_INV, [FAKE_BUG]);
    const action = snap.weekly.series[0].componentClusters.top_actions[0];
    assert.equal(action.representative_selector, null);
    assert.equal(action.representative_snippet, '<input>');
    assert.ok(!JSON.stringify(snap.weekly).includes('PRIVATE'));
    assert.doesNotMatch(action.estimated_fix_impact.statement, /Fix one place/);
  });

  test('inventory is passed through', () => {
    const snap = buildSnapshot(FAKE_TARGET, FAKE_SERIES, FAKE_DIFFS, FAKE_LEDGER, FAKE_INV, [FAKE_BUG]);
    assert.equal(snap.inventory.totalKnownPages, 500);
  });

  test('includes top_actions queue derived from component clusters', () => {
    const snap = buildSnapshot(FAKE_TARGET, FAKE_SERIES, FAKE_DIFFS, FAKE_LEDGER, FAKE_INV, [FAKE_BUG]);
    assert.equal(snap.top_actions.design_system, 'cms-ds');
    assert.equal(snap.top_actions.queue.length, 1);
    assert.equal(snap.top_actions.queue[0].action_id, 'cc-123');
    assert.equal(snap.top_actions.drift_page_count, 1);
    assert.equal(snap.top_actions.drift_pages[0].url, 'https://example.gov/b');
  });

  // Issue #222 / FR-005: the snapshot's findings ledger passthrough already
  // carries whatever WP01 (src/lib/findings.js updateFindings()) wrote onto a
  // ledger entry, including _coverageLost — no buildSnapshot() code change is
  // needed for this field to reach the static API; this test proves it.
  test('findings passthrough exposes _coverageLost when the ledger sets it (FR-005)', () => {
    const ledgerWithCoverageLost = {
      findings: {
        'VS-abc12345': { firstSeen: '2026-W24', lastSeen: '2026-W25', weeksSeen: 2, lastPagesAffected: 8 },
        'VS-gone9999': { firstSeen: '2026-W20', lastSeen: '2026-W24', weeksSeen: 4, lastPagesAffected: 2, _coverageLost: true },
      },
    };
    const snap = buildSnapshot(FAKE_TARGET, FAKE_SERIES, FAKE_DIFFS, ledgerWithCoverageLost, FAKE_INV, [FAKE_BUG]);
    assert.equal(snap.findings['VS-gone9999']._coverageLost, true);
    assert.equal(snap.findings['VS-abc12345']._coverageLost, undefined,
      'a confirmed-fixed finding (no flag) is not marked coverage-lost');
  });
});

describe('buildWeekFindings', () => {
  test('adds evidence reporting without changing v1 identity, severity or history', () => {
    const bug = { ...FAKE_BUG, instance_id: 'VS-instance', engine_severity: 'moderate', examples: [{ url: 'https://example.gov/?token=PRIVATE', xpath: '#field', html_snippet: '<input id="field" value="PRIVATE">' }], affected_pages: ['https://example.gov/a', 'https://example.gov/a'] };
    const original = structuredClone(bug);
    const result = buildWeekFindings(FAKE_TARGET, FAKE_SUMMARY, [bug], FAKE_LEDGER.findings);
    const finding = result.findings[0];
    assert.equal(finding.finding_id, original.pattern_id);
    assert.equal(finding.instance_id, original.instance_id);
    assert.equal(finding.severity, original.severity);
    assert.equal(finding.first_seen, original.first_seen);
    assert.equal(finding.reporting.engine_severity, 'moderate');
    assert.equal(finding.reporting.act_rules.length, 2);
    assert.equal(finding.reporting.distinct_urls.observed_count, 1);
    assert.equal(finding.reporting.distinct_urls.complete, false);
    assert.equal(result.reporting.remediation_task_count, null);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
    assert.deepEqual(bug, original);
  });

  test('includes schema_version 1', () => {
    const wf = buildWeekFindings(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG], FAKE_LEDGER.findings);
    assert.equal(wf.schema_version, '1');
  });

  test('maps bug to FindingEntry with all required fields', () => {
    const wf = buildWeekFindings(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG], FAKE_LEDGER.findings);
    assert.equal(wf.findings.length, 1);
    const f = wf.findings[0];
    assert.equal(f.finding_id, 'VS-abc12345');
    assert.equal(f.rule_id, 'color-contrast');
    assert.equal(f.engine, 'axe-core');
    assert.equal(f.severity, 'Serious');
    assert.equal(f.pages_affected, 10);
    assert.equal(f.wcag_sc, '1.4.3');
    assert.equal(f.wcag_level, 'AA');
    assert.equal(f.first_seen, '2026-W24');
    assert.equal(f.weeks_seen, 2);
  });

  test('trend_status is one of the four valid values', () => {
    const valid = new Set(['new', 'persistent', 'worsening', 'improving']);
    const wf = buildWeekFindings(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG], FAKE_LEDGER.findings);
    for (const f of wf.findings) {
      assert.ok(valid.has(f.trend_status), `unexpected trend_status: ${f.trend_status}`);
    }
  });

  test('trend_status is worsening when pages increased', () => {
    const wf = buildWeekFindings(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG], FAKE_LEDGER.findings);
    // FAKE_BUG has 10 pages_affected; lastPagesAffected in ledger is 8 → worsening
    assert.equal(wf.findings[0].trend_status, 'worsening');
  });

  test('trend_status is new for a single-week bug', () => {
    const newBug = { ...FAKE_BUG, weeks_seen: 1, first_seen: '2026-W25', last_seen: '2026-W25' };
    const wf = buildWeekFindings(FAKE_TARGET, FAKE_SUMMARY, [newBug], {});
    assert.equal(wf.findings[0].trend_status, 'new');
  });

  test('returns empty findings array when bugs is empty', () => {
    const wf = buildWeekFindings(FAKE_TARGET, FAKE_SUMMARY, [], {});
    assert.deepEqual(wf.findings, []);
  });

  test('includes top_actions queue in weekly findings payload', () => {
    const wf = buildWeekFindings(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG], FAKE_LEDGER.findings);
    assert.equal(wf.top_actions.design_system_theme, 'medicare');
    assert.equal(wf.top_actions.queue[0].rule_id, 'color-contrast');
  });
});

describe('writeApiFiles', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-writer-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates index.json, snapshot.json, and findings.json', () => {
    const indexEntries = [buildIndexEntry(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG])];
    const snap = buildSnapshot(FAKE_TARGET, FAKE_SERIES, FAKE_DIFFS, FAKE_LEDGER, FAKE_INV, [FAKE_BUG]);
    const snapshots = [{ key: FAKE_TARGET.key, data: snap }];
    const wf = buildWeekFindings(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG], FAKE_LEDGER.findings);
    const weekFindings = [{ key: FAKE_TARGET.key, week: FAKE_SUMMARY.week, data: wf }];

    writeApiFiles(tmpDir, indexEntries, snapshots, weekFindings);

    const indexPath = path.join(tmpDir, 'api', 'v1', 'index.json');
    const snapPath = path.join(tmpDir, 'api', 'v1', FAKE_TARGET.key, 'snapshot.json');
    const findingsPath = path.join(tmpDir, 'api', 'v1', FAKE_TARGET.key, FAKE_SUMMARY.week, 'findings.json');

    assert.ok(fs.existsSync(indexPath), 'index.json must exist');
    assert.ok(fs.existsSync(snapPath), 'snapshot.json must exist');
    assert.ok(fs.existsSync(findingsPath), 'findings.json must exist');
  });

  test('all generated files have schema_version 1', () => {
    const indexEntries = [buildIndexEntry(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG])];
    const snap = buildSnapshot(FAKE_TARGET, FAKE_SERIES, FAKE_DIFFS, FAKE_LEDGER, FAKE_INV, [FAKE_BUG]);
    const snapshots = [{ key: FAKE_TARGET.key, data: snap }];
    const wf = buildWeekFindings(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG], FAKE_LEDGER.findings);
    const weekFindings = [{ key: FAKE_TARGET.key, week: FAKE_SUMMARY.week, data: wf }];

    writeApiFiles(tmpDir, indexEntries, snapshots, weekFindings);

    const index = JSON.parse(fs.readFileSync(path.join(tmpDir, 'api', 'v1', 'index.json'), 'utf8'));
    const snapshot = JSON.parse(fs.readFileSync(path.join(tmpDir, 'api', 'v1', FAKE_TARGET.key, 'snapshot.json'), 'utf8'));
    const findings = JSON.parse(fs.readFileSync(path.join(tmpDir, 'api', 'v1', FAKE_TARGET.key, FAKE_SUMMARY.week, 'findings.json'), 'utf8'));

    assert.equal(index.schema_version, '1');
    assert.equal(snapshot.schema_version, '1');
    assert.equal(findings.schema_version, '1');
  });

  test('index.json domains array has correct entry', () => {
    const indexEntries = [buildIndexEntry(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG])];
    writeApiFiles(tmpDir, indexEntries, [], []);

    const index = JSON.parse(fs.readFileSync(path.join(tmpDir, 'api', 'v1', 'index.json'), 'utf8'));
    assert.ok(Array.isArray(index.domains));
    assert.equal(index.domains[0].domain, 'example.gov');
    assert.equal(index.domains[0].snapshot_url, '/api/v1/example.gov/snapshot.json');
  });
});

describe('buildWeekFindings scope of analysis (additive)', () => {
  test('exposes component scope and page-family counts without URLs, and omits them when not configured', () => {
    const scope = { classification: 'shared_component', component_id: 'consent-dialog', verified: true, basis: 'stored_examples' };
    const bug = { ...FAKE_BUG, component_scope: scope };
    const summary = {
      ...FAKE_SUMMARY,
      sharedComponents: { schema: 1, counts: { engine_findings: 1 }, components: [{ id: 'consent-dialog', verified: true }], rules: { 'axe-core:x': scope } },
      pageFamilies: { schema: 1, urls_total: 3, known_implementation_count: 1, families: [] },
    };
    const wf = buildWeekFindings(FAKE_TARGET, summary, [bug], FAKE_LEDGER.findings);
    assert.deepEqual(wf.findings[0].reporting.component_scope, scope);
    assert.equal(wf.scope_of_analysis.page_families.known_implementation_count, 1);
    assert.equal(wf.scope_of_analysis.shared_components.components[0].id, 'consent-dialog');
    assert.equal(JSON.parse(JSON.stringify(wf)).scope_of_analysis.shared_components.rules, undefined, 'per-rule map is carried on each finding instead');
    assert.equal(wf.schema_version, SCHEMA_VERSION, 'no schema version bump');
    const plain = buildWeekFindings(FAKE_TARGET, FAKE_SUMMARY, [FAKE_BUG], FAKE_LEDGER.findings);
    assert.equal('scope_of_analysis' in plain, false);
    assert.equal(plain.findings[0].reporting.component_scope, null);
  });
});
