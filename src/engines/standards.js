/**
 * Web-standards / metadata / discoverability checks, in the spirit of
 * ScanGov's Botability and Usability-metadata topics
 * (https://standards.scangov.org/). All checkable from a single page's
 * HTML, so this runs in-page like axe. ScanGov scores the homepage; we
 * run the same checks across the site and track them week over week.
 * Methodology credit: ScanGov (CC0).
 *
 * Includes social-presence detection (Mastodon / Bluesky) — open social
 * platforms governments increasingly use — via rel="me" links and known
 * hosts. Returns { checks: [{id,label,pass,detail}], social: [...] }.
 *
 * PWA / offline-readiness signals are detected here via Playwright because
 * Lighthouse 12+ removed the PWA category score. Service-worker detection
 * uses navigator.serviceWorker.getRegistration() inside page.evaluate.
 */

export async function runStandards(page) {
  const pageUrl = page.url();
  const isHttps = pageUrl.startsWith('https://');

  const data = await page.evaluate(async () => {
    const head = document.head;
    const meta = (sel) => head?.querySelector(sel)?.getAttribute('content') || null;
    const has = (sel) => !!document.querySelector(sel);

    // schema.org GovernmentOrganization in any JSON-LD block.
    let govSchema = false;
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      if (/GovernmentOrganization/i.test(s.textContent || '')) { govSchema = true; break; }
    }

    // Social links: rel="me" anchors plus known Mastodon/Bluesky hosts.
    const social = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      const rel = (a.getAttribute('rel') || '').toLowerCase();
      if (/(^|\/\/)([^/]*\.)?(mastodon|mstdn|social)\b/i.test(href) || (rel.includes('me') && /mastodon|@/.test(href))) {
        social.push({ platform: 'mastodon', href });
      }
      if (/bsky\.app|\.bsky\.social/i.test(href)) social.push({ platform: 'bluesky', href });
    }

    // PWA / offline-readiness signals.
    const manifestHref = head?.querySelector('link[rel="manifest"]')?.getAttribute('href') || null;
    const themeColor = meta('meta[name="theme-color"]');
    const appleTouchIcon = has('link[rel="apple-touch-icon"]');

    // Best-effort: check if a service worker is registered for this scope.
    // getRegistration() resolves even if the SW hasn't activated yet.
    let hasServiceWorker = false;
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        hasServiceWorker = !!reg;
      } catch { /* permission error or not supported */ }
    }

    return {
      title: (document.title || '').trim(),
      description: meta('meta[name="description"]'),
      viewport: meta('meta[name="viewport"]'),
      charset: !!head?.querySelector('meta[charset]'),
      canonical: has('link[rel="canonical"]'),
      hreflang: has('link[rel="alternate"][hreflang]'),
      lang: document.documentElement.getAttribute('lang'),
      govSchema,
      og: {
        title: meta('meta[property="og:title"]'),
        description: meta('meta[property="og:description"]'),
        url: meta('meta[property="og:url"]'),
        image: meta('meta[property="og:image"]'),
        siteName: meta('meta[property="og:site_name"]'),
        type: meta('meta[property="og:type"]'),
      },
      twitter: meta('meta[name="twitter:card"]'),
      social,
      manifestHref,
      themeColor,
      appleTouchIcon,
      hasServiceWorker,
    };
  });

  const checks = [];
  const add = (id, label, pass, detail = '') => checks.push({ id, label, pass, detail });

  // Botability / discoverability.
  add('schema-gov', 'schema.org GovernmentOrganization markup', data.govSchema);
  add('canonical', 'Canonical URL declared', data.canonical);
  add('hreflang', 'hreflang alternates declared', data.hreflang);

  // Usability metadata.
  add('title', 'Page has a <title>', !!data.title);
  add('description', 'Meta description present', !!data.description);
  add('charset', 'Character encoding declared', data.charset);
  add('lang', 'Document language (lang) set', !!data.lang, data.lang || '');
  // Viewport present and does NOT disable zoom.
  const vp = data.viewport || '';
  const zoomOk = !!vp && !/user-scalable\s*=\s*no/i.test(vp) && !/maximum-scale\s*=\s*1(\.0)?\b/i.test(vp);
  add('viewport', 'Responsive viewport (zoom not disabled)', zoomOk, vp);

  // Open Graph social-sharing tags (count present out of 6).
  const ogPresent = Object.values(data.og).filter(Boolean).length;
  add('open-graph', `Open Graph tags (${ogPresent}/6)`, ogPresent >= 4);
  add('twitter-card', 'Twitter card metadata', !!data.twitter);

  // Open social presence (Mastodon / Bluesky).
  const platforms = [...new Set(data.social.map((s) => s.platform))];
  add('open-social', 'Open social presence (Mastodon/Bluesky) linked', platforms.length > 0, platforms.join(', '));

  // PWA / offline-readiness (Lighthouse 12+ removed the PWA score; we detect here instead).
  add('pwa-https',             'HTTPS (required for service workers)',      isHttps);
  add('pwa-manifest',          'Web app manifest declared',                 !!data.manifestHref);
  add('pwa-service-worker',    'Service worker registered',                 data.hasServiceWorker);
  add('pwa-theme-color',       'Theme color declared',                      !!data.themeColor, data.themeColor || '');
  add('pwa-apple-touch-icon',  'Apple touch icon (iOS/bookmark icon)',      data.appleTouchIcon);

  const passed = checks.filter((c) => c.pass).length;
  return {
    engine: 'standards',
    checks,
    passed,
    total: checks.length,
    social: data.social.slice(0, 10),
    og: data.og,
  };
}
