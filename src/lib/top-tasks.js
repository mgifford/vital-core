import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './config.js';
import { normalizeUrl } from './urls.js';

/**
 * Resolve a target's designated top-task URLs from inline config and/or
 * a file of URLs (one per line, `#` comments allowed). URLs are normalized
 * to the target's canonical host and deduplicated.
 */
export function loadPriorityUrls(target, origin = `https://${target.domain}`, hostName = new URL(origin).hostname) {
  const raw = [...(target.priority_urls ?? [])];
  if (target.priority_urls_file) {
    const file = target.priority_urls_file;
    const candidates = path.isAbsolute(file)
      ? [file]
      : [path.join(DIRS.config, file), path.join(DIRS.root, file)];
    const p = candidates.find((c) => fs.existsSync(c));
    if (p) {
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const t = line.trim();
        if (t && !t.startsWith('#')) raw.push(t);
      }
    } else {
      console.warn(`[${target.key}] priority_urls_file not found: tried ${candidates.join(', ')}`);
    }
  }

  const seen = new Set();
  const out = [];
  for (const u of raw) {
    const canon = canonicalizeHost(u, hostName);
    const norm = normalizeUrl(canon, origin, hostName);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

function canonicalizeHost(rawUrl, hostName) {
  try {
    const u = new URL(rawUrl);
    const bare = (h) => h.toLowerCase().replace(/^www\./, '');
    if (bare(u.hostname) === bare(hostName)) u.hostname = hostName;
    return u.toString();
  } catch {
    return rawUrl;
  }
}