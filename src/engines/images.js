/**
 * Image inventory engine.
 *
 * For every <img> on the page, records:
 *   - src URL (absolute)
 *   - alt text (exactly as authored, including empty string)
 *   - rendered width/height (CSS layout dimensions)
 *   - natural width/height (intrinsic pixel dimensions from the decoded image)
 *   - loading attribute ("lazy", "eager", or absent)
 *   - decoding attribute ("async", "sync", "auto", or absent)
 *   - isDecorative: true when alt="" (empty string, not missing)
 *   - isMissingAlt: true when the alt attribute is absent entirely
 *
 * Byte sizes are captured from the network response interceptor that the
 * caller sets up via createImageCollector() — same approach as the
 * sustainability engine.  Call createImageCollector(page) *before*
 * navigation so responses are captured, then call collect(pageImages)
 * after runImages() returns.
 *
 * Sampling: image inventory is cheap (DOM eval only, no extra fetches).
 * The byte-size collector piggybacks on responses already in flight.
 */

import { assessAltText } from '../lib/alt-text.js';

const MAX_IMAGES = 500; // per page cap

export function createImageCollector(page) {
  const sizes = new Map(); // normalized image URL -> bytes

  const onResponse = async (response) => {
    const type = response.request().resourceType();
    if (type !== 'image') return;
    let bytes = 0;
    try {
      const lenHeader = response.headers()['content-length'];
      if (lenHeader) {
        bytes = parseInt(lenHeader, 10) || 0;
      } else {
        const body = await response.body().catch(() => null);
        bytes = body ? body.length : 0;
      }
    } catch {
      bytes = 0;
    }
    if (bytes > 0) {
      const url = normalizeUrl(response.url());
      if (url) sizes.set(url, bytes);
    }
  };

  page.on('response', onResponse);

  return {
    collect(images) {
      page.off('response', onResponse);
      // Attach the byte size we captured from the network to each image record.
      for (const img of images) {
        let size = sizes.get(img.src);
        if (size === undefined || size === null) {
          // Fallback 1: try matching without query variables
          const noQuerySrc = img.src.split('?')[0];
          size = sizes.get(noQuerySrc);
          if (size === undefined || size === null) {
            // Fallback 2: search inside sizes for any matching prefix/suffix
            for (const [sUrl, sBytes] of sizes.entries()) {
              if (sUrl.split('?')[0] === noQuerySrc) {
                size = sBytes;
                break;
              }
            }
          }
        }
        img.bytes = size ?? null;
      }
      return images;
    },
  };
}

export async function runImages(page, pageUrl) {
  const raw = await page.evaluate((maxImages) => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.slice(0, maxImages).map((el) => {
      const src = el.currentSrc || el.src || el.getAttribute('src') || '';
      const hasAlt = el.hasAttribute('alt');
      const alt = hasAlt ? el.getAttribute('alt') : null;
      return {
        src,
        alt,
        hasAlt,
        isDecorative: hasAlt && alt === '',
        isMissingAlt: !hasAlt,
        ariaHidden: el.getAttribute('aria-hidden') === 'true',
        rolePresentation: el.getAttribute('role') === 'presentation' || el.getAttribute('role') === 'none',
        renderedWidth:  el.width  || null,
        renderedHeight: el.height || null,
        naturalWidth:   el.naturalWidth  || null,
        naturalHeight:  el.naturalHeight || null,
        loading:   el.getAttribute('loading')  ?? null,
        decoding:  el.getAttribute('decoding') ?? null,
      };
    });
  }, MAX_IMAGES);

  // Resolve relative URLs and drop data: URIs (not useful to track).
  const images = [];
  for (const img of raw) {
    if (!img.src || img.src.startsWith('data:')) continue;
    let abs;
    try {
      abs = new URL(img.src, pageUrl).toString();
    } catch {
      continue;
    }
    // Strip hash; keep query string (some CDNs use it for transforms).
    abs = abs.replace(/#.*$/, '');
    // Alt-text quality verdict (MISSING/FILENAME/SUSPICIOUS/TOO_SHORT/…).
    const { verdict: altVerdict, reason: altReason } = assessAltText(img);
    images.push({ ...img, src: abs, altVerdict, altReason });
  }

  return { engine: 'images', count: images.length, images };
}

function normalizeUrl(url) {
  try {
    return new URL(url).toString().replace(/#.*$/, '');
  } catch {
    return null;
  }
}
