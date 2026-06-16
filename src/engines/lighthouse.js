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
            agentic: score(cats['agentic-browsing']), // null if not run
          },
          metrics: {
            firstContentfulPaintMs: numeric(audits['first-contentful-paint']),
            largestContentfulPaintMs: numeric(audits['largest-contentful-paint']),
            speedIndexMs: numeric(audits['speed-index']),
            totalBlockingTimeMs: numeric(audits['total-blocking-time']),
            cumulativeLayoutShift: numericRaw(audits['cumulative-layout-shift']),
          },
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
