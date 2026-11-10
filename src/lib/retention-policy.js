/**
 * Retention policy resolution for VITAL Core.
 *
 * This module is deliberately read-only. It answers "how much live detail
 * should be kept, and what would happen to older weeks?" It never deletes,
 * archives, uploads or rewrites anything. Destructive pruning remains in
 * `src/prune.js` and is not changed by the planning layer.
 */

const DEFAULT_STORAGE = Object.freeze({ warning_mb: 1300, critical_mb: 1600, weekly_growth_warning_mb: 100 });

export const RETENTION_PROFILES = Object.freeze({
  minimal: {
    live: { mode: 'fixed', weeks: 2 },
    archive: { enabled: false, retention_months: 0, verify_before_prune: false, backend: 'local', path: 'archives' },
    summary: { retention: 'indefinite' },
    storage: { ...DEFAULT_STORAGE },
  },
  balanced: {
    live: { mode: 'adaptive', minimum_weeks: 4, maximum_weeks: 16, scan_cycle_multiplier: 1.25 },
    archive: { enabled: true, retention_months: 12, verify_before_prune: true, backend: 'local', path: 'archives' },
    summary: { retention: 'indefinite' },
    storage: { ...DEFAULT_STORAGE },
  },
  research: {
    live: { mode: 'adaptive', minimum_weeks: 8, maximum_weeks: 26, scan_cycle_multiplier: 1.5 },
    archive: { enabled: true, retention_months: 36, verify_before_prune: true, backend: 'local', path: 'archives' },
    summary: { retention: 'indefinite' },
    storage: { ...DEFAULT_STORAGE },
  },
  preserve: {
    live: { mode: 'fixed', weeks: 52 },
    archive: { enabled: true, retention_months: 'indefinite', verify_before_prune: true, backend: 'local', path: 'archives' },
    summary: { retention: 'indefinite' },
    storage: { ...DEFAULT_STORAGE },
  },
});

const TOP_KEYS = ['profile', 'live', 'archive', 'summary', 'storage'];
const LIVE_KEYS = ['mode', 'weeks', 'minimum_weeks', 'maximum_weeks', 'scan_cycle_multiplier'];
const ARCHIVE_KEYS = ['enabled', 'retention_months', 'storage', 'backend', 'path', 'endpoint', 'bucket', 'prefix', 'verify_before_prune'];
const STORAGE_KEYS = ['warning_mb', 'critical_mb', 'weekly_growth_warning_mb'];
const positive = (value) => Number.isFinite(value) && value > 0;

function assertKeys(value, allowed, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${where}: unknown key ${key}`);
  }
}

function merge(base, override) {
  return {
    ...base,
    ...override,
    live: { ...base.live, ...(override.live ?? {}) },
    archive: { ...base.archive, ...(override.archive ?? {}) },
    summary: { ...base.summary, ...(override.summary ?? {}) },
    storage: { ...(base.storage ?? {}), ...(override.storage ?? {}) },
  };
}

function validate(policy, legacyFieldApplied = false) {
  assertKeys(policy, TOP_KEYS, 'retention');
  if (!Object.hasOwn(RETENTION_PROFILES, policy.profile) && policy.profile !== 'legacy') {
    throw new Error(`Unknown retention profile: ${policy.profile}`);
  }
  assertKeys(policy.live, LIVE_KEYS, 'retention.live');
  assertKeys(policy.archive, ARCHIVE_KEYS, 'retention.archive');
  assertKeys(policy.summary, ['retention'], 'retention.summary');
  assertKeys(policy.storage ?? {}, STORAGE_KEYS, 'retention.storage');

  if (!['fixed', 'adaptive'].includes(policy.live.mode)) throw new Error('retention.live.mode must be fixed or adaptive');
  if (policy.live.mode === 'fixed' && (!Number.isInteger(policy.live.weeks) || policy.live.weeks < 1)) {
    throw new Error('retention.live.weeks must be a positive integer');
  }
  if (policy.live.mode === 'adaptive') {
    if (!Number.isInteger(policy.live.minimum_weeks) || policy.live.minimum_weeks < 1 ||
        !Number.isInteger(policy.live.maximum_weeks) || policy.live.maximum_weeks < policy.live.minimum_weeks) {
      throw new Error('invalid adaptive retention week range');
    }
    if (!positive(policy.live.scan_cycle_multiplier)) throw new Error('invalid retention.live.scan_cycle_multiplier');
  }

  if (typeof policy.archive.enabled !== 'boolean') throw new Error('retention.archive.enabled must be boolean');
  if (!(policy.archive.retention_months === 'indefinite' ||
        (Number.isInteger(policy.archive.retention_months) && policy.archive.retention_months >= 0))) {
    throw new Error('retention.archive.retention_months must be a non-negative integer or indefinite');
  }
  if (policy.archive.enabled && policy.archive.retention_months === 0) {
    throw new Error('an enabled archive must have a positive retention period');
  }
  if (policy.archive.enabled && policy.archive.verify_before_prune !== true) {
    throw new Error('archive.verify_before_prune must be true when archiving is enabled');
  }
  if (!['local', 's3'].includes(policy.archive.backend)) throw new Error('archive.backend must be local or s3');
  if (policy.archive.path != null && typeof policy.archive.path !== 'string') throw new Error('archive.path must be a string');
  if (policy.archive.endpoint != null && typeof policy.archive.endpoint !== 'string') throw new Error('archive.endpoint must be a string');
  if (policy.archive.bucket != null && typeof policy.archive.bucket !== 'string') throw new Error('archive.bucket must be a string');
  if (policy.archive.prefix != null && typeof policy.archive.prefix !== 'string') throw new Error('archive.prefix must be a string');
  if (policy.summary.retention !== 'indefinite') {
    throw new Error('summary.retention must be indefinite in this version');
  }
  for (const [key, value] of Object.entries(policy.storage ?? {})) {
    if (!positive(value)) throw new Error(`retention.storage.${key} must be positive`);
  }
  if (policy.storage?.warning_mb != null && policy.storage?.critical_mb != null &&
      policy.storage.warning_mb >= policy.storage.critical_mb) {
    throw new Error('retention.storage.warning_mb must be smaller than critical_mb');
  }
  if (legacyFieldApplied) policy.legacyFieldApplied = true;
  return policy;
}

/**
 * Resolve a policy from a named profile plus global defaults plus per-target
 * overrides. Precedence is target > global defaults > profile.
 */
export function resolveRetention(defaults = {}, override = {}, legacyWeeks = null) {
  assertKeys(defaults, TOP_KEYS, 'retention defaults');
  assertKeys(override, TOP_KEYS, 'retention override');
  const profile = override.profile ?? defaults.profile ?? 'balanced';
  if (!Object.hasOwn(RETENTION_PROFILES, profile)) throw new Error(`Unknown retention profile: ${profile}`);
  const merged = merge(merge(RETENTION_PROFILES[profile], defaults), override);
  merged.profile = profile;

  let legacyApplied = false;
  // Legacy only applies when neither level supplied an explicit live policy.
  // The integration wrapper decides whether `retention:` exists at all; this
  // branch keeps the standalone resolver useful and backward-compatible.
  if (legacyWeeks != null && defaults.live == null && override.live == null) {
    if (!Number.isInteger(legacyWeeks) || legacyWeeks < 1) throw new Error('retention_weeks must be a positive integer');
    merged.live = { mode: 'fixed', weeks: legacyWeeks };
    legacyApplied = true;
  }
  return validate(merged, legacyApplied);
}

/**
 * Integration entry point used by config.js.
 *
 * Explicit `retention:` config wins over legacy `retention_weeks`. If no
 * explicit policy exists, legacy fixed weeks are preserved exactly and no
 * archive is assumed. Warnings are returned rather than printed so callers and
 * tests can surface them consistently.
 */
export function resolveTargetRetention({ defaultsRetention = null, targetRetention = null, legacyWeeks = null } = {}) {
  const explicit = defaultsRetention != null || targetRetention != null;
  const warnings = [];
  let policy;
  let source;
  if (explicit) {
    policy = resolveRetention(defaultsRetention ?? {}, targetRetention ?? {}, null);
    source = 'retention';
    if (legacyWeeks != null && policy.live.mode === 'fixed' && policy.live.weeks !== legacyWeeks) {
      warnings.push(`retention_weeks: ${legacyWeeks} is superseded by explicit retention.live.weeks: ${policy.live.weeks}`);
    } else if (legacyWeeks != null && policy.live.mode === 'adaptive') {
      warnings.push(`retention_weeks: ${legacyWeeks} is superseded by adaptive retention policy`);
    }
  } else if (legacyWeeks != null) {
    if (!Number.isInteger(legacyWeeks) || legacyWeeks < 1) throw new Error('retention_weeks must be a positive integer');
    policy = {
      profile: 'legacy',
      live: { mode: 'fixed', weeks: legacyWeeks },
      archive: { enabled: false, retention_months: 0, verify_before_prune: false, backend: 'local', path: 'archives' },
      summary: { retention: 'indefinite' },
      storage: { ...DEFAULT_STORAGE },
      legacyFieldApplied: true,
    };
    source = 'retention_weeks';
  } else {
    policy = resolveRetention({}, {}, null);
    source = 'balanced-default';
  }
  const legacyApplied = policy.legacyFieldApplied === true;
  delete policy.legacyFieldApplied;
  return { policy: validate(policy, legacyApplied), source, warnings };
}

/** Adaptive weeks from observed distinct successful URLs per week. */
export function calculateLiveWeeks(policy, { knownUrls, distinctUrlsPerWeek } = {}) {
  const live = policy.live;
  if (live.mode === 'fixed') return { weeks: live.weeks, method: 'fixed' };
  if (!positive(knownUrls) || !positive(distinctUrlsPerWeek)) {
    return { weeks: live.minimum_weeks, method: 'insufficient-evidence' };
  }
  const cycleWeeks = Math.ceil(knownUrls / distinctUrlsPerWeek);
  const requested = Math.ceil(cycleWeeks * live.scan_cycle_multiplier);
  return {
    weeks: Math.min(live.maximum_weeks, Math.max(live.minimum_weeks, requested)),
    method: 'adaptive',
    cycleWeeks,
    clamped: requested > live.maximum_weeks,
  };
}

/**
 * Storage warnings are advisory. They never authorize deletion; callers must
 * keep them separate from the planner's archive/prune decisions.
 */
export function storageWarnings(storage = {}, sizeKb = null, previousKb = null, sevenDaysAgoKb = null) {
  if (!Number.isFinite(sizeKb) || sizeKb <= 0) return [{ code: 'size_unavailable' }];
  const mb = sizeKb / 1024;
  const out = [];
  if (storage.warning_mb && mb > storage.warning_mb) out.push({ code: 'size_warning', mb });
  if (storage.critical_mb && mb > storage.critical_mb) out.push({ code: 'size_critical', mb });
  if (storage.weekly_growth_warning_mb && positive(sevenDaysAgoKb) &&
      (sizeKb - sevenDaysAgoKb) / 1024 > storage.weekly_growth_warning_mb) {
    out.push({ code: 'weekly_growth', mb: (sizeKb - sevenDaysAgoKb) / 1024 });
  }
  if (positive(previousKb) && sizeKb < previousKb) out.push({ code: 'size_decreased', mb: (previousKb - sizeKb) / 1024 });
  return out;
}
