export function percentile(list, pct) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const rank = (pct / 100) * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const val = lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (rank - lo);
  return Math.round(val * 10) / 10;
}

export function summarizeDistribution(list) {
  if (!list.length) return null;
  const min = Math.min(...list);
  const max = Math.max(...list);
  const p10 = percentile(list, 10);
  const p25 = percentile(list, 25);
  const p50 = percentile(list, 50);
  const p75 = percentile(list, 75);
  const p90 = percentile(list, 90);
  return {
    min,
    max,
    p10,
    p25,
    p50,
    p75,
    p90,
    range: Math.round((max - min) * 10) / 10,
    spreadP10toP90: Math.round((p90 - p10) * 10) / 10,
    iqr: Math.round((p75 - p25) * 10) / 10,
  };
}
