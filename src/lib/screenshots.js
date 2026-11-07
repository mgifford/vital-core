import fs from 'node:fs';
import path from 'node:path';

/**
 * Bounded historical screenshots.
 *
 * One screenshot per page (never per violation), captured while the page is
 * already open for auditing, and only when the target opts in. Findings on the
 * same page share the file; element rectangles are stored in page coordinates
 * so annotations do not depend on the scroll position at capture time.
 *
 * Privacy is opt-in and masking-first: screenshots are off by default, and a
 * target can list selectors to mask (forms, account widgets) before capture.
 */

export const DEFAULT_SCREENSHOT_CONFIG = Object.freeze({
  enabled: false,
  max_per_run: 25,
  max_height: 6000,
  max_bytes: 500000,
  quality: 70,
  mask_selectors: [],
});

export const MAX_SCREENSHOT_WIDTH = 20000;

/** Validate and merge a target's screenshot settings. */
export function resolveScreenshotConfig(raw, where = 'config') {
  if (raw == null) return { ...DEFAULT_SCREENSHOT_CONFIG };
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${where}: screenshots must be a mapping.`);
  const config = { ...DEFAULT_SCREENSHOT_CONFIG, ...raw };
  if (typeof config.enabled !== 'boolean') throw new Error(`${where}: screenshots.enabled must be true or false.`);
  for (const key of ['max_per_run', 'max_height', 'max_bytes']) {
    if (!Number.isInteger(config[key]) || config[key] < 1) throw new Error(`${where}: screenshots.${key} must be a positive integer.`);
  }
  if (config.max_per_run > 500) throw new Error(`${where}: screenshots.max_per_run must be 500 or less.`);
  if (config.max_height < 200 || config.max_height > 30000) throw new Error(`${where}: screenshots.max_height must be between 200 and 30000.`);
  if (config.max_bytes < 50000 || config.max_bytes > 5000000) throw new Error(`${where}: screenshots.max_bytes must be between 50000 and 5000000.`);
  if (!Number.isInteger(config.quality) || config.quality < 20 || config.quality > 100) {
    throw new Error(`${where}: screenshots.quality must be an integer from 20 to 100.`);
  }
  if (!Array.isArray(config.mask_selectors) || config.mask_selectors.some((s) => typeof s !== 'string' || !s.trim())) {
    throw new Error(`${where}: screenshots.mask_selectors must be a list of non-empty CSS selectors.`);
  }
  if (config.mask_selectors.length > 20) throw new Error(`${where}: screenshots.mask_selectors is limited to 20 selectors.`);
  config.mask_selectors = config.mask_selectors.map((s) => s.trim());
  return config;
}

/**
 * Capture one page screenshot into `dir`. Returns metadata only; the caller
 * stores the file name on the page record and aggregate copies it for reports.
 * Never throws for a capture failure — it records why instead.
 */
export async function capturePageScreenshot(page, { dir, fileBase, config }) {
  const settings = config ?? DEFAULT_SCREENSHOT_CONFIG;
  try {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
    const metrics = await page.evaluate(() => ({
      width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
      height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      dpr: window.devicePixelRatio || 1,
    }));
    const fullPage = metrics.height <= settings.max_height && metrics.width <= MAX_SCREENSHOT_WIDTH;
    let width = fullPage ? metrics.width : metrics.viewport.width;
    let height = fullPage ? metrics.height : metrics.viewport.height;
    const masks = settings.mask_selectors.map((selector) => page.locator(selector));
    let buffer;
    let capturedFullPage = fullPage;
    let note = null;
    try {
      buffer = await page.screenshot({
        fullPage,
        type: 'jpeg',
        quality: settings.quality,
        ...(masks.length ? { mask: masks } : {}),
      });
      // A full-page JPEG can be several MB on a long, text-heavy page. If it
      // exceeds the byte budget, fall back to the top viewport rather than
      // storing it (annotations outside it are reported as unavailable).
      if (fullPage && buffer.length > settings.max_bytes) {
        buffer = await page.screenshot({
          fullPage: false,
          type: 'jpeg',
          quality: settings.quality,
          ...(masks.length ? { mask: masks } : {}),
        });
        capturedFullPage = false;
        width = metrics.viewport.width;
        height = metrics.viewport.height;
        note = 'full-page image exceeded max_bytes; top viewport captured';
      }
    } catch (error) {
      return { available: false, reason: 'capture-failed', detail: String(error?.message ?? error).slice(0, 160) };
    }
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${fileBase}.jpg`;
    fs.writeFileSync(path.join(dir, fileName), buffer);
    return {
      available: true,
      file: `screenshots/${fileName}`,
      file_name: fileName,
      width,
      height,
      viewport: metrics.viewport,
      device_scale_factor: metrics.dpr,
      full_page: capturedFullPage,
      ...(note ? { note } : {}),
      scroll: { x: 0, y: 0 },
      captured_at: new Date().toISOString(),
      format: 'jpeg',
      bytes: buffer.length,
    };
  } catch (error) {
    return { available: false, reason: 'capture-failed', detail: String(error?.message ?? error).slice(0, 160) };
  }
}

/**
 * Position an element rectangle over a screenshot, as percentages. Pure and
 * self-contained so the Explorer can stringify it. Returns null when there is
 * no usable geometry, and `visible: false` when the element is outside the
 * captured area (for example a viewport screenshot when the element is below
 * the fold) — the UI then says so rather than drawing a wrong marker.
 */
export function markerGeometry(rect, screenshot) {
  if (!rect || !screenshot || !screenshot.width || !screenshot.height) return null;
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return null;
  const intersects = x + width > 0 && y + height > 0 && x < screenshot.width && y < screenshot.height;
  const clamp = (value) => Math.max(0, Math.min(100, value));
  return {
    visible: intersects,
    left: clamp((x / screenshot.width) * 100),
    top: clamp((y / screenshot.height) * 100),
    width: clamp((width / screenshot.width) * 100),
    height: clamp((height / screenshot.height) * 100),
  };
}
