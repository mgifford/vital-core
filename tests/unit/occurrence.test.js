import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildBugReports } from '../../src/lib/bug-report.js';
import { reproductionPlan } from '../../src/lib/reproduction.js';
import {
  occurrenceId,
  normalizeOccurrence,
  occurrencesFor,
  selectRepresentative,
  occurrenceSummary,
} from '../../src/lib/occurrence.js';

const sha = (...parts) => crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 8);
const PATTERN = `VS-${sha('axe-core', 'button-name')}`;
const ANCHOR = (url, target) => `VS-${sha(PATTERN, url, target)}`;

const semantic = (role = 'main') => ({
  nearest_region: { role, name: null, unnamed: true },
  region_ancestry: [{ role, name: null, unnamed: true }],
  widget: null, widget_ancestry: [], path: [{ role, name: null, unnamed: true }],
  in_dialog: false, unnamed_landmarks: [], unclassified: false,
  ancestry_complete: true, ancestry_depth: 4,
});

const element = (selector, over = {}) => ({
  available: true, selector, selector_matches: 1, tag: 'button', role: null,
  name: 'Go', name_source: 'aria-label', labelledby_ids: [], id: null,
  shadow: false, iframe: false, visible: true, rect: { x: 1, y: 2, width: 3, height: 4 },
  ...over,
});

const instance = (over = {}) => ({
  url: 'https://example.gov/a', target: '#a', html: '<button>',
  element: element('#a'), semantic_context: semantic(),
  page_id: 'page-a', run_id: 'run-1', scanned_at: '2026-11-01T00:00:00.000Z',
  engine_version: '4.12.1', consent_state: 'no_dialog',
  browser_context: { viewport: { width: 1280, height: 800 }, color_scheme: 'light', forced_colors: 'none', reduced_motion: 'no-preference', locale: 'en' },
  ...over,
});

const summary = (instances) => ({
  domain: 'example.gov', week: '2026-W25', generatedAt: '2026-11-06T00:00:00.000Z', pagesScanned: 3,
  axe: {
    version: '4.12.1',
    context: { viewport: { width: 999, height: 999 }, color_scheme: 'dark', forced_colors: 'active', reduced_motion: 'reduce', locale: 'fr' },
    rules: {
      'button-name': {
        count: 4, pages: 2, impact: 'serious', help: 'Buttons need text', helpUrl: null, tags: ['wcag412'],
        examplePages: ['https://example.gov/a'], affectedPages: [{ url: 'https://example.gov/a', instances: 2 }],
        instances,
      },
    },
  },
  alfa: { rules: {} }, deprecatedHtml: { rules: {} },
});

test('occurrence identity is stable and component-aware', () => {
  const one = occurrenceId(PATTERN, instance());
  assert.match(one, /^VO-[0-9a-f]{8}$/);
  assert.equal(occurrenceId(PATTERN, instance()), one, 'same occurrence keeps its id');
  assert.notEqual(occurrenceId(PATTERN, instance({ component: 'cmp-a' })), occurrenceId(PATTERN, instance({ component: 'cmp-b' })));
  assert.notEqual(occurrenceId(PATTERN, instance({ target: '#b' })), one);
  const normalized = normalizeOccurrence(instance(), 0, { patternId: PATTERN, engineKey: 'axe-core' });
  assert.equal(normalized.completeness, 'complete');
  assert.equal(normalized.observation.engine_version, '4.12.1');
});

test('representative selection prefers complete evidence, then partial, then availability', () => {
  const unavailable = normalizeOccurrence(instance({ element: null, semantic_context: null }), 0, { patternId: PATTERN });
  const partial = normalizeOccurrence(instance({ semantic_context: null }), 1, { patternId: PATTERN });
  const complete = normalizeOccurrence(instance({ target: '#c' }), 2, { patternId: PATTERN });
  assert.equal(selectRepresentative([unavailable, partial, complete]).occurrence_id, complete.occurrence_id);
  assert.equal(selectRepresentative([unavailable, partial]).occurrence_id, partial.occurrence_id);
  assert.equal(selectRepresentative([unavailable]).occurrence_id, unavailable.occurrence_id);
  assert.equal(selectRepresentative([]), null);
  const counts = occurrenceSummary([unavailable, partial, complete], complete);
  assert.deepEqual(
    { total: counts.occurrences_total, complete: counts.complete_occurrences, partial: counts.partial_occurrences, unavailable: counts.unavailable_occurrences },
    { total: 3, complete: 1, partial: 1, unavailable: 1 }
  );
});

test('a report uses one whole occurrence, never fields from different observations', () => {
  const first = instance({ url: 'https://example.gov/a', target: '#a', element: null, semantic_context: null, browser_context: { viewport: { width: 100, height: 100 } } });
  const second = instance({
    url: 'https://example.gov/b', target: '#b', element: element('#b'), page_id: 'page-b', scanned_at: '2026-11-02T00:00:00.000Z',
    browser_context: { viewport: { width: 390, height: 844 }, color_scheme: 'dark', forced_colors: 'active', reduced_motion: 'reduce', locale: 'fr' },
  });
  const [report] = buildBugReports({ domain: 'example.gov', key: 'example.gov' }, summary([first, second]));
  assert.equal(report.instance_id, ANCHOR('https://example.gov/a', '#a'), 'historical anchor still uses the first instance');
  assert.equal(report.occurrence_selection, 'complete');
  assert.equal(report.url, 'https://example.gov/b');
  assert.equal(report.selector, '#b');
  assert.equal(report.element.selector, '#b');
  assert.equal(report.semantic_context.nearest_region.role, 'main');
  assert.deepEqual(report.browser_context.viewport, { width: 390, height: 844 }, 'context comes from the same occurrence');
  assert.equal(report.observation.scanned_at, '2026-11-02T00:00:00.000Z');
  assert.equal(report.evidence.complete_occurrences, 1);
  assert.equal(report.evidence.unavailable_occurrences, 1);
  // The examples stay coherent individually.
  assert.equal(report.examples[0].url, 'https://example.gov/a');
  assert.equal(report.examples[0].element, null);
  assert.deepEqual(report.examples[0].browser_context.viewport, { width: 100, height: 100 });
  assert.equal(report.examples[1].url, 'https://example.gov/b');
  assert.equal(report.examples[1].element.selector, '#b');
  assert.deepEqual(report.examples[1].browser_context.viewport, { width: 390, height: 844 });
  assert.notEqual(report.examples[0].occurrence_id, report.examples[1].occurrence_id);
  // A reproduction plan must use the same occurrence's URL, selector and context.
  const plan = reproductionPlan(report);
  assert.equal(plan.url, 'https://example.gov/b');
  assert.equal(plan.selector, '#b');
  assert.equal(plan.occurrence_id, report.occurrence_id);
  assert.deepEqual(plan.context.viewport, { width: 390, height: 844 });
});

test('historical occurrences without evidence do not borrow the week context', () => {
  const legacy = instance({ element: null, semantic_context: null, browser_context: null, page_id: null, scanned_at: null, engine_version: null });
  const [report] = buildBugReports({ domain: 'example.gov', key: 'example.gov' }, summary([legacy]));
  assert.equal(report.occurrence_selection, 'unavailable');
  assert.equal(report.element, null);
  assert.equal(report.semantic_context, null);
  assert.equal(report.browser_context, null, 'summary.axe.context is not substituted');
  assert.equal(report.evidence.element_identity, 'not-captured');
  assert.equal(report.examples[0].occurrence_id.startsWith('VO-'), true);
});

test('identical selectors in different components keep distinct occurrence identities', () => {
  const a = instance({ component: 'cmp-a', semantic_context: semantic('main') });
  const b = instance({ component: 'cmp-b', semantic_context: semantic('navigation') });
  const [report] = buildBugReports({ domain: 'example.gov', key: 'example.gov' }, summary([a, b]));
  assert.notEqual(report.examples[0].occurrence_id, report.examples[1].occurrence_id);
  assert.equal(report.examples[0].component, 'cmp-a');
  assert.equal(report.examples[1].component, 'cmp-b');
  assert.equal(report.examples[1].semantic_context.nearest_region.role, 'navigation');
});

test('multiple occurrences across URLs and on one page each retain their own evidence', () => {
  const one = instance({ url: 'https://example.gov/a', target: '#one' });
  const two = instance({ url: 'https://example.gov/a', target: '#two', browser_context: { viewport: { width: 800, height: 600 } } });
  const three = instance({ url: 'https://example.gov/c', target: '#three', consent_state: 'dialog_open_then_clicked' });
  const report = buildBugReports({ domain: 'example.gov', key: 'example.gov' }, summary([one, two, three]))[0];
  assert.equal(report.examples.length, 3);
  assert.deepEqual(report.examples.map((example) => example.url), ['https://example.gov/a', 'https://example.gov/a', 'https://example.gov/c']);
  assert.deepEqual(report.examples.map((example) => example.selector), ['#one', '#two', '#three']);
  assert.equal(report.examples[1].browser_context.viewport.width, 800);
  assert.equal(report.examples[2].observation.consent_state, 'dialog_open_then_clicked');
});

test('occurrencesFor keeps capture order and defaults missing provenance to null', () => {
  const list = occurrencesFor({ instances: [{ url: 'https://example.gov/a', target: '#a' }, { url: 'https://example.gov/b', target: '#b' }] }, { patternId: PATTERN });
  assert.equal(list.length, 2);
  assert.equal(list[0].index, 0);
  assert.equal(list[1].index, 1);
  assert.equal(list[0].element, null);
  assert.equal(list[0].observation.engine_version, null);
  assert.equal(list[0].browser_context, null);
});
