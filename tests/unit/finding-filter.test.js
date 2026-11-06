import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findingRegionKey,
  findingRegionLabel,
  findingComponentKey,
  findingComponentLabel,
  findingWidgetKey,
  findingWidgetLabel,
  filterFindings,
  filterOptions,
} from '../../src/lib/finding-filter.js';

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

const bug = (over = {}) => ({
  instance_id: 'VS-a',
  pattern_id: 'VS-p',
  rule_id: 'button-name',
  rule_label: 'Buttons must have discernible text',
  summary: 'Button name',
  url: 'https://example.gov/a',
  engine_key: 'axe-core',
  severity: 'Serious',
  wcag_sc: '4.1.2',
  semantic_context: semantic({ role: 'main', name: null, unnamed: true }),
  ...over,
});

test('region keys and labels distinguish named, unnamed, unclassified and unknown', () => {
  assert.equal(findingRegionKey(bug()), 'main|');
  assert.equal(findingRegionLabel(bug()), 'main (unnamed)');
  assert.equal(findingRegionKey(bug({ semantic_context: semantic({ role: 'navigation', name: 'Primary', unnamed: false }) })), 'navigation|Primary');
  assert.equal(findingRegionLabel(bug({ semantic_context: semantic({ role: 'navigation', name: 'Primary', unnamed: false }) })), 'navigation "Primary"');
  assert.equal(findingRegionKey(bug({ semantic_context: semantic(null) })), 'unclassified');
  assert.equal(findingRegionLabel(bug({ semantic_context: semantic(null) })), 'unclassified (no landmark)');
  assert.equal(findingRegionKey(bug({ semantic_context: null })), 'unknown');
});

test('component and widget are separate identities', () => {
  const configured = bug({ component_scope: { component_id: 'cmp-consent', component_label: 'Consent dialog' } });
  assert.equal(findingComponentKey(configured), 'component:cmp-consent');
  assert.equal(findingComponentLabel(configured), 'Consent dialog');

  const widget = bug({ semantic_context: semantic({ role: 'main', name: null, unnamed: true }, { role: 'dialog', name: 'Privacy', unnamed: false }) });
  assert.equal(findingComponentKey(widget), '', 'a widget is not a component');
  assert.equal(findingComponentLabel(widget), 'unattributed');
  assert.equal(findingWidgetKey(widget), 'widget:dialog');
  assert.equal(findingWidgetLabel(widget), 'dialog');

  const plain = bug();
  assert.equal(findingComponentKey(plain), '');
  assert.equal(findingWidgetKey(plain), '');
  assert.equal(findingWidgetLabel(plain), 'no widget');
});

test('filterFindings applies every filter and a case-insensitive query', () => {
  const bugs = [
    bug(),
    bug({ instance_id: 'VS-b', engine_key: 'alfa', severity: 'Minor', wcag_sc: '1.4.3', rule_id: 'sia-r69', rule_label: 'Contrast', url: 'https://example.gov/b' }),
    bug({ instance_id: 'VS-c', url: 'https://example.gov/c', semantic_context: semantic(null) }),
  ];
  assert.equal(filterFindings(bugs).length, 3);
  assert.deepEqual(filterFindings(bugs, { engine: 'alfa' }).map((b) => b.instance_id), ['VS-b']);
  assert.deepEqual(filterFindings(bugs, { severity: 'Minor' }).map((b) => b.instance_id), ['VS-b']);
  assert.deepEqual(filterFindings(bugs, { wcag: '4.1.2' }).map((b) => b.instance_id), ['VS-a', 'VS-c']);
  assert.deepEqual(filterFindings(bugs, { region: 'unclassified' }).map((b) => b.instance_id), ['VS-c']);
  const dialog = bug({ instance_id: 'VS-d', semantic_context: semantic({ role: 'main', name: null, unnamed: true }, { role: 'dialog', name: 'Privacy', unnamed: false }) });
  assert.deepEqual(filterFindings([...bugs, dialog], { widget: 'widget:dialog' }).map((b) => b.instance_id), ['VS-d']);
  assert.equal(filterFindings([...bugs, dialog], { component: 'component:cmp-consent' }).length, 0, 'widget is not a component filter');
  assert.deepEqual(filterFindings(bugs, { query: 'CONTRAST' }).map((b) => b.instance_id), ['VS-b']);
  assert.deepEqual(filterFindings(bugs, { query: 'example.gov/a' }).map((b) => b.instance_id), ['VS-a']);
  assert.equal(filterFindings(bugs, { query: 'nothing matches' }).length, 0);
  assert.equal(filterFindings(null).length, 0);
});

test('filterOptions counts regions, components, engines and severities', () => {
  const bugs = [
    bug(),
    bug({ instance_id: 'VS-b' }),
    bug({ instance_id: 'VS-c', url: 'https://example.gov/c', semantic_context: semantic(null) }),
    bug({ instance_id: 'VS-d', engine_key: 'alfa', severity: 'Minor', semantic_context: null }),
  ];
  const options = filterOptions(bugs);
  const main = options.regions.find((entry) => entry.key === 'main|');
  assert.equal(main.count, 2);
  assert.equal(main.label, 'main (unnamed)');
  assert.ok(options.regions.some((entry) => entry.key === 'unclassified'));
  assert.ok(options.regions.some((entry) => entry.key === 'unknown'));
  assert.deepEqual(options.widgets, []);
  assert.deepEqual(options.components, [], 'no configured components in this fixture');
  assert.deepEqual(options.severities.map((entry) => entry.key), ['Serious', 'Minor']);
  assert.deepEqual(options.engines.map((entry) => entry.key), ['axe-core', 'alfa']);
});

test('the filter functions are self-contained enough to run in the browser', () => {
  const source = [findingRegionKey, findingRegionLabel, findingWidgetKey, findingWidgetLabel, findingComponentKey, findingComponentLabel, filterFindings, filterOptions]
    .map((fn) => fn.toString())
    .join('\n');
  // No module scope is available here: stringification must carry everything.
  const browserFilterFindings = new Function(`${source}\nreturn filterFindings;`)();
  const bugs = [bug(), bug({ instance_id: 'VS-b', semantic_context: semantic(null) })];
  assert.deepEqual(browserFilterFindings(bugs, { region: 'unclassified' }).map((b) => b.instance_id), ['VS-b']);
  const browserFilterOptions = new Function(`${source}\nreturn filterOptions;`)();
  assert.equal(browserFilterOptions(bugs).regions.length, 2);
});
