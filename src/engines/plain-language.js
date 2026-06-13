/**
 * Plain-language / readability engine. Runs in-page like axe and alfa,
 * extracting the main text content and computing readability metrics in
 * Node. Cheap (no extra browser), so it runs on every page.
 *
 * Metrics, all comparable week over week:
 *  - fleschReadingEase   (0-100; higher is easier)
 *  - fleschKincaidGrade  (US grade level; lower is easier)
 *  - avgSentenceLength   (words per sentence)
 *  - longSentences       (sentences over 20 words)
 *  - passiveVoiceRatio   (rough heuristic, 0-1)
 *  - wordCount
 *  - unexplainedAcronyms (acronyms used without an expansion on the page)
 *
 * The grade-level and passive-voice numbers are heuristics, useful for
 * trends and triage, not authoritative linguistics.
 */

const LONG_SENTENCE_WORDS = 20;
const ACRONYM_CAP = 25;

// "was written", "are being held", "has been reviewed", etc.
const PASSIVE = /\b(?:is|are|was|were|be|been|being|am)\b\s+(?:\w+ed|\w+en|done|made|sent|put|set|read|built|held|kept|told|shown|known|given|taken|seen|found)\b/i;

export async function runPlainLanguage(page) {
  // Extract main-content text in the browser. Prefer <main>/<article>;
  // strip script/style/nav/header/footer so chrome doesn't pollute prose.
  const text = await page.evaluate(() => {
    const root = document.querySelector('main, [role="main"], article') || document.body;
    if (!root) return '';
    const clone = root.cloneNode(true);
    clone.querySelectorAll('script, style, nav, header, footer, aside, noscript, [aria-hidden="true"]').forEach((n) => n.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  });

  // Acronyms: ALL-CAPS tokens 2-6 letters. An acronym counts as
  // "explained" if the page also defines it via <abbr title> or the
  // "Full Name (ACRONYM)" pattern.
  const explained = await page.evaluate(() => {
    const set = new Set();
    document.querySelectorAll('abbr[title]').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (/^[A-Z]{2,6}$/.test(t)) set.add(t);
    });
    const body = (document.body?.textContent || '');
    for (const m of body.matchAll(/\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,4}\s+\(([A-Z]{2,6})\)/g)) {
      set.add(m[1]);
    }
    return [...set];
  });

  const sentences = splitSentences(text);
  const words = splitWords(text);

  // Readability scores are only meaningful on actual prose. Card- and
  // link-heavy pages (common on government sites) have lots of words but
  // few real sentences, which yields nonsense grades. Require a minimum
  // of prose AND a plausible sentence structure before scoring.
  const hasProse = words.length >= 100 && sentences.length >= 3 && words.length / sentences.length <= 40;

  let fleschReadingEase = null;
  let fleschKincaidGrade = null;
  let avgSentenceLength = null;
  let longSentences = 0;
  let passiveVoiceRatio = null;

  if (hasProse) {
    const syllables = words.reduce((a, w) => a + estimateSyllables(w), 0);
    const asl = words.length / sentences.length; // avg sentence length
    const asw = syllables / words.length; // avg syllables per word

    fleschReadingEase = round(clamp(206.835 - 1.015 * asl - 84.6 * asw, 0, 100));
    fleschKincaidGrade = round(clamp(0.39 * asl + 11.8 * asw - 15.59, 0, 18));
    avgSentenceLength = round(asl);
    longSentences = sentences.filter((s) => splitWords(s).length > LONG_SENTENCE_WORDS).length;
    const passive = sentences.filter((s) => PASSIVE.test(s)).length;
    passiveVoiceRatio = round(passive / sentences.length, 3);
  }

  const explainedSet = new Set(explained);
  const unexplained = new Set();
  for (const w of words) {
    if (/^[A-Z]{2,6}$/.test(w) && !explainedSet.has(w)) unexplained.add(w);
    if (unexplained.size >= ACRONYM_CAP) break;
  }

  return {
    engine: 'plain-language',
    scored: hasProse, // false = too little prose to score readability meaningfully
    wordCount: words.length,
    sentenceCount: sentences.length,
    fleschReadingEase,
    fleschKincaidGrade,
    avgSentenceLength,
    longSentences,
    passiveVoiceRatio,
    unexplainedAcronyms: [...unexplained],
    unexplainedAcronymCount: unexplained.size,
  };
}

export function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function splitWords(text) {
  return text.match(/[A-Za-z]+(?:'[A-Za-z]+)?|[A-Z]{2,6}|\d+/g) ?? [];
}

/**
 * Estimate syllables in an English word. A vowel-group heuristic — not
 * perfect, but stable and good enough for trend-level readability.
 */
export function estimateSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  let groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
function round(n, dp = 1) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
