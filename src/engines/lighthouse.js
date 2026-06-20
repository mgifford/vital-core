/**
 * Google Lighthouse engine. Unlike axe/alfa/plain-language, Lighthouse
 * drives its own Chrome (it cannot reuse the Playwright page), so it is
 * slow (~10-20s/page). It is therefore SAMPLED: the scan audits only a
 * capped subset of pages per run (homepage first, then a few more),
 * while the other engines run on every page.
 *
 * Categories: performance, accessibility, best-practices, SEO, and
 * agentic-browsing. The agentic-browsing category shipped in the default
 * Lighthouse config (lighthouse@13.4.0+) and is included in every audit.
 * It scores how well the page works for AI agents: llms.txt, structured
 * data, WebMCP, etc.
 *
 * lighthouse and chrome-launcher are imported dynamically so the engine
 * only loads (and only requires Chrome) when actually enabled.
 */

// PWA category was removed in Lighthouse 12; it is no longer in CATEGORIES.
// PWA / offline signals are now detected via Playwright in standards.js instead.
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo', 'agentic-browsing'];

/**
 * Create a runner that owns one shared Chrome for a batch of audits.
 * Call .audit(url) per sampled page and .close() when done. If Chrome
 * can't launch (e.g. not installed), the runner degrades to no-ops that
 * return null, so a scan never crashes because Lighthouse is unavailable.
 */
export async function createLighthouseRunner({ timeoutMs = 60000, log = () => {} } = {}) {
  let chrome = null;
  let lighthouse = null;

  try {
    const [{ launch }, lhModule] = await Promise.all([
      import('chrome-launcher'),
      import('lighthouse'),
    ]);
    lighthouse = lhModule.default;
    chrome = await launch({ chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'] });
    log(`lighthouse: Chrome on port ${chrome.port}`);
  } catch (err) {
    log(`lighthouse: unavailable (${String(err?.message || err).slice(0, 100)}); skipping`);
    return { available: false, async audit() { return null; }, async close() {} };
  }

  return {
    available: true,
    async audit(url) {
      try {
        const result = await lighthouse(url, {
          port: chrome.port,
          output: 'json',
          logLevel: 'silent',
          onlyCategories: CATEGORIES,
          maxWaitForLoad: Math.max(5000, Math.min(timeoutMs, 60000)),
        });
        const cats = result?.lhr?.categories ?? {};
        const audits = result?.lhr?.audits ?? {};
        return {
          engine: 'lighthouse',
          version: result?.lhr?.lighthouseVersion ?? null,
          scores: {
            performance: score(cats.performance),
            accessibility: score(cats.accessibility),
            bestPractices: score(cats['best-practices']),
            seo: score(cats.seo),
            pwa: null,
            agentic: score(cats['agentic-browsing']),
          },
          metrics: {
            firstContentfulPaintMs: numeric(audits['first-contentful-paint']),
            largestContentfulPaintMs: numeric(audits['largest-contentful-paint']),
            speedIndexMs: numeric(audits['speed-index']),
            totalBlockingTimeMs: numeric(audits['total-blocking-time']),
            cumulativeLayoutShift: numericRaw(audits['cumulative-layout-shift']),
          },
          // Failing/actionable audits across the non-accessibility categories.
          // Accessibility audits are excluded — they mostly duplicate axe.
          audits: extractAudits(cats, audits),
        };
      } catch (err) {
        log(`lighthouse: audit failed for ${url}: ${String(err?.message || err).slice(0, 100)}`);
        return null;
      }
    },
    async close() {
      try {
        await chrome.kill();
      } catch {
        /* best effort */
      }
    },
  };
}

// Categories we surface recommendations for. Accessibility is excluded — its
// audits largely duplicate axe-core, which we report in full elsewhere.
const RECO_CATEGORIES = {
  performance: 'Performance',
  seo: 'SEO',
  'best-practices': 'Best Practices',
  'agentic-browsing': 'Agentic',
};

/**
 * Pull the failing/actionable audits out of a Lighthouse result, tagged with
 * their category. An audit is a recommendation when it has a real score below
 * Lighthouse's "good" threshold (0.9) in a pass/fail mode (numeric/binary).
 * For the Agentic category we also keep `notApplicable` audits, because
 * "no llms.txt / no WebMCP" is itself the finding worth surfacing.
 *
 * Savings (where Lighthouse provides them) are captured so aggregate can rank
 * by impact: overallSavingsBytes (real transfer bytes) and the largest
 * per-metric millisecond saving from metricSavings.
 */
export function extractAudits(categories, audits) {
  // Map audit id -> category id via each category's auditRefs.
  const auditCat = {};
  for (const [catId, cat] of Object.entries(categories)) {
    if (!RECO_CATEGORIES[catId]) continue;
    for (const ref of cat.auditRefs ?? []) auditCat[ref.id] = catId;
  }
  const out = [];
  for (const [id, a] of Object.entries(audits)) {
    const catId = auditCat[id];
    if (!catId) continue;
    const mode = a.scoreDisplayMode;
    const isAgentic = catId === 'agentic-browsing';
    const savingsBytes = typeof a.details?.overallSavingsBytes === 'number' ? a.details.overallSavingsBytes : 0;
    const savingsMs = a.metricSavings
      ? Math.max(0, ...Object.values(a.metricSavings).filter((v) => typeof v === 'number'))
      : 0;
    // A recommendation is:
    //  - a failing pass/fail audit (numeric/binary score below LH's 0.9 "good"
    //    threshold), OR
    //  - a "metricSavings" opportunity with a real estimated saving (the perf
    //    opportunities — unused CSS/JS, render-blocking — use this mode), OR
    //  - an Agentic feature-absent gap (notApplicable, e.g. no llms.txt).
    const failingScore = typeof a.score === 'number' && a.score < 0.9 && (mode === 'numeric' || mode === 'binary');
    const savingsOpportunity = mode === 'metricSavings' && (savingsBytes > 1024 || savingsMs >= 50);
    const agenticGap = isAgentic && mode === 'notApplicable';
    if (!failingScore && !savingsOpportunity && !agenticGap) continue;
    out.push({
      id,
      category: catId,
      title: a.title ?? id,
      score: typeof a.score === 'number' ? a.score : null,
      savingsBytes,
      savingsMs: Math.round(savingsMs),
      // How many elements/resources triggered it on this page (context).
      items: Array.isArray(a.details?.items) ? a.details.items.length : 0,
    });
  }
  return out;
}

/** Lighthouse category score is 0-1; surface as 0-100 integer, or null. */
function score(cat) {
  if (!cat || typeof cat.score !== 'number') return null;
  return Math.round(cat.score * 100);
}
function numeric(audit) {
  const v = audit?.numericValue;
  return typeof v === 'number' ? Math.round(v) : null;
}
function numericRaw(audit) {
  const v = audit?.numericValue;
  return typeof v === 'number' ? Math.round(v * 1000) / 1000 : null;
}
