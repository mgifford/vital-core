/**
 * Bounded responses to systematic blocking. A single 403 is a page-level
 * result; repeated refusals are a signal to stop hitting the site this run.
 */
export const MIN_ATTEMPTS_FOR_SHARE = 20;
export const BLOCK_SHARE_STOP = 0.2;
export const CONSECUTIVE_BLOCKS_STOP = 5;
export const MAX_BACKOFF_MS = 15 * 60 * 1000;

export function shouldStopForBlocks({ attempted, blocked, consecutive }) {
  if (consecutive >= CONSECUTIVE_BLOCKS_STOP) {
    return { stop: true, reason: `${consecutive} consecutive blocked responses` };
  }
  if (attempted >= MIN_ATTEMPTS_FOR_SHARE && blocked / attempted >= BLOCK_SHARE_STOP) {
    return { stop: true, reason: `${blocked} of ${attempted} attempts blocked (${Math.round((blocked / attempted) * 100)}%)` };
  }
  return { stop: false, reason: null };
}

/** Retry-After is seconds or an HTTP date; clamp it and add jitter. */
export function retryAfterMs(value, now = Date.now()) {
  if (value == null) return 0;
  let ms = 0;
  if (/^\d+$/.test(String(value).trim())) ms = Number(value) * 1000;
  else {
    const at = Date.parse(value);
    if (Number.isFinite(at)) ms = at - now;
  }
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(MAX_BACKOFF_MS, ms) + Math.floor(Math.random() * 1000);
}

export function blockBackoffMs({ status, retryAfter, consecutive = 1 }) {
  const retry = retryAfterMs(retryAfter);
  if (retry > 0) return retry;
  if (status === 429 || status === 503) return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(6, consecutive));
  return 0;
}
