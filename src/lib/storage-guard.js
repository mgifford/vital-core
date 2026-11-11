/**
 * Size-growth policy shared by the report workflow and local diagnostics.
 *
 * Warnings are advisory. A repository that is already over a threshold must
 * not become a reason to delete history; the operator sees the warning and can
 * investigate provenance.
 */

export const STORAGE_DEFAULTS = Object.freeze({
  code_ceiling_mb: 100,
  data_warning_mb: 1300,
  data_critical_mb: 1600,
  weekly_growth_warning_mb: 100,
  run_growth_warning_mb: 50,
});

export function resolveStorageLimits(value = {}) {
  const unknown = Object.keys(value).filter((key) => !(key in STORAGE_DEFAULTS));
  if (unknown.length) throw new Error(`Unknown storage key(s): ${unknown.join(', ')}`);
  const merged = { ...STORAGE_DEFAULTS, ...value };
  for (const [key, number] of Object.entries(merged)) {
    if (typeof number !== 'number' || !Number.isFinite(number) || number <= 0) {
      throw new Error(`storage.${key} must be a positive number`);
    }
  }
  if (merged.data_warning_mb >= merged.data_critical_mb) {
    throw new Error('storage.data_warning_mb must be smaller than data_critical_mb');
  }
  return merged;
}

export function evaluateStorage({ codeKb, dataKb, previousKb = null, sevenDayKb = null, limits = resolveStorageLimits() }) {
  const warnings = [];
  const codeMb = Number.isFinite(codeKb) ? codeKb / 1024 : null;
  const dataMb = Number.isFinite(dataKb) ? dataKb / 1024 : null;
  if (codeMb != null && codeMb > limits.code_ceiling_mb) {
    warnings.push({
      title: 'Code repo over size ceiling',
      message: `code repository is ~${Math.round(codeMb)} MB, over the ${limits.code_ceiling_mb} MB ceiling`,
    });
  }
  if (!Number.isFinite(dataKb) || dataKb <= 0) {
    return { skip: true, codeMb, dataMb: null, growthMb: null, weeklyGrowthMb: null, warnings };
  }
  if (dataMb > limits.data_critical_mb) {
    warnings.push({ title: 'Repo over critical size ceiling', message: `data repository is ~${Math.round(dataMb)} MB, over the ${limits.data_critical_mb} MB critical ceiling` });
  } else if (dataMb > limits.data_warning_mb) {
    warnings.push({ title: 'Repo over size warning', message: `data repository is ~${Math.round(dataMb)} MB, over the ${limits.data_warning_mb} MB warning` });
  }
  const growthMb = Number.isFinite(previousKb) && previousKb > 0 ? (dataKb - previousKb) / 1024 : null;
  if (growthMb != null && growthMb > limits.run_growth_warning_mb) {
    warnings.push({ title: 'Repo growing fast', message: `data repository grew ~${Math.round(growthMb)} MB since the last report run (now ~${Math.round(dataMb)} MB)` });
  }
  const weeklyGrowthMb = Number.isFinite(sevenDayKb) && sevenDayKb > 0 ? (dataKb - sevenDayKb) / 1024 : null;
  if (weeklyGrowthMb != null && weeklyGrowthMb > limits.weekly_growth_warning_mb) {
    warnings.push({ title: 'Repo growing steadily', message: `data repository grew ~${Math.round(weeklyGrowthMb)} MB since the 7-day baseline (now ~${Math.round(dataMb)} MB)` });
  }
  return { skip: false, codeMb, dataMb, growthMb, weeklyGrowthMb, warnings };
}
