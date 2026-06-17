/**
 * Alt-text quality classifier. Automated accessibility engines flag *missing*
 * alt text well, but a lot of harmful alt text is technically present yet
 * useless — a filename, "image of …", a single stray character, or a caption
 * so long it should have been a description. This module classifies each
 * image's alt text into one actionable verdict so reports can surface the
 * cases a human should rewrite, not just the empty ones.
 *
 * Pure and dependency-free: assessAltText(img) takes the per-image record the
 * images engine already produces and returns { verdict, reason }. It makes no
 * network calls and does not look at the image pixels — it judges the text.
 *
 * Verdicts (see ALT_VERDICTS): MISSING, DECORATIVE, FILENAME, SUSPICIOUS,
 * TOO_SHORT, TOO_LONG, GOOD. DECORATIVE (alt="" or aria-hidden) is a valid,
 * intentional state, not a problem; the others below GOOD warrant review.
 */

export const ALT_VERDICTS = {
  MISSING: 'MISSING',         // no alt attribute at all
  DECORATIVE: 'DECORATIVE',   // alt="" or aria-hidden/role=presentation — intentional, OK
  FILENAME: 'FILENAME',       // alt looks like a filename (logo_1234.png)
  SUSPICIOUS: 'SUSPICIOUS',   // redundant/meaningless phrasing ("image of", "graphic")
  TOO_SHORT: 'TOO_SHORT',     // a single char/word unlikely to convey meaning
  TOO_LONG: 'TOO_LONG',       // so long it likely needs a longdesc/figure pattern
  GOOD: 'GOOD',               // present, plausible, no red flags
};

// Phrases that add nothing — the surrounding context already says it's an image.
const REDUNDANT_PHRASES = [
  'image of', 'picture of', 'photo of', 'photograph of', 'graphic of',
  'image:', 'photo:', 'picture:', 'icon of', 'logo of', 'screenshot of',
  'an image', 'a picture', 'a photo', 'spacer', 'placeholder',
];
// Bare meaningless values sometimes dropped into alt to silence a linter.
const MEANINGLESS_EXACT = new Set([
  'image', 'images', 'picture', 'photo', 'photograph', 'graphic', 'icon',
  'logo', 'img', 'alt', 'untitled', 'unnamed', 'thumbnail', 'banner',
  'spacer', 'blank', 'null', 'none', 'n/a', 'na', 'tbd', '.', '-', '*',
]);
// File extensions that, when present in a short alt, strongly imply the
// developer pasted the filename into the alt attribute.
const FILENAME_EXT = /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?|ico)$/i;
const FILENAME_LIKE = /^[\w-]+\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?|ico)$/i;

const TOO_LONG_CHARS = 250; // beyond this, alt text usually wants a different pattern

/**
 * Classify one image's alt text. `img` is the images-engine record:
 *   { hasAlt, alt, isDecorative, isMissingAlt, ariaHidden?, rolePresentation? }
 * Returns { verdict, reason } where reason is a short human explanation.
 */
export function assessAltText(img) {
  const ariaHidden = img.ariaHidden === true;
  const rolePresentation = img.rolePresentation === true;

  // Explicitly hidden from the accessibility tree — intentionally not announced.
  if (ariaHidden || rolePresentation) {
    return { verdict: ALT_VERDICTS.DECORATIVE, reason: ariaHidden ? 'aria-hidden="true"' : 'role="presentation"' };
  }
  // No alt attribute at all — the screen reader may read the filename instead.
  if (img.isMissingAlt || img.hasAlt === false) {
    return { verdict: ALT_VERDICTS.MISSING, reason: 'no alt attribute' };
  }

  const raw = img.alt ?? '';
  const alt = raw.trim();

  // Empty alt is the correct way to mark a decorative image.
  if (alt === '') {
    return { verdict: ALT_VERDICTS.DECORATIVE, reason: 'alt="" (decorative)' };
  }

  const lower = alt.toLowerCase();

  // A bare meaningless token.
  if (MEANINGLESS_EXACT.has(lower)) {
    return { verdict: ALT_VERDICTS.SUSPICIOUS, reason: `meaningless alt text: "${alt}"` };
  }
  // Filename pasted as alt (whole value is a filename, or contains an image ext
  // with no spaces — e.g. "hero_banner_2024.jpg").
  if (FILENAME_LIKE.test(alt) || (FILENAME_EXT.test(alt) && !/\s/.test(alt))) {
    return { verdict: ALT_VERDICTS.FILENAME, reason: 'alt text looks like a filename' };
  }
  // Redundant lead-in phrasing.
  for (const phrase of REDUNDANT_PHRASES) {
    if (lower.startsWith(phrase) || lower === phrase.replace(/[: ]+$/, '')) {
      return { verdict: ALT_VERDICTS.SUSPICIOUS, reason: `redundant phrasing: "${phrase.trim()}…"` };
    }
  }
  // Too short to be useful: a single character, or one very short word.
  const words = alt.split(/\s+/).filter(Boolean);
  if (alt.length <= 2 || (words.length === 1 && alt.length <= 3)) {
    return { verdict: ALT_VERDICTS.TOO_SHORT, reason: `very short alt text: "${alt}"` };
  }
  // So long it probably belongs in a caption/longdesc/figure.
  if (alt.length > TOO_LONG_CHARS) {
    return { verdict: ALT_VERDICTS.TOO_LONG, reason: `alt text is ${alt.length} characters — consider a caption or description` };
  }

  return { verdict: ALT_VERDICTS.GOOD, reason: 'present, no red flags' };
}

/** True when the verdict denotes a problem a human should review (not GOOD/DECORATIVE). */
export function isAltProblem(verdict) {
  return verdict !== ALT_VERDICTS.GOOD && verdict !== ALT_VERDICTS.DECORATIVE;
}
