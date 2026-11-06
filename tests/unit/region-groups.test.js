import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findingsFromRules,
  regionOf,
  buildRegionGroups,
  buildComponentGroups,
  MAX_GROUP_REPRESENTATIVES,
} from '../../src/lib/region-groups.js';

const semantic = (region, widget = null) => ({
  nearest_region: region,
  region_ancestry: region ? [region] : [],
  widget,
  widget_ancestry: widget ? [widget] : [],
  path: [region, widget].filter(Boolean),
  in_dialog: widget?.role === 'dialog' || widget?.role === 'alertdialog',
  unnamed_landmarks: [],
  unclassified: !region,
});

const instance = (over = {}) => ({ url: 'https://example.gov/a', target: 'button.x', ...over });
const finding = (over = {}) => ({
  engine_key: 'axe-core',
  rule_id: 'button-name',
  pages: 3,
  instances_total: 5,
  instances: [instance({ semantic_context: semantic({ role: 'main', name: null, unnamed: true }) })],
  ...over,
});

test('regions: named landmarks are grouped by role and name', () => {
  const model = buildRegionGroups([
    finding({ rule_id: 'a' }),
    finding({ rule_id: 'b', instances: [instance({ semantic_context: semantic({ role: 'navigation', name: 'Primary', unnamed: false }) })] }),
  ]);
  assert.equal(model.findings_total, 2);
  assert.equal(model.findings_with_region, 2);
  assert.equal(model.findings_unclassified, 0);
  const nav = model.regions.find((region) => region.role === 'navigation');
  assert.equal(nav.label, 'navigation "Primary"');
  assert.equal(nav.findings, 1);
  assert.equal(nav.pages_affected_sum, 3);
  assert.equal(nav.instances_total, 5);
  assert.equal(nav.stored_instances, 1);
});

test('regions: same role with different names is not merged, unnamed stays unnamed', () => {
  const model = buildRegionGroups([
    finding({ rule_id: 'a', instances: [instance({ semantic_context: semantic({ role: 'navigation', name: 'Primary', unnamed: false }) })] }),
    finding({ rule_id: 'b', instances: [instance({ semantic_context: semantic({ role: 'navigation', name: 'Footer', unnamed: false }) })] }),
    finding({ rule_id: 'c', instances: [instance({ semantic_context: semantic({ role: 'navigation', name: null, unnamed: true }) })] }),
  ]);
  assert.equal(model.regions.length, 3);
  assert.ok(model.regions.some((region) => region.label === 'navigation (unnamed)'));
});

test('regions: evidence with no landmark is unclassified and sorted last', () => {
  const model = buildRegionGroups([
    finding({ rule_id: 'a', instances: [instance({ semantic_context: semantic(null) })] }),
    finding({ rule_id: 'b' }),
  ]);
  assert.equal(model.findings_unclassified, 1);
  assert.equal(model.regions.at(-1).key, 'unclassified');
  assert.equal(model.regions.at(-1).label, 'unclassified (no landmark)');
});

test('regions: findings without any region evidence are counted, never folded into unclassified', () => {
  const model = buildRegionGroups([
    finding({ rule_id: 'alfa', engine_key: 'alfa', instances: [instance({ target: '<button>' })] }),
  ]);
  assert.equal(model.findings_without_evidence, 1);
  assert.equal(model.findings_unclassified, 0);
  assert.equal(model.regions.length, 0);
});

test('regions: components are listed per region without changing the region count', () => {
  const model = buildRegionGroups([
    finding({ rule_id: 'a', instances: [instance({ component: 'cmp-consent', semantic_context: semantic({ role: 'main', name: null, unnamed: true }) })] }),
    finding({ rule_id: 'b', instances: [instance({ component: 'cmp-consent', semantic_context: semantic({ role: 'main', name: null, unnamed: true }) })] }),
  ]);
  assert.equal(model.regions.length, 1);
  assert.deepEqual(model.regions[0].components, [{ id: 'cmp-consent', findings: 2 }]);
});

test('regions: representatives are distinct across findings and capped', () => {
  const findings = Array.from({ length: MAX_GROUP_REPRESENTATIVES + 2 }, (_, index) => finding({
    rule_id: `rule-${index}`,
    instances: [instance({
      url: `https://example.gov/${index}`,
      target: `button.n${index}`,
      semantic_context: semantic({ role: 'main', name: null, unnamed: true }),
    })],
  }));
  const model = buildRegionGroups(findings);
  assert.equal(model.regions[0].representative.length, MAX_GROUP_REPRESENTATIVES);

  const repeated = buildRegionGroups([
    finding({ rule_id: 'a' }),
    finding({ rule_id: 'b' }),
  ]);
  assert.equal(repeated.regions[0].representative.length, 1);
});

test('regionOf: an unnamed region keeps a stable key and a readable label', () => {
  assert.deepEqual(
    regionOf(instance({ semantic_context: semantic({ role: 'main', name: null, unnamed: true }) })),
    { key: 'main|', role: 'main', name: null, label: 'main (unnamed)', unclassified: false }
  );
  assert.equal(regionOf(instance()), null);
});

test('component groups: a configured signature wins over the widget role', () => {
  const model = buildComponentGroups([
    finding({ instances: [instance({ component: 'cmp-consent', semantic_context: semantic({ role: 'main', name: null, unnamed: true }, { role: 'dialog', name: 'Privacy', unnamed: false }) })] }),
  ], { signatures: [{ id: 'cmp-consent', label: 'Consent dialog' }] });
  assert.equal(model.groups.length, 1);
  const [group] = model.groups;
  assert.equal(group.label, 'Consent dialog');
  assert.equal(group.attribution, 'configured');
  assert.equal(group.implementation, 'cmp-consent');
  assert.equal(group.ownership_established, false);
  assert.deepEqual(group.regions, [{ key: 'main|', findings: 1 }]);
});

test('component groups: a widget without a configured component is only a candidate', () => {
  const model = buildComponentGroups([
    finding({ instances: [instance({ semantic_context: semantic({ role: 'main', name: null, unnamed: true }, { role: 'dialog', name: 'Privacy', unnamed: false }) })] }),
  ]);
  const [group] = model.groups;
  assert.equal(group.type, 'widget:dialog');
  assert.equal(group.label, 'dialog');
  assert.equal(group.attribution, 'candidate');
  assert.equal(group.implementation, null);
  assert.equal(group.ownership_established, false);
  assert.equal(group.stored_instances, 1);
  assert.equal(model.attributed, 1);
  assert.equal(model.unattributed, 0);
});

test('component groups: findings with neither component nor widget stay unattributed', () => {
  const model = buildComponentGroups([finding()]);
  assert.equal(model.groups.length, 0);
  assert.equal(model.unattributed, 1);
  assert.equal(model.attributed, 0);
});

test('component groups: pages and instances are summed with a sample basis', () => {
  const model = buildComponentGroups([
    finding({ pages: 2, instances_total: 4, instances: [instance({ component: 'cmp', semantic_context: semantic({ role: 'main', name: null, unnamed: true }) })] }),
    finding({ pages: 3, instances_total: 6, instances: [instance({ component: 'cmp', semantic_context: semantic({ role: 'main', name: null, unnamed: true }) })] }),
  ]);
  const [group] = model.groups;
  assert.equal(group.findings, 2);
  assert.equal(group.pages_affected_sum, 5);
  assert.equal(group.instances_total, 10);
  assert.equal(group.stored_instances, 2);
  assert.equal(group.instance_identity, 'page_url_and_selector_of_stored_examples');
  assert.equal(model.basis, 'stored_examples');
});

test('findingsFromRules normalizes the aggregate rule models', () => {
  const findings = findingsFromRules({
    axe: { 'button-name': { count: 7, pages: 4, instances: [instance()] } },
    alfa: { 'sia-r8': { count: 2, pages: 1 } },
  });
  assert.equal(findings.length, 2);
  assert.deepEqual(findings[0], { engine_key: 'axe-core', rule_id: 'button-name', pages: 4, instances_total: 7, instances: [instance()] });
  assert.equal(findings[1].instances_total, 2);
  assert.deepEqual(findings[1].instances, []);
});
