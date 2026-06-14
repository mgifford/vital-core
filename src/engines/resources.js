/**
 * Embedded / linked resource catalog. The other engines only see HTML,
 * but sites also serve PDFs, Office documents, embedded videos, iframes,
 * and other non-HTML resources whose accessibility the site owner still
 * owns. This engine records what each page links to or embeds, so the
 * report can answer "what PDFs does this site have?" and "what was added
 * this week?" (the latter via the resource ledger in aggregate).
 *
 * It does not fetch or audit the resources — it inventories their URLs
 * and types. Auditing a PDF's accessibility is a separate, heavier job.
 */

const MAX_RESOURCES = 500; // per page cap, to bound record size

// Map a URL's file extension to a resource type. Extensions are the
// reliable signal for linked documents/media.
const EXT_TYPE = [
  [/\.pdf$/i, 'pdf'],
  [/\.(docx?|rtf|odt)$/i, 'document'],
  [/\.(pptx?|odp)$/i, 'presentation'],
  [/\.(xlsx?|csv|ods)$/i, 'spreadsheet'],
  [/\.(zip|tar|gz|7z|rar)$/i, 'archive'],
  [/\.(mp4|webm|mov|avi|m4v|mpg|mpeg)$/i, 'video'],
  [/\.(mp3|wav|ogg|m4a|aac|flac)$/i, 'audio'],
  [/\.(jpe?g|png|gif|webp|avif|bmp|tiff?)$/i, 'image'],
  [/\.svg$/i, 'svg'],
];

// Hosts whose iframes are embedded media players.
const MEDIA_EMBED = /(?:youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|dailymotion\.com|brightcove|wistia|soundcloud\.com|spotify\.com)/i;

export async function runResources(page, pageUrl) {
  // Gather candidate (url, source) pairs in the browser. `source` is the
  // element kind so we can classify embeds the extension can't.
  const raw = await page.evaluate(() => {
    const out = [];
    const push = (url, source) => url && out.push({ url, source });
    for (const a of document.querySelectorAll('a[href]')) push(a.getAttribute('href'), 'link');
    for (const f of document.querySelectorAll('iframe[src]')) push(f.getAttribute('src'), 'iframe');
    for (const e of document.querySelectorAll('embed[src]')) push(e.getAttribute('src'), 'embed');
    for (const o of document.querySelectorAll('object[data]')) push(o.getAttribute('data'), 'object');
    for (const v of document.querySelectorAll('video[src], video source[src]')) push(v.getAttribute('src'), 'video');
    for (const au of document.querySelectorAll('audio[src], audio source[src]')) push(au.getAttribute('src'), 'audio');
    return out;
  });

  const byUrl = new Map(); // normalized url -> type (dedupe within a page)
  for (const { url, source } of raw) {
    let abs;
    try {
      abs = new URL(url, pageUrl);
    } catch {
      continue;
    }
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
    abs.hash = '';
    const u = abs.toString();
    const type = classify(u, source);
    if (!type) continue; // ordinary HTML link, not a tracked resource
    if (!byUrl.has(u)) byUrl.set(u, type);
    if (byUrl.size >= MAX_RESOURCES) break;
  }

  const resources = [...byUrl].map(([url, type]) => ({ url, type }));
  const byType = {};
  for (const r of resources) byType[r.type] = (byType[r.type] ?? 0) + 1;

  return { engine: 'resources', count: resources.length, byType, resources };
}

/**
 * Classify a resource URL + source element into a type, or null if it's
 * just an ordinary HTML link we don't track.
 */
function classify(url, source) {
  let pathname = '';
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  // Extension wins when present (covers links and direct media/embeds).
  for (const [re, type] of EXT_TYPE) if (re.test(pathname)) return type;

  // Element-based classification for extension-less embeds.
  if (source === 'iframe') return MEDIA_EMBED.test(url) ? 'embedded-media' : 'iframe';
  if (source === 'embed' || source === 'object') return 'embed';
  if (source === 'video') return 'video';
  if (source === 'audio') return 'audio';

  // Plain links to HTML pages are not tracked here (discovery handles them).
  return null;
}
