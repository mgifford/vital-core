import crypto from 'node:crypto';

/**
 * Per-engine weekly sampling. Each engine has a target coverage rate —
 * the fraction of a week's unique pages it should run on (axe 100%,
 * Alfa 30%, Lighthouse 10%, etc.). Rates are set in one place,
 * config/targets.yml under `sampling:`.
 *
 * The scan is incremental: pages are scanned in batches across the week,
 * so we cannot pick "30% of this week's pages" up front — we don't know
 * the full set until the week ends. Instead each page decides, at scan
 * time, whether it is in a given engine's sample, using a stable hash of
 * (pageId + engine + week). Because the hash is uniform over pageIds,
 * about `rate` of pages fall in the sample, and the decision is:
 *   - reproducible: re-running a week reproduces the same sample;
 *   - stable within a week: a page stays in (or out of) an engine's
 *     sample no matter which nightly run reaches it;
 *   - independent per engine: Alfa's 30% is not correlated with
 *     Lighthouse's 10%.
 */

/**
 * Normalize a configured rate to a fraction in [0,1]. Accepts a fraction
 * (0.3), a percentage (30), or a percent string ("30%"). Missing/invalid
 * rates default to 0 (engine off) so a typo never silently runs an
 * expensive engine everywhere.
 */
export function normalizeRate(raw) {
  if (raw == null) return 0;
  let n = typeof raw === 'string' ? parseFloat(raw.replace('%', '')) : Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 1) n = n / 100; // a value above 1 is read as a percentage
  return Math.min(1, n);
}

/**
 * Deterministic membership test: is this page in `engine`'s sample for
 * `week`, given a coverage `rate` (fraction or percentage)?
 *
 * rate >= 1 -> always; rate <= 0 -> never. Otherwise compare a uniform
 * hash of (pageId|engine|week) in [0,1) against the rate.
 */
export function shouldRun(engine, pageId, week, rate) {
  const r = normalizeRate(rate);
  if (r >= 1) return true;
  if (r <= 0) return false;
  return hashUnit(`${pageId}|${engine}|${week}`) < r;
}

/** Map a string to a uniform value in [0,1) via the first 52 bits of SHA-256. */
function hashUnit(s) {
  const hex = crypto.createHash('sha256').update(s).digest('hex').slice(0, 13); // 52 bits
  return parseInt(hex, 16) / 2 ** 52;
}

/**
 * Resolve the effective sampling rates for a target: defaults merged with
 * any per-target overrides. Engines absent from the map default to 0
 * (off), except via `fallback` which callers can use for engines that
 * should run unless explicitly disabled.
 */
export function ratesFor(config, target) {
  return { ...(config.sampling ?? {}), ...(target.sampling ?? {}) };
}
