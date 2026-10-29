/**
 * Pure helpers for scripts/probe-targets.js (the `diagnose` workflow):
 * which domains to probe, which response details to keep, what they say
 * about the site's protection, and how to summarise the result. No network
 * access here, so everything is unit-testable.
 */

import { domainKey } from './config.js';
import { registrableDomain } from './urls.js';

// The same shape scan.yml accepts for a dispatched domain.
const DOMAIN_RE = /^[a-z0-9][a-z0-9._-]*\.[a-z]{2,}$/;

const KEPT_HEADERS = [
  'server', 'via', 'location', 'content-type', 'retry-after', 'x-cache',
  'cf-ray', 'cf-mitigated', 'cf-cache-status',
  'x-amzn-waf-action', 'x-amz-cf-id', 'x-amz-cf-pop',
  'akamai-grn', 'x-iinfo', 'x-cdn', 'x-sucuri-id', 'x-azure-ref',
  'x-served-by', 'x-varnish', 'x-drupal-cache',
];

const bareHost = (host) => String(host).toLowerCase().replace(/^www\./, '');

/** Split a space- or comma-separated list; throws on anything not a domain. */
export function parseDomains(input) {
  const domains = String(input ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  const bad = domains.filter((d) => !DOMAIN_RE.test(d));
  if (bad.length) throw new Error(`Not a domain: ${bad.join(', ')}`);
  return [...new Set(domains)];
}

/**
 * The targets to probe: the given domains (configured or not), or every
 * configured target. hf_only targets must never run in GitHub Actions, so
 * they are refused, matched by key or by host with `www.` ignored.
 */
export function resolveProbeTargets(config, domains = []) {
  const hfOnly = config.targets.filter((t) => t.hf_only);
  const isHfOnly = (d) => hfOnly.some((t) => t.key === domainKey(d) || bareHost(t.domain) === bareHost(d));
  const wanted = domains.length ? domains : config.targets.filter((t) => !t.hf_only).map((t) => t.domain);
  const refused = wanted.filter(isHfOnly);
  const targets = wanted.filter((d) => !isHfOnly(d)).map((domain) => {
    const t = config.targets.find((x) => x.key === domainKey(domain));
    return {
      domain,
      configured: !!t,
      userAgent: t?.user_agent ?? config.defaults?.user_agent ?? 'vital-scans/0.1',
      navTimeoutMs: Math.max(t?.nav_timeout_ms ?? 0, 60000),
    };
  });
  return { targets, refused };
}

/**
 * The other host worth comparing: the apex for a www. host, the www. host
 * for an apex, and for any other subdomain (go.walsall.gov.uk) the site it
 * belongs to (walsall.gov.uk), which may redirect to it.
 */
export function twinHost(domain) {
  if (domain.startsWith('www.')) return domain.slice(4);
  const site = registrableDomain(domain);
  return site === domain ? `www.${domain}` : site;
}

export function pickHeaders(headers) {
  const get = (k) => (typeof headers?.get === 'function' ? headers.get(k) : headers?.[k]);
  const kept = {};
  for (const k of KEPT_HEADERS) {
    const v = get(k);
    if (v != null && v !== '') kept[k] = String(v).slice(0, 200);
  }
  return kept;
}

/** Cookie names from Set-Cookie values; the values are never kept. */
export function cookieNames(setCookies = []) {
  return [...new Set(setCookies.map((c) => String(c).split(';')[0].split('=')[0].trim()).filter(Boolean))];
}

/** What the headers and cookie names say is in front of the site. */
export function protectionHints({ headers = {}, cookies = [] } = {}) {
  const hints = [];
  const server = String(headers.server ?? '');
  const has = (re) => cookies.some((c) => re.test(c));
  if (headers['cf-mitigated']) hints.push(`Cloudflare ${headers['cf-mitigated']} (cf-mitigated)`);
  else if (headers['cf-ray'] || /cloudflare/i.test(server)) hints.push('Cloudflare');
  if (headers['x-amzn-waf-action']) hints.push(`AWS WAF ${headers['x-amzn-waf-action']} (x-amzn-waf-action)`);
  else if (has(/^aws-waf-token$/i)) hints.push('AWS WAF (aws-waf-token cookie)');
  if (headers['x-amz-cf-id'] || /cloudfront/i.test(String(headers.via ?? ''))) hints.push('Amazon CloudFront');
  if (headers['akamai-grn'] || /akamai/i.test(server)) hints.push('Akamai');
  if (headers['x-iinfo'] || /imperva|incapsula/i.test(String(headers['x-cdn'] ?? '')) || has(/^(incap_ses|visid_incap)/i)) hints.push('Imperva (Incapsula)');
  if (headers['x-sucuri-id']) hints.push('Sucuri');
  if (headers['x-azure-ref']) hints.push('Azure Front Door');
  if (has(/^(TS01|BIGipServer)/)) hints.push('F5 BIG-IP');
  if (headers['x-drupal-cache']) hints.push(`Drupal page cache: ${headers['x-drupal-cache']}`);
  return hints;
}

export function extractTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html ?? ''));
  if (!m) return null;
  const text = m[1]
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 120) : null;
}

/** A plain reading of a Node fetch error code. */
export function describeNetworkError(code) {
  const c = String(code ?? '');
  if (c === 'UND_ERR_CONNECT_TIMEOUT') return 'no connection within 10 s (often a firewall dropping traffic from this network)';
  if (c === 'ECONNREFUSED') return 'connection refused';
  if (c === 'ECONNRESET' || c === 'UND_ERR_SOCKET') return 'connection reset';
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return 'domain not found (DNS)';
  if (/CERT|SSL|TLS/i.test(c)) return `TLS certificate problem: ${c}`;
  return `network error: ${c}`;
}

/** The last hop of a fetch chain, and its final host. */
export function finalHop(chain) {
  const hop = chain?.hops?.[chain.hops.length - 1] ?? null;
  let host = null;
  try { host = hop ? new URL(hop.url).hostname : null; } catch { /* keep null */ }
  return { hop, host };
}

/** One line on what a single fetch chain got. */
export function describeOutcome(chain) {
  const { hop } = finalHop(chain);
  if (!hop) return 'no request made';
  if (hop.error) return hop.error;
  const s = hop.status;
  if (s === 202) return '202: accepted but not served (often a bot challenge)';
  if (s === 401 || s === 403) return `${s}: refused`;
  if (s === 404) return '404: not found';
  if (s === 429) return '429: rate limited';
  if (s === 503) return '503: unavailable (often a challenge or maintenance)';
  if (s >= 500) return `${s}: server error`;
  if (s >= 400) return `${s}: client error`;
  if (s >= 300) return `${s}: redirect without a usable location`;
  return `${s}: OK`;
}

/**
 * The domain's verdict: the homepage outcome for the scanner, plus the
 * findings that explain a failure (another subdomain, a different answer to
 * a browser, a browser load that doesn't finish).
 */
export function verdict({ domain, scanner, browser, page }) {
  const notes = [];
  const scan = finalHop(scanner);
  const ok = scan.hop && !scan.hop.error && scan.hop.status >= 200 && scan.hop.status < 300 && scan.hop.status !== 202;
  if (scan.host && bareHost(scan.host) !== bareHost(domain)) {
    notes.push(`redirects to another host (${scan.host}); the crawler only follows links on ${bareHost(domain)} and its www. form`);
  }
  const b = finalHop(browser).hop;
  if (b && scan.hop && (b.status ?? b.error) !== (scan.hop.status ?? scan.hop.error)) {
    notes.push(`answers a desktop browser differently (${describeOutcome(browser)})`);
  }
  if (page?.error) notes.push(`browser load failed: ${page.error}`);
  else if (page && page.loadMs == null) notes.push(`the load event didn't fire within ${Math.round(page.timeoutMs / 1000)} s`);
  return { ok: ok && notes.length === 0, text: [describeOutcome(scanner), ...notes].join('; ') };
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const secs = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);

function chainCell(chain) {
  if (!chain?.hops?.length) return '—';
  const parts = chain.hops.map((h) => (h.error ? h.error : `${h.status}`));
  const last = chain.hops[chain.hops.length - 1];
  const extra = [];
  if (last.title) extra.push(`“${last.title}”`);
  if (last.bytes != null) extra.push(last.bytes < 1024 ? `${last.bytes} B` : `${Math.round(last.bytes / 1024)} KB`);
  extra.push(secs(chain.totalMs));
  const hosts = [...new Set(chain.hops.map((h) => { try { return new URL(h.url).host; } catch { return h.url; } }))];
  return `${parts.join(' → ')} (${extra.join(', ')})${hosts.length > 1 ? ` via ${hosts.join(' → ')}` : ''}`;
}

/** Markdown for the job summary. */
export function renderMarkdown(results, { refused = [] } = {}) {
  const out = ['# Target diagnostics', ''];
  if (refused.length) out.push(`Refused (hf_only, never probed from GitHub Actions): ${refused.join(', ')}`, '');
  for (const r of results) {
    out.push(`## ${r.domain}${r.configured ? '' : ' (not in config/targets.yml)'}`, '');
    out.push(`**Verdict:** ${r.verdict.ok ? 'OK' : 'needs attention'}: ${cell(r.verdict.text)}`, '');
    out.push('| URL | Scanner user agent | Desktop browser user agent |', '|---|---|---|');
    for (const row of r.fetches) out.push(`| ${cell(row.url)} | ${cell(chainCell(row.scanner))} | ${cell(chainCell(row.browser))} |`);
    out.push('');
    out.push(`**Protection hints:** ${r.hints.length ? r.hints.map(cell).join('; ') : 'none identified'}`, '');
    if (r.robots) {
      const rb = r.robots;
      const unread = rb.error || rb.status < 200 || rb.status >= 300;
      out.push(`**robots.txt:** ${rb.status ?? rb.error}; \`/\` ${rb.rootAllowed === false ? '**disallowed**' : 'allowed'} for the scanner${unread ? ' (the scan treats an unreadable robots.txt as allowing everything)' : ''}; sitemaps: ${rb.sitemaps.length ? rb.sitemaps.map(cell).join(', ') : 'none listed'}`, '');
    }
    if (r.sitemap) {
      const sm = r.sitemap;
      const count = `${sm.locs}${sm.truncated ? '+' : ''} ${sm.isIndex ? 'child sitemaps' : 'URLs'}${sm.truncated ? ' (counted in the first 256 KB)' : ''}`;
      out.push(`**Sitemap** (${cell(sm.url)}): ${sm.error ?? `${sm.status}, ${count}`}`, '');
    }
    if (r.page) {
      const p = r.page;
      out.push(p.error
        ? `**Browser load:** ${cell(p.error)}`
        : `**Browser load** (Chromium, scanner user agent): ${p.status ?? '—'}, DOMContentLoaded ${secs(p.domContentLoadedMs)}, load ${p.loadMs == null ? `not reached in ${secs(p.timeoutMs)}` : secs(p.loadMs)}, ${p.requests} requests${p.title ? `, “${cell(p.title)}”` : ''}`, '');
      if (p.pending?.length) out.push(`Still open when it stopped waiting: ${p.pending.map((x) => `\`${cell(x)}\``).join(', ')}`, '');
      if (p.slowest?.length) out.push(`Slowest requests: ${p.slowest.map((x) => `\`${cell(x.url)}\` ${secs(x.ms)}`).join(', ')}`, '');
    }
  }
  return out.join('\n');
}
