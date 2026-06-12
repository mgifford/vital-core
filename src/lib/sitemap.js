import { normalizeUrl } from './urls.js';

/**
 * Seed URL discovery from sitemaps. Handles sitemap indexes one level
 * deep and caps total URLs so a 500k-URL sitemap cannot blow up state.
 * Parsing is a simple <loc> extraction: valid for the sitemap protocol
 * and avoids an XML dependency.
 */
export async function discoverFromSitemaps(origin, host, userAgent, cap = 20000) {
  const found = new Set();
  const queue = [new URL('/sitemap.xml', origin).toString()];
  const seenSitemaps = new Set();
  let indexDepth = 0;

  while (queue.length && found.size < cap && seenSitemaps.size < 50) {
    const smUrl = queue.shift();
    if (seenSitemaps.has(smUrl)) continue;
    seenSitemaps.add(smUrl);

    let text;
    try {
      const res = await fetch(smUrl, {
        headers: { 'user-agent': userAgent, accept: 'application/xml,text/xml' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) continue;
      text = await res.text();
    } catch {
      continue;
    }

    const isIndex = /<sitemapindex[\s>]/i.test(text);
    const locs = [...text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]));

    if (isIndex && indexDepth < 1) {
      indexDepth++;
      for (const loc of locs.slice(0, 25)) queue.push(loc);
    } else if (!isIndex) {
      for (const loc of locs) {
        const norm = normalizeUrl(loc, origin, host);
        if (norm) found.add(norm);
        if (found.size >= cap) break;
      }
    }
  }
  return [...found];
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
