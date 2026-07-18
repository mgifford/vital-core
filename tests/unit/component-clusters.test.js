import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClusterTracker } from '../../src/lib/component-clusters.js';
import { writeComponentClusterCsvs } from '../../src/lib/csv.js';

test('component clusters: groups by normalized selector + rule id and ranks actions', () => {
  const tracker = createClusterTracker({ design_system: 'cms-ds', design_system_theme: 'medicare' });

  tracker.observe('axe-core', 'color-contrast', 'serious', 'https://example.gov/a', [
    { target: 'main .ds-c-alert:nth-child(3) a', html: '<a class="ds-c-alert__link">Read more</a>' },
  ]);
  tracker.observe('axe-core', 'color-contrast', 'serious', 'https://example.gov/b', [
    { target: 'main .ds-c-alert:nth-child(9) a', html: '<a class="ds-c-alert__link">Read more</a>' },
  ]);

  const out = tracker.finalize(20, 2);
  assert.equal(out.design_system, 'cms-ds');
  assert.equal(out.design_system_theme, 'medicare');
  assert.ok(out.clusters.length >= 1);

  const top = out.top_actions[0];
  assert.equal(top.rule_id, 'color-contrast');
  assert.equal(top.selector_path.includes(':nth-child(*)'), true, 'selector is normalized');
  assert.equal(top.pages_affected, 2);
  assert.equal(top.likely_source, 'template', 'template heuristic still surfaced for validation');
  assert.equal(top.design_components.includes('ds-c-alert'), true);
  assert.equal(typeof top.action_score, 'number');
});

test('component clusters: detects possible lookalike drift outside design-system prefixes', () => {
  const tracker = createClusterTracker({ design_system: 'cms-ds' });

  // Seed known stem from a system component, then observe similar non-system token.
  tracker.observe('axe-core', 'color-contrast', 'serious', 'https://example.gov/a', [
    { target: '.ds-c-alert__body', html: '<div class="ds-c-alert__body">x</div>' },
  ]);
  tracker.observe('axe-core', 'color-contrast', 'serious', 'https://example.gov/b', [
    { target: '.alert-card__body', html: '<div class="alert-card__body">x</div>' },
  ]);

  const out = tracker.finalize(20, 10);
  assert.ok(out.drift_clusters.length >= 1, 'lookalike drift cluster is flagged');
  assert.equal(out.drift_page_count, 1);
  assert.equal(out.drift_pages[0].url, 'https://example.gov/b');
  assert.ok(out.drift_pages[0].tokens.includes('alert-card__body'));
});

test('component clusters: axe-core findings outrank equal-severity/equal-page Alfa findings (issue #210)', () => {
  const tracker = createClusterTracker({ design_system: 'none' });

  tracker.observe('axe-core', 'link-name', 'serious', 'https://example.gov/a', [
    { target: 'nav a.axe-link', html: '<a class="axe-link">Read more</a>' },
  ]);
  tracker.observe('axe-core', 'link-name', 'serious', 'https://example.gov/b', [
    { target: 'nav a.axe-link', html: '<a class="axe-link">Read more</a>' },
  ]);

  tracker.observe('alfa', 'sia-r61', 'serious', 'https://example.gov/a', [
    { target: 'nav a.alfa-link', html: '<a class="alfa-link">Read more</a>' },
  ]);
  tracker.observe('alfa', 'sia-r61', 'serious', 'https://example.gov/b', [
    { target: 'nav a.alfa-link', html: '<a class="alfa-link">Read more</a>' },
  ]);

  const out = tracker.finalize(20, 10);
  const axeCluster = out.clusters.find((c) => c.engine_key === 'axe-core');
  const alfaCluster = out.clusters.find((c) => c.engine_key === 'alfa');

  assert.equal(axeCluster.severity, alfaCluster.severity, 'both clusters have equal severity');
  assert.equal(axeCluster.pages_affected, alfaCluster.pages_affected, 'both clusters affect equal pages');
  assert.ok(
    axeCluster.action_score > alfaCluster.action_score,
    'axe-core cluster must outrank an otherwise-equal alfa cluster',
  );
  assert.equal(out.top_actions[0].engine_key, 'axe-core', 'axe-core cluster is ranked first');
});

test('writeComponentClusterCsvs: writes one CSV per cluster with affected URLs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-clusters-'));
  const summary = {
    componentClusters: {
      clusters: [
        { id: 'cc-123', affected_pages: ['https://a.gov/x', 'https://a.gov/y'] },
      ],
    },
  };

  const links = writeComponentClusterCsvs(tmp, summary);
  assert.equal(Object.keys(links).length, 1);
  const rel = links['cc-123'];
  assert.ok(rel.startsWith('csv/'));
  const csv = fs.readFileSync(path.join(tmp, rel), 'utf8');
  assert.ok(csv.includes('https://a.gov/x'));
  assert.ok(csv.includes('https://a.gov/y'));
});
