import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndexEntry, buildSnapshot, buildWeekFindings, SCHEMA_VERSION } from '../../src/lib/api-writer.js';
import { filterBugsByExclusion } from '../../src/report-html.js';
import { redactBugs } from '../../src/lib/api-redact.js';

// Mirror of aggregate.js apiBugsFor(): render-time exclusion parity + URL
// redaction, in that order. Kept in sync with the aggregate helper.
function apiBugsFor(target, bugs) {
  const filtered = filterBugsByExclusion(bugs, target.url_exclude_patterns ?? []);
  return redactBugs(filtered, { denyParams: target.api_redact_params ?? [] });
}

const SECRET = 'TOPSECRET123';
const EXCLUDED_URL = 'https://example.gov/private-preview/page';

const target = {
  domain: 'example.gov',
  key: 'example.gov',
  url_exclude_patterns: ['/private-preview/'],
};

// A drift page carrying a sensitive query param, to exercise the api-writer
// redaction boundary (snapshot/findings top_actions.drift_pages[].url).
const componentClusters = {
  design_system: 'ds', total_clusters: 1,
  drift_pages: [{ url: `https://example.gov/x?token=${SECRET}#frag`, tokens: [], cluster_ids: [], rule_keys: [] }],
  top_actions: [{
    id: 'A1', rule_id: 'color-contrast', engine_key: 'axe-core', severity: 'Serious',
    pages_affected: 2, instances: 3, action_score: 5, representative_selector: '.a',
    representative_snippet: '<a></a>', design_components: [], drift: false, estimated_fix_impact: null,
  }],
};
const summary = { week: '2026-W25', pagesScanned: 100, domain: 'example.gov', componentClusters, techFindings: { associations: [] } };
const series = [{ week: '2026-W25', pagesScanned: 100, componentClusters, techFindings: { associations: [] } }];

// Two bugs: one whose only page is excluded (must vanish), one visible bug
// carrying a sensitive query value + fragment (value must be redacted).
const rawBugs = [
  {
    pattern_id: 'VS-excluded', rule_id: 'label', rule_label: 'Label', engine_key: 'axe-core',
    severity: 'Serious', wcag_sc: '4.1.2', wcag_level: 'A',
    url: EXCLUDED_URL,
    affected_pages: [EXCLUDED_URL],
    examples: [{ url: EXCLUDED_URL, html_snippet: '<input>' }],
    frequency: { pages_affected: 1, instances: 1, total_pages_scanned: 100 },
    first_seen: '2026-W25', last_seen: '2026-W25', weeks_seen: 1,
  },
  {
    pattern_id: 'VS-visible', rule_id: 'color-contrast', rule_label: 'Contrast', engine_key: 'axe-core',
    severity: 'Serious', wcag_sc: '1.4.3', wcag_level: 'AA',
    url: `https://example.gov/home?session=${SECRET}#top`,
    affected_pages: [`https://example.gov/a?apikey=${SECRET}`, 'https://example.gov/b'],
    examples: [{ url: `https://example.gov/a?apikey=${SECRET}`, html_snippet: '<a></a>' }],
    frequency: { pages_affected: 2, instances: 2, total_pages_scanned: 100 },
    first_seen: '2026-W25', last_seen: '2026-W25', weeks_seen: 1,
  },
];

const ledger = { findings: { 'VS-visible': { engine: 'axe-core', ruleId: 'color-contrast', severity: 'Serious', firstSeen: '2026-W25', lastSeen: '2026-W25', weeksSeen: 1, lastPagesAffected: 2 } } };

function allApiJson() {
  const apiBugs = apiBugsFor(target, rawBugs);
  const index = { schema_version: SCHEMA_VERSION, domains: [buildIndexEntry(target, series[0], apiBugs)] };
  const findings = buildWeekFindings(target, summary, apiBugs, ledger.findings);
  const snapshot = buildSnapshot(target, series, {}, ledger, null, apiBugs);
  return JSON.stringify(index) + JSON.stringify(findings) + JSON.stringify(snapshot);
}

describe('API redaction + exclusion leak proof (issue #136)', () => {
  test('no sensitive query value appears anywhere in serialized API resources', () => {
    const json = allApiJson();
    assert.ok(!json.includes(SECRET), 'sensitive value leaked into API output');
  });

  test('excluded URL does not appear anywhere in serialized API resources', () => {
    const json = allApiJson();
    assert.ok(!json.includes('/private-preview/'), 'excluded URL leaked into API output');
  });

  test('no URL fragment (#) survives on emitted URLs', () => {
    const apiBugs = apiBugsFor(target, rawBugs);
    for (const b of apiBugs) {
      assert.ok(!String(b.url).includes('#'), `fragment survived on ${b.url}`);
      for (const p of b.affected_pages ?? []) assert.ok(!p.includes('#'), `fragment survived on ${p}`);
    }
    // drift page url in snapshot
    const snap = buildSnapshot(target, series, {}, ledger, null, apiBugs);
    for (const d of snap.top_actions?.drift_pages ?? []) {
      assert.ok(!d.url.includes('#'), `fragment survived on drift ${d.url}`);
    }
  });

  test('the excluded finding is dropped and the visible finding is retained', () => {
    const apiBugs = apiBugsFor(target, rawBugs);
    const ids = apiBugs.map((b) => b.pattern_id);
    assert.deepEqual(ids, ['VS-visible']);
  });
});
