import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { runAxe } from '../../src/engines/axe.js';
import { attachElementEvidence } from '../../src/lib/element-evidence.js';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const FIXTURE = pathToFileURL(path.join(ROOT, 'tests', 'fixtures', 'evidence-deep.html')).href;

async function collect() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(FIXTURE, { waitUntil: 'load' });
    const axe = await runAxe(page);
    await attachElementEvidence(page, axe);
    return axe;
  } finally {
    await browser.close();
  }
}

test('every stored example gets its own coherent evidence', async () => {
  const axe = await collect();
  const examples = axe.violations['button-name'].examples;
  assert.equal(examples.length, 3);
  for (const example of examples) {
    assert.equal(example.element.available, true);
    assert.equal(example.element.selector, example.target);
    assert.ok(example.semantic_context, 'semantic context captured for each example');
  }
  const ids = new Set(examples.map((example) => example.element.id));
  assert.equal(ids.size, 3, 'three distinct elements, not one repeated');
});

test('deep layout wrappers do not hide main or the named region/form', async () => {
  const axe = await collect();
  const deep = axe.violations['button-name'].examples.find((example) => example.element.id === 'deep-button');
  assert.ok(deep, 'deep button captured');
  assert.equal(deep.semantic_context.ancestry_complete, true);
  assert.ok(deep.semantic_context.ancestry_depth > 12, `walked the full chain (${deep.semantic_context.ancestry_depth})`);
  const roles = deep.semantic_context.region_ancestry.map((region) => region.role);
  assert.deepEqual(roles, ['main', 'region', 'form']);
  assert.equal(deep.semantic_context.nearest_region.role, 'form');
  assert.equal(deep.semantic_context.nearest_region.name, 'Search form');
  assert.ok(!roles.includes('banner'), 'a header inside main is not the page banner');
  assert.ok(deep.semantic_context.path.length <= 5, 'layout wrappers are not serialized');
  assert.ok(deep.element.rect_page.y >= deep.element.rect.y, 'page coordinates are recorded for screenshots');
  assert.deepEqual(axe.context.scroll, { x: 0, y: 0 }, 'scroll position is recorded with the render context');
});

test('a dialog outside landmarks keeps dialog context and stays unclassified', async () => {
  const axe = await collect();
  const dialogs = axe.violations['button-name'].examples.filter((example) => example.element.id?.startsWith('dialog-'));
  assert.equal(dialogs.length, 2);
  for (const dialog of dialogs) {
    assert.equal(dialog.semantic_context.nearest_region, null);
    assert.equal(dialog.semantic_context.unclassified, true);
    assert.equal(dialog.semantic_context.in_dialog, true);
    assert.equal(dialog.semantic_context.widget.role, 'dialog');
  }
  assert.equal(dialogs[0].semantic_context.widget.name, 'Consent A');
  assert.equal(dialogs[1].semantic_context.widget.name, 'Consent B');
  assert.notEqual(dialogs[0].element.id, dialogs[1].element.id);
});

test('unnamed section and form are recorded but not promoted to landmarks', async () => {
  const axe = await collect();
  const link = axe.violations['link-name'].examples.find((example) => example.element.id === 'unnamed-link');
  assert.ok(link, 'unnamed link captured');
  assert.equal(link.semantic_context.nearest_region.role, 'main');
  const unnamed = link.semantic_context.unnamed_landmarks.map((entry) => entry.role);
  assert.ok(unnamed.includes('region'));
  assert.ok(unnamed.includes('form'));
  assert.ok(!link.semantic_context.region_ancestry.some((region) => region.role === 'region'), 'unnamed section is not a region');
  assert.ok(!link.semantic_context.region_ancestry.some((region) => region.role === 'form'), 'unnamed form is not a landmark');
});

test('text-bearing elements keep a bounded visible text anchor', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<main><p style="color:#ddd;background:#fff">Low contrast passage for the text anchor.</p></main>');
    const axe = await runAxe(page);
    await attachElementEvidence(page, axe);
    const example = axe.violations['color-contrast']?.examples?.[0];
    assert.ok(example, 'color-contrast example captured');
    assert.match(example.element.text_anchor, /Low contrast passage/);
    assert.ok(example.element.text_anchor.length <= 80);
  } finally {
    await browser.close();
  }
});
