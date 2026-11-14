import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSemanticContext, roleFor, scopedBySectioning, MAX_ANCESTRY, MAX_NAME } from '../../src/lib/semantic-context.js';

const roles = (context) => context.region_ancestry.map((entry) => entry.role);

test('semantic: main > nav resolves the nearest landmark and the ancestry', () => {
  const context = resolveSemanticContext([
    { tag: 'body' },
    { tag: 'main' },
    { tag: 'nav', name: 'Primary' },
    { tag: 'a' },
  ]);
  assert.deepEqual(roles(context), ['main', 'navigation']);
  assert.equal(context.nearest_region.role, 'navigation');
  assert.equal(context.nearest_region.name, 'Primary');
  assert.equal(context.unclassified, false);
  assert.equal(context.in_dialog, false);
});

test('semantic: a header at the top of the document is the banner', () => {
  const context = resolveSemanticContext([{ tag: 'body' }, { tag: 'header' }, { tag: 'a' }]);
  assert.deepEqual(roles(context), ['banner']);
});

test('semantic: a header scoped to main/aside/article/nav/section is not the banner', () => {
  for (const scope of ['main', 'aside', 'article', 'nav', 'section']) {
    const context = resolveSemanticContext([{ tag: 'body' }, { tag: scope }, { tag: 'header' }]);
    assert.ok(!roles(context).includes('banner'), `${scope} > header must not be banner`);
  }
});

test('semantic: a footer at the top of the document is contentinfo', () => {
  const context = resolveSemanticContext([{ tag: 'body' }, { tag: 'footer' }]);
  assert.deepEqual(roles(context), ['contentinfo']);
});

test('semantic: unnamed section and form are recorded as unnamed, not as landmarks', () => {
  const context = resolveSemanticContext([
    { tag: 'main' },
    { tag: 'section' },
    { tag: 'form' },
  ]);
  assert.deepEqual(roles(context), ['main']);
  assert.deepEqual(context.unnamed_landmarks, [
    { tag: 'section', role: 'region' },
    { tag: 'form', role: 'form' },
  ]);
});

test('semantic: a named section is a region and a named form is a form landmark', () => {
  const context = resolveSemanticContext([
    { tag: 'main' },
    { tag: 'section', name: 'Search', name_source: 'aria-label' },
    { tag: 'form', name: 'Site search', name_source: 'aria-labelledby' },
  ]);
  assert.deepEqual(roles(context), ['main', 'region', 'form']);
  assert.equal(context.nearest_region.role, 'form');
  assert.equal(context.nearest_region.name, 'Site search');
});

test('semantic: aside is complementary and an explicit role wins over the tag', () => {
  assert.deepEqual(roles(resolveSemanticContext([{ tag: 'aside' }])), ['complementary']);
  assert.deepEqual(roles(resolveSemanticContext([{ tag: 'div', role: 'search' }])), ['search']);
  assert.deepEqual(roles(resolveSemanticContext([{ tag: 'nav', role: 'search' }])), ['search']);
});

test('semantic: a dialog is a widget, not a landmark, and keeps the containing region', () => {
  const bare = resolveSemanticContext([{ tag: 'body' }, { tag: 'div', role: 'dialog', name: 'Privacy' }, { tag: 'button' }]);
  assert.equal(bare.nearest_region, null);
  assert.equal(bare.widget.role, 'dialog');
  assert.equal(bare.in_dialog, true);
  assert.equal(bare.unclassified, true);
  assert.deepEqual(bare.path.map((entry) => entry.role), ['dialog']);

  const nested = resolveSemanticContext([
    { tag: 'body' },
    { tag: 'main' },
    { tag: 'div', role: 'dialog', name: 'Privacy' },
    { tag: 'button' },
  ]);
  assert.deepEqual(roles(nested), ['main']);
  assert.equal(nested.widget.role, 'dialog');
  assert.deepEqual(nested.path.map((entry) => entry.role), ['main', 'dialog']);
  assert.equal(nested.unclassified, false);
});

test('semantic: landmarks and widgets are classified separately', () => {
  const context = resolveSemanticContext([
    { tag: 'nav', name: 'Account' },
    { tag: 'div', role: 'tablist' },
    { tag: 'button', role: 'tab' },
  ]);
  assert.deepEqual(roles(context), ['navigation']);
  assert.deepEqual(context.widget_ancestry.map((entry) => entry.role), ['tablist', 'tab']);
  assert.equal(context.widget.role, 'tab');
  assert.equal(context.in_dialog, false);
});

test('semantic: no meaningful structure is unclassified rather than invented', () => {
  const context = resolveSemanticContext([{ tag: 'body' }, { tag: 'div' }, { tag: 'div' }, { tag: 'span' }]);
  assert.equal(context.unclassified, true);
  assert.equal(context.nearest_region, null);
  assert.deepEqual(context.region_ancestry, []);
  assert.deepEqual(context.path, []);
});

test('semantic: an explicit role="region" without a name is unnamed', () => {
  const context = resolveSemanticContext([{ tag: 'div', role: 'region' }]);
  assert.equal(context.nearest_region, null);
  assert.deepEqual(context.unnamed_landmarks, [{ tag: 'div', role: 'region' }]);
});

test('semantic: only the bounded ancestry is considered, from the element outwards', () => {
  const ancestry = Array.from({ length: MAX_ANCESTRY + 4 }, (_, index) => ({ tag: index === 0 ? 'main' : 'div' }));
  ancestry.push({ tag: 'nav', name: 'Deep' });
  const context = resolveSemanticContext(ancestry);
  assert.deepEqual(roles(context), ['navigation']);
  assert.equal(context.nearest_region.name, 'Deep');
});

test('semantic: names are whitespace-normalised and bounded', () => {
  const context = resolveSemanticContext([{ tag: 'nav', name: `  Primary\n${'x'.repeat(200)}  ` }]);
  assert.equal(context.nearest_region.name.length, MAX_NAME);
  assert.ok(!context.nearest_region.name.includes('\n'));
});

test('semantic: scopedBySectioning ignores the node itself and sees ARIA sectioning roles', () => {
  assert.equal(scopedBySectioning([{ tag: 'article' }, { tag: 'header' }], 1), true);
  assert.equal(scopedBySectioning([{ tag: 'div', role: 'navigation' }, { tag: 'header' }], 1), true);
  assert.equal(scopedBySectioning([{ tag: 'body' }, { tag: 'header' }], 1), false);
  assert.equal(scopedBySectioning([{ tag: 'header' }], 0), false);
});

test('semantic: roleFor maps native elements and ignores unrelated explicit roles', () => {
  assert.equal(roleFor({ tag: 'main' }), 'main');
  assert.equal(roleFor({ tag: 'aside' }), 'complementary');
  assert.equal(roleFor({ tag: 'div', role: 'button' }), null);
  assert.equal(roleFor({ tag: 'div', role: 'navigation' }), 'navigation');
});
