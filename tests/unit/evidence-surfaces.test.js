import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBugReports } from '../../src/lib/bug-report.js';
import { sanitizeBugEvidence } from '../../src/lib/finding-reporting.js';
import { reproductionPlan } from '../../src/lib/reproduction.js';
import { inspectCodeFor, decodeInspectToken, inspectUnavailableReason } from '../../src/lib/live-inspect.js';
import { textFragmentUrl } from '../../src/lib/text-fragment.js';
import { markerGeometry } from '../../src/lib/screenshots.js';
import { manualReviewRecord } from '../../src/lib/manual-validation.js';
import { renderAccessibilityPage, renderExplorerPage } from '../../src/report-html.js';

const target = { key: 'fixture.test', domain: 'fixture.test', retention_weeks: 2, reporting: {} };
const shot = { available: true, file: 'screenshots/page.jpg', file_name: 'page.jpg', width: 1280, height: 800, full_page: true, captured_at: '2026-11-03T00:00:00.000Z', format: 'jpeg', bytes: 1000 };

function instance({ selector, tag = 'button', role = null, name = null, nameSource = 'none', text = null, region = { role: 'main', name: null }, widget = null, component = null, shadow = false, iframe = false, run = 'run-1', page = 'page-1' }) {
  return {
    url: `https://fixture.test/${page}`,
    target: selector,
    html: `<${tag}></${tag}>`,
    component,
    page_id: page,
    run_id: run,
    scanned_at: '2026-11-03T00:00:00.000Z',
    engine_version: '4.12.1',
    consent_state: 'no_dialog',
    browser_context: { viewport: { width: 1280, height: 800 }, color_scheme: 'light', forced_colors: 'none', reduced_motion: 'no-preference', locale: 'en' },
    screenshot: shot,
    element: {
      available: true,
      selector,
      tag,
      role,
      name,
      name_source: nameSource,
      shadow,
      iframe,
      visible: true,
      rect: { x: 10, y: 20, width: 100, height: 30 },
      rect_page: { x: 10, y: 20, width: 100, height: 30 },
      text_anchor: text,
    },
    semantic_context: {
      nearest_region: region,
      region_ancestry: [region],
      widget,
      widget_ancestry: widget ? [widget] : [],
      path: widget ? [region, widget] : [region],
      in_dialog: widget?.role === 'dialog',
      unnamed_landmarks: [],
      unclassified: false,
      ancestry_complete: true,
      ancestry_depth: 4,
    },
  };
}

function rule(instances) {
  return { count: instances.length, pages: instances.length, impact: 'serious', tags: [], instances };
}

function summary(rules) {
  return {
    week: '2026-W45',
    pagesScanned: 4,
    axe: { version: '4.12.1', rules },
    alfa: { version: null, rules: {} },
  };
}

const scenarios = {
  header: instance({ selector: 'header', tag: 'header', region: { role: 'banner', name: null } }),
  footer: instance({ selector: 'footer', tag: 'footer', region: { role: 'contentinfo', name: null } }),
  nav: instance({ selector: 'nav.primary', tag: 'nav', role: 'navigation', name: 'Primary', nameSource: 'aria-label', region: { role: 'navigation', name: 'Primary' } }),
  search: instance({ selector: 'form.search', tag: 'form', role: 'search', name: 'Site search', nameSource: 'aria-label', region: { role: 'search', name: 'Site search' }, widget: { role: 'search', name: 'Site search' } }),
  field: instance({ selector: '#email', tag: 'input', name: null, region: { role: 'main', name: null } }),
  dialog: instance({ selector: '#prefs', tag: 'div', role: 'dialog', name: 'Preferences', nameSource: 'aria-label', widget: { role: 'dialog', name: 'Preferences' } }),
  consent: instance({ selector: '.consent', tag: 'div', role: 'dialog', name: 'Privacy', nameSource: 'aria-label', widget: { role: 'dialog', name: 'Privacy' }, component: 'cmp-consent' }),
  dynamic: instance({ selector: '#dynamic', text: 'Dynamic section' }),
  shadow: instance({ selector: '#shadow-button', shadow: true }),
  iframe: instance({ selector: 'iframe#content', iframe: true }),
  document: { ...instance({ selector: 'html' }), element: null, semantic_context: null },
  identical: instance({ selector: '.same', tag: 'button', name: 'Save', nameSource: 'aria-label', component: 'cmp-a', page: 'page-a' }),
};

test('one finding per controlled scenario keeps occurrence, observation and stable references coherent across surfaces', () => {
  const rules = {};
  for (const [id, example] of Object.entries(scenarios)) rules[`scenario-${id}`] = rule([example]);
  rules['scenario-identical'] = rule([
    scenarios.identical,
    instance({ selector: '.same', tag: 'button', name: 'Save', nameSource: 'aria-label', component: 'cmp-b', page: 'page-b' }),
  ]);
  const bugs = buildBugReports(target, summary(rules));
  assert.equal(bugs.length, Object.keys(scenarios).length);

  for (const bug of bugs) {
    assert.match(bug.finding_ref, /^VFR-[0-9a-f]{8}$/);
    assert.match(bug.occurrence_id, /^VO-[0-9a-f]{8}$/);
    assert.match(bug.observation_id, /^VOB-[0-9a-f]{8}$/);
    assert.equal(bug.examples.length, bug.rule_id === 'scenario-identical' ? 2 : 1);

    const representative = bug.examples.find((example) => example.occurrence_id === bug.occurrence_id);
    assert.ok(representative, 'representative exists among examples');
    assert.equal(representative.observation_id, bug.observation_id);
    assert.equal(representative.url, bug.url);
    assert.equal(representative.selector, bug.selector);

    const sanitized = sanitizeBugEvidence(bug);
    assert.equal(sanitized.finding_ref, bug.finding_ref);
    assert.equal(sanitized.occurrence_id, bug.occurrence_id);
    assert.equal(sanitized.observation_id, bug.observation_id);
    assert.equal(sanitized.evidence_reference.observation_id, bug.observation_id);

    const plan = reproductionPlan(bug);
    if (bug.rule_id === 'scenario-shadow' || bug.rule_id === 'scenario-iframe') {
      assert.equal(plan.status, 'unavailable');
      assert.equal(plan.reason, 'frame-or-shadow-boundary');
    } else if (bug.rule_id === 'scenario-document') {
      assert.equal(plan.status, 'unavailable');
      assert.equal(plan.reason, 'element-evidence-unavailable');
    } else {
      assert.equal(plan.status, 'not_attempted');
      assert.equal(plan.occurrence_id, bug.occurrence_id);
      assert.equal(plan.observation_id, bug.observation_id);
      if (bug.rule_id === 'scenario-identical') {
        assert.equal(plan.selector, '.same');
      }
    }

    const code = inspectCodeFor(bug);
    if (code) {
      const payload = decodeInspectToken(code);
      assert.equal(payload.id, bug.occurrence_id);
      assert.equal(payload.obs, bug.observation_id);
      assert.equal(payload.ref, bug.finding_ref);
      assert.equal(payload.org, 'https://fixture.test');
      assert.equal(payload.s, bug.selector);
    } else {
      assert.ok(['scenario-shadow', 'scenario-iframe', 'scenario-document'].includes(bug.rule_id));
      assert.match(inspectUnavailableReason(bug), /frame-or-shadow|shadow-root|iframe|no-element/);
    }

    const textUrl = textFragmentUrl(bug);
    if (bug.element?.text_anchor) {
      assert.ok(textUrl);
      assert.match(textUrl, /#:~:text=/);
    }

    const manual = manualReviewRecord(bug);
    assert.equal(manual.finding.finding_ref, bug.finding_ref);
    assert.equal(manual.finding.occurrence_id, bug.occurrence_id);
    assert.equal(manual.finding.observation_id, bug.observation_id);

    if (bug.element?.rect_page && bug.screenshot) {
      const geometry = markerGeometry(bug.element.rect_page, bug.screenshot);
      assert.equal(geometry.visible, true);
    }
  }

  const identical = bugs.find((bug) => bug.rule_id === 'scenario-identical');
  assert.equal(new Set(identical.examples.map((example) => example.occurrence_id)).size, 2, 'same selector with different components has distinct occurrences');
  assert.notEqual(identical.examples[0].occurrence_id, identical.examples[1].occurrence_id);
  assert.notEqual(identical.examples[0].observation_id, identical.examples[1].observation_id, 'each occurrence has its own scan observation');

  const html = renderAccessibilityPage(target, summary(rules), bugs, { byRule: {}, bugsAll: null }, { keyPages: [] });
  assert.match(html, new RegExp(`id="${identical.finding_ref}"`), 'stable reference anchor is rendered');
  assert.match(html, new RegExp(identical.observation_id), 'observation id is rendered');
  const explorer = renderExplorerPage(target, summary(rules), bugs, { bugsJson: 'bugs.json' });
  assert.match(explorer, new RegExp(identical.instance_id));
});

test('finding_ref survives an added page while the legacy first-example anchor does not', () => {
  const a = instance({ selector: '#a', page: 'page-a' });
  const c = instance({ selector: '#c', page: 'page-c' });
  const one = buildBugReports(target, summary({ 'scenario-stable': rule([a]) }))[0];
  const two = buildBugReports(target, summary({ 'scenario-stable': rule([c, a]) }))[0];
  assert.equal(one.finding_ref, two.finding_ref, 'content-independent reference is stable');
  assert.notEqual(one.instance_id, two.instance_id, 'legacy first-example anchor is sample-order dependent');
  const aOccurrence = one.examples[0];
  const aAgain = two.examples.find((example) => example.selector === '#a');
  assert.equal(aOccurrence.occurrence_id, aAgain.occurrence_id, 'the occurrence itself keeps identity');
  assert.equal(aOccurrence.observation_id, aAgain.observation_id, 'the scan observation keeps identity');
});

test('observation identity changes with a new run but occurrence identity does not', () => {
  const a = instance({ selector: '#a', run: 'run-1' });
  const b = { ...a, run_id: 'run-2' };
  const one = buildBugReports(target, summary({ 'scenario-run': rule([a]) }))[0];
  const two = buildBugReports(target, summary({ 'scenario-run': rule([b]) }))[0];
  assert.equal(one.occurrence_id, two.occurrence_id);
  assert.notEqual(one.observation_id, two.observation_id);
});
