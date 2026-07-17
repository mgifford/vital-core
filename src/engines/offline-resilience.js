/**
 * Offline and network resilience checks, in the spirit of security.js and
 * public-interest.js: per-origin, not per-page, computed once and reused
 * for the whole scan. Unlike those two, this needs a real browser (toggling
 * network conditions and observing what renders), so it takes the already-
 * launched `browser` and opens its own isolated context — never the shared
 * crawl context every page in the scan uses, since context.setOffline() is
 * context-level and would affect concurrent/future page loads if applied
 * to the shared one.
 *
 * Each check is { id, label, pass, detail }.
 */

export async function runOfflineResilience(browser, baseOrigin, userAgent, navTimeoutMs = 15000) {
  const checks = [];
  const add = (id, label, pass, detail = '') => checks.push({ id, label, pass, detail });

  let context;
  try {
    context = await browser.newContext({ userAgent });
    context.setDefaultNavigationTimeout(navTimeoutMs);
    const page = await context.newPage();

    // Baseline: confirm the origin is reachable online first, so an
    // offline failure is attributable to offline handling, not to the
    // origin being unreachable in general.
    let onlineOk = false;
    try {
      const res = await page.goto(baseOrigin, { waitUntil: 'load' });
      onlineOk = !!res && res.status() < 400;
    } catch { /* origin unreachable even online; leave onlineOk false */ }

    if (!onlineOk) {
      add('offline-fallback', 'Offline fallback / cached navigation', false,
        'Origin unreachable even with network online; cannot evaluate offline behavior');
      add('cache-storage-in-use', 'Cache Storage API in use (cache/versioning strategy)', false,
        'Origin unreachable even with network online; cannot inspect Cache Storage');
    } else {
      // Inspect Cache Storage while still on the real origin, before going
      // offline. A failed offline navigation lands the page on the
      // browser's own internal error page, where `caches` is unavailable —
      // checking here (not after the offline attempt) avoids that trap and
      // is also more correct: this asks "does the site have a cache
      // strategy," independent of whether the offline probe itself passes.
      try {
        const cacheNames = await page.evaluate(() => ('caches' in window ? caches.keys() : []));
        add('cache-storage-in-use', 'Cache Storage API in use (cache/versioning strategy)',
          cacheNames.length > 0,
          cacheNames.length ? `Cache(s) found: ${cacheNames.slice(0, 5).join(', ')}` : 'No caches found via Cache Storage API');
      } catch (err) {
        add('cache-storage-in-use', 'Cache Storage API in use (cache/versioning strategy)', false,
          `Could not inspect Cache Storage: ${String(err?.message || err).slice(0, 200)}`);
      }

      await context.setOffline(true);
      let offlineOk = false;
      let detail;
      try {
        const res = await page.goto(baseOrigin, { waitUntil: 'load', timeout: navTimeoutMs });
        offlineOk = !!res && res.status() < 400;
        detail = offlineOk
          ? 'Page loaded successfully while offline (cached navigation or offline-fallback page served)'
          : `Navigation returned while offline but status ${res?.status()}`;
      } catch (err) {
        detail = `Navigation failed while offline: ${String(err?.message || err).slice(0, 200)}`;
      }
      add('offline-fallback', 'Offline fallback / cached navigation', offlineOk, detail);
      await context.setOffline(false);
    }
  } finally {
    await context?.close();
  }

  const passed = checks.filter((c) => c.pass).length;
  return { engine: 'offline-resilience', checks, passed, total: checks.length };
}
