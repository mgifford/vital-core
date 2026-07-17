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
 * hosts. Returns { checks: [{id,label,pass,detail}], social: [...],
 * resilience: { checks: [{id,label,status,evidence,exampleUrl,why}],
 * manifest, serviceWorker } }.
 *
 * Progressive Web Resilience (manifest, service worker, installability) is
 * detected here via Playwright, in its own `resilience` section — distinct
 * from `checks` — because Lighthouse 12+ removed the PWA category score
 * (issue #145). Offline/network resilience (which needs a second,
 * origin-level navigation) lives in engines/offline-resilience.js instead.
 */

// Standard browser install criteria (Chrome/Edge "Add to Home Screen"),
// roughly: HTTPS, a valid manifest with a standalone-ish display mode and
// a >=192px icon, and a registered service worker. This is a heuristic
// derived signal, not a guarantee any specific browser will prompt
// install — reasons are returned so the report can show real evidence.
function evaluateInstallability(isHttps, manifest, serviceWorker) {
  const reasons = [];
  if (!isHttps) reasons.push('not served over HTTPS');
  if (!manifest || manifest.parseError) {
    reasons.push('no readable web app manifest');
  } else {
    if (!manifest.display || !['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display)) {
      reasons.push('manifest display mode is not standalone/fullscreen/minimal-ui');
    }
    const hasLargeIcon = (manifest.icons || []).some((i) => {
      const sizes = String(i.sizes || '');
      return sizes.includes('192x192') || sizes.includes('512x512') || sizes === 'any';
    });
    if (!hasLargeIcon) reasons.push('no 192x192 or larger icon declared');
  }
  if (!serviceWorker?.registered) reasons.push('no service worker registered');
  return { installable: reasons.length === 0, reasons };
}

// Short, specific explanation of why each Progressive Web Resilience check
// matters — shown alongside the evidence in the report (FR-006).
const RESILIENCE_WHY = {
  'pwa-https': 'HTTPS is required for service workers and most install prompts.',
  'pwa-manifest': 'A web app manifest is required for installability and controls how the app appears when launched.',
  'pwa-service-worker': 'A service worker is what makes offline access, caching, and background sync possible.',
  'pwa-theme-color': 'Theme color controls the browser chrome/status-bar color when the site is installed or bookmarked.',
  'pwa-apple-touch-icon': 'iOS uses this icon for home-screen bookmarks and "Add to Home Screen" — without it the icon falls back to a screenshot.',
  'manifest-parsed': 'A manifest that fails to parse cannot drive installability or launch behavior even if the link is present.',
  'manifest-maskable-icon': 'A maskable icon lets the OS safely crop/mask the app icon on different device shapes without clipping content.',
  'sw-active': 'An active service worker (not just registered) is what actually intercepts requests and serves cached content.',
  'sw-controlling': 'A controlling service worker means THIS page load is being served/intercepted, not just a future one.',
  installable: 'Determines whether the browser can realistically offer "Add to Home Screen" / install, based on manifest + service worker + HTTPS together.',
};

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

    // Fetch and parse the manifest JSON itself, not just detect the link.
    // null = no manifest declared; { parseError, ... } = declared but
    // unreadable (fetch failure, non-2xx, or invalid JSON) — cross-origin
    // manifests fail same-origin fetch() here, which is exactly that state.
    let manifest = null;
    if (manifestHref) {
      try {
        const manifestUrl = new URL(manifestHref, location.href).href;
        const res = await fetch(manifestUrl);
        if (!res.ok) {
          manifest = { parseError: `HTTP ${res.status}` };
        } else {
          const json = await res.json();
          const icons = Array.isArray(json.icons) ? json.icons : [];
          manifest = {
            startUrl: json.start_url ?? null,
            display: json.display ?? null,
            scope: json.scope ?? null,
            themeColor: json.theme_color ?? null,
            backgroundColor: json.background_color ?? null,
            icons,
            hasMaskableIcon: icons.some((i) => String(i.purpose || '').includes('maskable')),
            parseError: null,
          };
        }
      } catch (err) {
        manifest = { parseError: String(err?.message || err) };
      }
    }

    // Best-effort: check if a service worker is registered for this scope,
    // and how far its lifecycle has progressed. getRegistration() resolves
    // even if the SW hasn't activated yet.
    let hasServiceWorker = false;
    let serviceWorker = { registered: false, active: false, installing: false, waiting: false, controllingThisPage: false };
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        hasServiceWorker = !!reg;
        serviceWorker = {
          registered: !!reg,
          active: !!reg?.active,
          installing: !!reg?.installing,
          waiting: !!reg?.waiting,
          controllingThisPage: !!navigator.serviceWorker.controller,
        };
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
      manifest,
      themeColor,
      appleTouchIcon,
      hasServiceWorker,
      serviceWorker,
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

  // Progressive Web Resilience: manifest characteristics, service-worker
  // state, and installability — a distinct section (not mixed into
  // `checks` above), each entry carrying evidence + why it matters
  // (issue #145). The 5 pwa-* ids below existed as flat `checks` entries
  // before this WP; they keep their ids (external consumers may key on
  // them) but now live only here, never duplicated in `checks`.
  const resilienceChecks = [];
  const addResilience = (id, label, status, evidence = '') =>
    resilienceChecks.push({ id, label, status, evidence, exampleUrl: pageUrl, why: RESILIENCE_WHY[id] ?? '' });
  const tri = (pass) => (pass ? 'pass' : 'fail');

  addResilience('pwa-https', 'HTTPS (required for service workers)', tri(isHttps));
  addResilience('pwa-manifest', 'Web app manifest declared', tri(!!data.manifestHref));
  addResilience('pwa-service-worker', 'Service worker registered', tri(data.hasServiceWorker));
  addResilience('pwa-theme-color', 'Theme color declared', tri(!!data.themeColor), data.themeColor || '');
  addResilience('pwa-apple-touch-icon', 'Apple touch icon (iOS/bookmark icon)', tri(data.appleTouchIcon));

  if (data.manifestHref) {
    const manifestOk = !!data.manifest && !data.manifest.parseError;
    addResilience('manifest-parsed', 'Manifest fetched and parsed successfully', tri(manifestOk),
      manifestOk
        ? `display=${data.manifest.display ?? 'unset'}, start_url=${data.manifest.startUrl ?? 'unset'}`
        : (data.manifest?.parseError ?? 'unknown error'));
    addResilience('manifest-maskable-icon', 'Manifest declares a maskable icon', tri(!!data.manifest?.hasMaskableIcon),
      data.manifest?.hasMaskableIcon ? 'Maskable icon present' : 'No icon with purpose "maskable"');
  } else {
    addResilience('manifest-parsed', 'Manifest fetched and parsed successfully', 'n/a', 'No manifest declared');
    addResilience('manifest-maskable-icon', 'Manifest declares a maskable icon', 'n/a', 'No manifest declared');
  }

  addResilience('sw-active', 'Service worker is active (not just registered)', tri(data.serviceWorker.active));
  addResilience('sw-controlling', 'Service worker controls this page load', tri(data.serviceWorker.controllingThisPage));

  const { installable, reasons: installReasons } = evaluateInstallability(isHttps, data.manifest, data.serviceWorker);
  addResilience('installable', 'Meets basic installability criteria', tri(installable),
    installable ? 'All installability criteria met' : installReasons.join('; '));

  const passed = checks.filter((c) => c.pass).length;
  return {
    engine: 'standards',
    checks,
    passed,
    total: checks.length,
    social: data.social.slice(0, 10),
    og: data.og,
    resilience: {
      checks: resilienceChecks,
      manifest: data.manifest,
      serviceWorker: data.serviceWorker,
    },
  };
}
