import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  DEFAULT_SCREENSHOT_CONFIG,
  resolveScreenshotConfig,
  capturePageScreenshot,
  markerGeometry,
} from '../../src/lib/screenshots.js';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const FIXTURE = pathToFileURL(path.join(ROOT, 'tests', 'fixtures', 'evidence-deep.html')).href;

test('screenshot config is opt-in and validated', () => {
  assert.equal(DEFAULT_SCREENSHOT_CONFIG.enabled, false);
  assert.equal(resolveScreenshotConfig(null).enabled, false);
  const merged = resolveScreenshotConfig({ enabled: true, max_per_run: 5, mask_selectors: [' form ', '#account'] });
  assert.equal(merged.enabled, true);
  assert.equal(merged.max_per_run, 5);
  assert.deepEqual(merged.mask_selectors, ['form', '#account']);
  assert.throws(() => resolveScreenshotConfig({ enabled: 'yes' }), /enabled/);
  assert.throws(() => resolveScreenshotConfig({ max_per_run: 0 }), /max_per_run/);
  assert.throws(() => resolveScreenshotConfig({ max_per_run: 501 }), /max_per_run/);
  assert.throws(() => resolveScreenshotConfig({ max_height: 100 }), /max_height/);
  assert.throws(() => resolveScreenshotConfig({ quality: 5 }), /quality/);
  assert.throws(() => resolveScreenshotConfig({ max_bytes: 1000 }), /max_bytes/);
  assert.throws(() => resolveScreenshotConfig({ mask_selectors: [''] }), /mask_selectors/);
});

test('marker geometry maps page coordinates to image percentages and flags off-image elements', () => {
  const inside = markerGeometry({ x: 100, y: 200, width: 50, height: 20 }, { width: 1000, height: 500 });
  assert.deepEqual(inside, { visible: true, left: 10, top: 40, width: 5, height: 4 });
  const outside = markerGeometry({ x: 1200, y: 10, width: 50, height: 20 }, { width: 1000, height: 500 });
  assert.equal(outside.visible, false);
  assert.equal(markerGeometry(null, { width: 1, height: 1 }), null);
  assert.equal(markerGeometry({ x: 0, y: 0, width: 1, height: 1 }, null), null);
});

test('capture writes a bounded JPEG and records its coordinate system', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-shots-'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(FIXTURE, { waitUntil: 'load' });
    const shot = await capturePageScreenshot(page, {
      dir,
      fileBase: 'page-one',
      config: { ...DEFAULT_SCREENSHOT_CONFIG, enabled: true, max_height: 12000 },
    });
    assert.equal(shot.available, true);
    assert.equal(shot.file, 'screenshots/page-one.jpg');
    assert.equal(shot.full_page, true);
    assert.ok(shot.width > 0 && shot.height >= 600, `captured page (${shot.width}x${shot.height})`);
    assert.ok(fs.existsSync(path.join(dir, 'page-one.jpg')));
    assert.ok(fs.statSync(path.join(dir, 'page-one.jpg')).size > 1000);
    assert.deepEqual(shot.scroll, { x: 0, y: 0 });
    assert.equal(shot.format, 'jpeg');

    const viewport = await capturePageScreenshot(page, {
      dir,
      fileBase: 'page-two',
      config: { ...DEFAULT_SCREENSHOT_CONFIG, enabled: true, max_height: 200 },
    });
    assert.equal(viewport.available, true);
    assert.equal(viewport.full_page, false, 'too-tall pages fall back to a viewport capture');
    assert.equal(viewport.height, 600);

    // Byte budget: a full-page capture above max_bytes falls back to the viewport.
    const blocks = Array.from({ length: 40 }, (_, i) => `<section style="padding:24px;background:hsl(${i * 17} 80% 50%)"><h2>Section ${i}</h2><p>${'Accessible government services text. '.repeat(20)}</p></section>`).join('');
    await page.setContent(`<main>${blocks}</main>`);
    const bounded = await capturePageScreenshot(page, {
      dir,
      fileBase: 'page-three',
      config: { ...DEFAULT_SCREENSHOT_CONFIG, enabled: true, max_height: 20000, max_bytes: 50000 },
    });
    assert.equal(bounded.available, true);
    assert.equal(bounded.full_page, false);
    assert.match(bounded.note, /max_bytes/);
    assert.equal(bounded.height, 600);
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
