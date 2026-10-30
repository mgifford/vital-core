import fs from 'node:fs';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { detectBlock } from './access.js';
import { describeNetworkError } from './probe.js';
import { ownDomain } from './pdf-audit.js';

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

class TooLarge extends Error {}

/**
 * Download one PDF to `dest`, for checking. Redirects are followed by hand
 * so none leaves the site's registrable domain, robots.txt (`isAllowed`) is
 * asked for every hop, and a known ETag / Last-Modified makes the request
 * conditional. Returns { kind: 'fetched', path, fetch }, { kind: 'unchanged',
 * fetch } on 304, or { kind: 'error', error, fetch? } with the reason in words.
 */
export async function fetchPdf(url, { siteDomain, userAgent, dest, maxBytes, timeoutMs = 60000, etag = null, lastModified = null, isAllowed = async () => true, maxRedirects = 5 }) {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let u;
    try {
      u = new URL(current);
    } catch {
      return { kind: 'error', error: `not a valid URL: ${current}` };
    }
    if (!/^https?:$/.test(u.protocol)) return { kind: 'error', error: `not an http(s) URL: ${u.protocol}` };
    if (!ownDomain(current, siteDomain)) return { kind: 'error', error: `redirects off the site, to ${u.hostname}` };
    if (!(await isAllowed(u))) return { kind: 'error', error: 'disallowed by robots.txt for the scanner' };

    const headers = { 'user-agent': userAgent, accept: 'application/pdf,*/*;q=0.8' };
    if (etag) headers['if-none-match'] = etag;
    if (lastModified) headers['if-modified-since'] = lastModified;
    let res;
    try {
      res = await fetch(current, { redirect: 'manual', headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const code = err?.cause?.code ?? err?.code ?? err?.name;
      return { kind: 'error', error: code === 'TimeoutError' ? `no response within ${Math.round(timeoutMs / 1000)} s` : describeNetworkError(code) };
    }
    const { status } = res;
    if (status >= 300 && status < 400 && status !== 304) {
      await res.body?.cancel();
      const location = res.headers.get('location');
      if (!location) return { kind: 'error', fetch: { status }, error: `HTTP ${status} without a Location header` };
      current = new URL(location, current).href;
      continue;
    }

    // A 304 carries no new validators, so the stored ones must stand.
    const info = { status, finalUrl: current };
    if (status !== 304) Object.assign(info, { etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') });
    if (status === 304) {
      await res.body?.cancel();
      return { kind: 'unchanged', fetch: info };
    }
    const block = detectBlock({ status, headers: Object.fromEntries(res.headers) });
    if (block || !res.ok) {
      await res.body?.cancel();
      const by = block?.by?.length ? `, ${block.by.join(', ')}` : '';
      const what = block?.kind === 'challenge' ? 'a firewall challenge' : block ? 'refused' : 'error';
      return { kind: 'error', fetch: info, error: `HTTP ${status}${block ? ` (${what}${by})` : ''}` };
    }
    const declared = Number(res.headers.get('content-length'));
    if (declared > maxBytes) {
      await res.body?.cancel();
      return { kind: 'error', fetch: info, error: `larger than the ${mb(maxBytes)} limit (${mb(declared)})` };
    }

    const hash = crypto.createHash('md5');
    let bytes = 0;
    try {
      // pipeline() keeps an error listener on the file until it has closed: a
      // write still in flight when a download is abandoned fails afterwards,
      // and uncaught, that error would end the whole run.
      await pipeline(res.body, async function* (source) {
        for await (const chunk of source) {
          bytes += chunk.length;
          if (bytes > maxBytes) throw new TooLarge();
          hash.update(chunk);
          yield chunk;
        }
      }, fs.createWriteStream(dest));
    } catch (err) {
      fs.rmSync(dest, { force: true });
      if (err instanceof TooLarge) return { kind: 'error', fetch: info, error: `larger than the ${mb(maxBytes)} limit` };
      return { kind: 'error', fetch: info, error: `download interrupted: ${err?.name === 'TimeoutError' ? `no complete response within ${Math.round(timeoutMs / 1000)} s` : err?.message ?? err}` };
    }
    return { kind: 'fetched', path: dest, fetch: { ...info, md5: hash.digest('hex'), bytes } };
  }
  return { kind: 'error', error: `more than ${maxRedirects} redirects` };
}
