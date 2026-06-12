/**
 * Minimal, conservative robots.txt handling.
 * - Honors Disallow/Allow for `User-agent: *` and for our own UA token.
 * - Supports `*` wildcards and `$` end anchors in paths.
 * - Honors Crawl-delay (capped by caller).
 * - On fetch failure, allows crawling (standard convention) but the
 *   caller's politeness delay still applies.
 * If a rule is ambiguous, we err on the side of NOT crawling.
 */

export async function fetchRobots(origin, userAgent) {
  try {
    const res = await fetch(new URL('/robots.txt', origin), {
      headers: { 'user-agent': userAgent },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return parseRobots('', userAgent);
    return parseRobots(await res.text(), userAgent);
  } catch {
    return parseRobots('', userAgent);
  }
}

export function parseRobots(text, userAgent) {
  const uaToken = (userAgent.split('/')[0] || '*').toLowerCase();
  const groups = []; // { agents: [], rules: [{type, path}], crawlDelay }
  let current = null;
  let lastWasAgent = false;

  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([a-zA-Z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();

    if (field === 'user-agent') {
      if (!lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (current && (field === 'disallow' || field === 'allow')) {
      if (value) current.rules.push({ type: field, path: value });
      else if (field === 'disallow') current.rules.push({ type: 'allow-all', path: '' });
      lastWasAgent = false;
    } else if (current && field === 'crawl-delay') {
      const d = parseFloat(value);
      if (!Number.isNaN(d)) current.crawlDelay = d;
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }

  // Most specific matching group wins: our UA token, else *.
  const own = groups.find((g) => g.agents.some((a) => a !== '*' && uaToken.includes(a)));
  const star = groups.find((g) => g.agents.includes('*'));
  const group = own ?? star ?? { rules: [], crawlDelay: null };

  const compiled = group.rules
    .filter((r) => r.type !== 'allow-all')
    .map((r) => ({ type: r.type, path: r.path, re: pathToRegex(r.path), len: r.path.length }));

  return {
    crawlDelay: group.crawlDelay,
    isAllowed(pathname) {
      // Longest-match wins; Allow beats Disallow on equal length.
      let best = null;
      for (const r of compiled) {
        if (r.re.test(pathname)) {
          if (!best || r.len > best.len || (r.len === best.len && r.type === 'allow')) best = r;
        }
      }
      return !best || best.type === 'allow';
    },
  };
}

function pathToRegex(rulePath) {
  const escaped = rulePath
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  const anchored = escaped.endsWith('\\$') ? escaped.slice(0, -2) + '$' : escaped;
  return new RegExp('^' + anchored);
}
