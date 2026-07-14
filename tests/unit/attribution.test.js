import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRawHtmlIndex,
  parseOpeningTag,
  classifyRenderOrigin,
  annotateRenderOrigins,
  classifyAssetPath,
  classifyClassTokens,
  deriveAttribution,
} from '../../src/lib/attribution.js';

const RAW = `<!doctype html>
<html lang="en">
<head><title>Fixture</title><link rel="stylesheet" href="/themes/custom/agency/css/main.css"></head>
<body>
<main id="content">
  <img src="/sites/default/files/hero-image-spring.jpg" class="hero">
  <a href='/how-to-apply/eligibility-details'   class='cta'>Apply</a>
  <div class="views-row card">Item</div>
  <img data-src="/lazy/big-photo-of-building.jpg" class="lazyload">
  <button type="button" class="usa-button">Go</button>
</main>
</body></html>`;

test('render origin: element present verbatim in raw HTML is server', () => {
  const idx = createRawHtmlIndex(RAW);
  assert.equal(classifyRenderOrigin('<div class="views-row card">Item</div>', idx), 'server');
});

test('render origin: attribute reordering and quote style do not defeat the match', () => {
  const idx = createRawHtmlIndex(RAW);
  assert.equal(classifyRenderOrigin('<a class="cta" href="/how-to-apply/eligibility-details">Apply</a>', idx), 'server');
});

test('render origin: JS-added classes do not flip a server element to js-injected', () => {
  const idx = createRawHtmlIndex(RAW);
  assert.equal(
    classifyRenderOrigin('<img src="/sites/default/files/hero-image-spring.jpg" class="hero loaded fade-in">', idx),
    'server'
  );
});

test('render origin: lazy-loaded src matches the raw data-src value', () => {
  const idx = createRawHtmlIndex(RAW);
  assert.equal(classifyRenderOrigin('<img src="/lazy/big-photo-of-building.jpg" class="lazyload loaded">', idx), 'server');
});

test('render origin: element with a distinctive absent URL is js-injected', () => {
  const idx = createRawHtmlIndex(RAW);
  assert.equal(
    classifyRenderOrigin('<iframe src="https://chat.example-widget.com/frame/embedded-help"></iframe>', idx),
    'js-injected'
  );
});

test('render origin: absent tag name with no distinctive attrs is js-injected', () => {
  const idx = createRawHtmlIndex(RAW);
  assert.equal(classifyRenderOrigin('<dialog class="cookie-consent-modal-overlay">…</dialog>', idx), 'js-injected');
});

test('render origin: dynamic-looking id alone cannot prove js-injected', () => {
  const idx = createRawHtmlIndex(RAW);
  assert.equal(classifyRenderOrigin('<div id="widget-4f9a2b8c1d3e5a7f9b2c4d6e"></div>', idx), 'unknown');
});

test('render origin: truncated raw HTML can prove presence but never absence', () => {
  const idx = createRawHtmlIndex(RAW + ' '.repeat(600_000));
  assert.ok(idx.truncated);
  assert.equal(classifyRenderOrigin('<div class="views-row card">Item</div>', idx), 'server');
  assert.equal(classifyRenderOrigin('<dialog class="cookie-consent-modal-overlay">…</dialog>', idx), 'unknown');
});

test('render origin: missing index or unparseable snippet is unknown', () => {
  assert.equal(classifyRenderOrigin('<div class="x">', null), 'unknown');
  const idx = createRawHtmlIndex(RAW);
  assert.equal(classifyRenderOrigin('text without markup', idx), 'unknown');
  assert.equal(createRawHtmlIndex(''), null);
});

test('render origin: singleton tags match without attributes; generic tags stay unknown', () => {
  const idx = createRawHtmlIndex(RAW);
  assert.equal(classifyRenderOrigin('<main>', idx), 'server');
  assert.equal(classifyRenderOrigin('<div>', idx), 'unknown');
});

test('parseOpeningTag drops a possibly-truncated trailing attribute', () => {
  const parsed = parseOpeningTag('<a href="/full/value" class="btn btn-primary long-cl');
  assert.equal(parsed.tag, 'a');
  assert.equal(parsed.attrs.href, '/full/value');
  assert.equal('class' in parsed.attrs, false);
});

test('annotateRenderOrigins marks every kept example, unknown when capture failed', () => {
  const record = {
    axe: { violations: { 'image-alt': { examples: [{ target: 'img', html: '<img src="/sites/default/files/hero-image-spring.jpg" class="hero">' }] } } },
    alfa: { failed: { 'sia-r2': { examples: [{ target: '<img src="/sites/default/files/hero-image-spring.jpg">' }] } } },
    deprecatedHtml: { findings: { center: { examples: [{ target: 'center', html: '<center>old</center>' }] } } },
  };
  annotateRenderOrigins(record, createRawHtmlIndex(RAW));
  assert.equal(record.axe.violations['image-alt'].examples[0].render_origin, 'server');
  assert.equal(record.alfa.failed['sia-r2'].examples[0].render_origin, 'server');
  assert.equal(record.deprecatedHtml.findings.center.examples[0].render_origin, 'js-injected');

  annotateRenderOrigins(record, null);
  assert.equal(record.axe.violations['image-alt'].examples[0].render_origin, 'unknown');
});

test('asset paths classify per CMS file-layout conventions', () => {
  assert.deepEqual(classifyAssetPath('/wp-includes/js/jquery.js').layer, 'platform');
  assert.equal(classifyAssetPath('/wp-content/plugins/slider-pro/js/main.js').layer, 'platform');
  assert.equal(classifyAssetPath('/wp-content/themes/agency2024/style.css').layer, 'site-custom');
  assert.equal(classifyAssetPath('https://www.example.gov/core/misc/drupal.js').layer, 'platform');
  assert.equal(classifyAssetPath('/modules/contrib/webform/js/webform.js').layer, 'platform');
  assert.equal(classifyAssetPath('/themes/custom/agency/css/main.css').layer, 'site-custom');
  assert.equal(classifyAssetPath('/just/a/normal/page'), null);
});

test('class namespaces map to their products', () => {
  const matches = classifyClassTokens(['views-row', 'usa-button', 'unrelated']);
  assert.deepEqual(matches.map((m) => m.product).sort(), ['Drupal', 'USWDS']);
});

test('attribution: third-party iframe is third-party even when server-rendered (FR-08)', () => {
  const a = deriveAttribution({
    instances: [{ html: '<iframe src="https://www.youtube.com/embed/abc123xy"></iframe>', render_origin: 'server' }],
    pages: 3, totalPages: 50, siteTech: ['Drupal'], domain: 'www.example.gov',
  });
  assert.equal(a.layer, 'third-party');
  assert.ok(a.evidence.some((e) => e.signal === 'third-party-iframe' && e.supports === 'third-party'));
});

test('attribution: platform namespace requires tech agreement (FR-05)', () => {
  const instances = [{ html: '<div class="views-row"><a href="/x">x</a></div>', render_origin: 'server' }];
  const withTech = deriveAttribution({ instances, pages: 5, totalPages: 50, siteTech: ['Drupal'], domain: 'example.gov' });
  assert.equal(withTech.layer, 'platform');

  const withoutTech = deriveAttribution({ instances, pages: 5, totalPages: 50, siteTech: ['Apache'], domain: 'example.gov' });
  assert.equal(withoutTech.layer, 'undetermined');
  assert.ok(withoutTech.evidence.some((e) => e.signal === 'class-namespace' && e.supports === null && /not detected/.test(e.detail)));
});

test('attribution: conflicting medium-or-stronger evidence is surfaced, not resolved', () => {
  const a = deriveAttribution({
    instances: [
      { html: '<div class="views-row"><span>x</span></div>', render_origin: 'server' },
      { html: '<script src="https://cdn.widget-vendor.com/embed.js"></script>', render_origin: 'js-injected' },
    ],
    pages: 5, totalPages: 50, siteTech: ['Drupal'], domain: 'example.gov',
  });
  assert.equal(a.layer, 'undetermined');
  assert.ok(a.evidence.some((e) => e.supports === 'platform'));
  assert.ok(a.evidence.some((e) => e.supports === 'third-party'));
});

test('attribution: all-injected with no third-party markup evidence is site-custom (SPA case)', () => {
  const a = deriveAttribution({
    instances: [{ html: '<div class="app-card" role="listitem">x</div>', render_origin: 'js-injected' }],
    pages: 20, totalPages: 50, templateThreshold: 10, siteTech: ['React'], domain: 'example.gov',
  });
  assert.equal(a.layer, 'site-custom');
});

test('attribution: template-scale spread with server rendering supports site-custom', () => {
  const a = deriveAttribution({
    instances: [{ html: '<a class="header-link" href="/about-this-agency">About</a>', render_origin: 'server' }],
    pages: 40, totalPages: 50, templateThreshold: 10, siteTech: [], domain: 'example.gov',
  });
  assert.equal(a.layer, 'site-custom');
  assert.ok(a.evidence.some((e) => e.signal === 'page-spread'));
});

test('attribution: small server-rendered spread is content at low confidence', () => {
  const a = deriveAttribution({
    instances: [{ html: '<img src="/files/office-photo-large.jpg">', render_origin: 'server' }],
    pages: 1, totalPages: 50, siteTech: [], domain: 'example.gov',
  });
  assert.equal(a.layer, 'content');
});

test('attribution: mixed render origins cap confidence at low and state the split', () => {
  const a = deriveAttribution({
    instances: [
      { html: '<div class="views-row">a</div>', render_origin: 'server' },
      { html: '<div class="views-row">b</div>', render_origin: 'js-injected' },
    ],
    pages: 5, totalPages: 50, siteTech: ['Drupal'], domain: 'example.gov',
  });
  assert.equal(a.layer, 'platform');
  assert.equal(a.confidence, 'low');
  assert.ok(a.evidence.some((e) => e.signal === 'render-origin' && /1 of 2/.test(e.detail)));
});

test('attribution: no instances and no signals is undetermined', () => {
  const a = deriveAttribution({ instances: [], pages: 5, totalPages: 50, siteTech: [], domain: 'example.gov' });
  assert.equal(a.layer, 'undetermined');
  assert.equal(a.confidence, 'low');
});

test('attribution: asset path with tech agreement gives strong platform evidence', () => {
  const a = deriveAttribution({
    instances: [{ html: '<script src="/wp-includes/js/jquery/jquery.min.js"></script>', render_origin: 'server' }],
    pages: 5, totalPages: 50, siteTech: ['WordPress'], domain: 'example.gov',
  });
  assert.equal(a.layer, 'platform');
  assert.notEqual(a.confidence, 'low');
  assert.ok(a.evidence.some((e) => e.signal === 'asset-path' && e.supports === 'platform'));
});
