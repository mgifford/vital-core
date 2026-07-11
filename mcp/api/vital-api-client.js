import { assertAllowedUrl } from '../security/host-allowlist.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export class VitalApiTimeoutError extends Error {
  constructor(url, timeoutMs) {
    super(`Vital API request timed out after ${timeoutMs}ms: ${url}`);
    this.name = 'VitalApiTimeoutError';
    this.url = url;
  }
}

export class VitalApiResponseTooLargeError extends Error {
  constructor(url, maxBytes) {
    super(`Vital API response exceeded the ${maxBytes}-byte size cap: ${url}`);
    this.name = 'VitalApiResponseTooLargeError';
    this.truncated = true;
    this.url = url;
    this.maxBytes = maxBytes;
  }
}

// Only fetches the three documented /api/v1/ endpoints (spec.md FR-07) —
// index.json, <domain>/snapshot.json, <domain>/<week>/findings.json.
// Every request is checked against the single configured host (FR-08) and
// bounded by a timeout and a response-size cap (NFR-03). Responses are
// cached in-memory for the life of the process; nothing is written to disk.
export class VitalApiClient {
  constructor({ apiBase, host, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
    if (!apiBase) throw new Error('VitalApiClient requires apiBase');
    if (!host) throw new Error('VitalApiClient requires host');
    this.apiBase = apiBase;
    this.host = host;
    this._fetch = fetchImpl;
    this._timeoutMs = timeoutMs;
    this._maxBytes = maxBytes;
    this._cache = new Map();
  }

  resolveUrl(relativePath) {
    return new URL(relativePath, this.apiBase).toString();
  }

  async fetchJson(relativePath) {
    const url = this.resolveUrl(relativePath);
    assertAllowedUrl(url, this.host);
    if (this._cache.has(url)) return this._cache.get(url);
    const data = await this._fetchJsonUncached(url);
    this._cache.set(url, data);
    return data;
  }

  async _fetchJsonUncached(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeoutMs);
    let res;
    try {
      res = await this._fetch(url, { signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') throw new VitalApiTimeoutError(url, this._timeoutMs);
      throw new Error(`Vital API request failed: ${url} (${err.message})`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new Error(`Vital API request failed: ${url} returned HTTP ${res.status}`);
    }
    const text = await readBounded(res, this._maxBytes, url);
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(`Vital API returned invalid JSON: ${url} (${err.message})`);
    }
  }

  clearCache() {
    this._cache.clear();
  }

  getIndex() {
    return this.fetchJson('index.json');
  }

  getSnapshot(domainKey) {
    return this.fetchJson(`${domainKey}/snapshot.json`);
  }

  getFindings(domainKey, week) {
    return this.fetchJson(`${domainKey}/${week}/findings.json`);
  }
}

// A cap is only meaningful if enforced while reading, not after buffering
// the whole body — otherwise an oversized response still costs full memory
// before we notice. We reject outright rather than parsing a truncated
// prefix: partial JSON is not valid data, and a typed error lets tool code
// report a clear "truncated" reason instead of a generic parse failure.
async function readBounded(res, maxBytes, url) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new VitalApiResponseTooLargeError(url, maxBytes);
    }
    return text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new VitalApiResponseTooLargeError(url, maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}
