/**
 * Performance-impact estimate: how much extra time visitors wait, and how
 * much extra data they download, because pages miss Google's benchmarks.
 * Method follows mgifford/daily-dap:
 *   extra time per page = max(0, LCP - 2.5s)
 *   extra data per page = max(0, pageWeight - 1.6 MB)
 * Per-page averages need no traffic data. If a target supplies weekly
 * page-load counts, we also estimate site-wide totals (× loads), the way
 * daily-dap multiplies per-URL waste by DAP analytics.
 *
 * Benchmarks (Google Core Web Vitals "good" thresholds):
 *   LCP <= 2.5 s ; recommended page weight <= 1.6 MB.
 */

const LCP_BENCHMARK_MS = 2500;
const WEIGHT_BENCHMARK_BYTES = 1.6 * 1_000_000;
const WIKIPEDIA_BYTES = 24.05 * 1_000_000_000; // 24.05 GB per Wikipedia:Size of Wikipedia

/**
 * @param lhPages  array of { url, metrics: { largestContentfulPaintMs } }
 * @param weights  array of per-page byte sizes (from sustainability)
 * @param pageLoadsPerWeek  optional total weekly loads for the domain
 */
export function performanceImpact(lhPages = [], weights = [], pageLoadsPerWeek = null) {
  const lcps = lhPages.map((p) => p.metrics?.largestContentfulPaintMs).filter((v) => typeof v === 'number');
  const overLcp = lcps.map((v) => Math.max(0, v - LCP_BENCHMARK_MS)); // ms over benchmark
  const overWeight = weights.map((b) => Math.max(0, b - WEIGHT_BENCHMARK_BYTES)); // bytes over benchmark

  if (lcps.length === 0 && weights.length === 0) return null;

  const avgExtraLcpMs = overLcp.length ? Math.round(mean(overLcp)) : null;
  const avgExtraWeightBytes = overWeight.length ? Math.round(mean(overWeight)) : null;
  const pagesOverLcp = overLcp.filter((v) => v > 0).length;
  const pagesOverWeight = overWeight.filter((v) => v > 0).length;

  const out = {
    lcpBenchmarkMs: LCP_BENCHMARK_MS,
    weightBenchmarkBytes: WEIGHT_BENCHMARK_BYTES,
    lcpPages: lcps.length,
    weightPages: weights.length,
    avgExtraLcpMs,
    avgExtraWeightBytes,
    pagesOverLcp,
    pagesOverWeight,
    totals: null,
  };

  // Site-wide totals require traffic. daily-dap multiplies per-URL waste
  // by page loads; without per-URL loads we apply the domain's weekly
  // total spread evenly across the sampled pages (rough, labeled as such).
  if (pageLoadsPerWeek && pageLoadsPerWeek > 0) {
    const avgLoadsPerSampledLcp = lcps.length ? pageLoadsPerWeek / lcps.length : 0;
    const avgLoadsPerSampledWeight = weights.length ? pageLoadsPerWeek / weights.length : 0;
    const totalExtraSeconds = overLcp.reduce((s, ms) => s + (ms / 1000) * avgLoadsPerSampledLcp, 0);
    const totalExtraBytes = overWeight.reduce((s, b) => s + b * avgLoadsPerSampledWeight, 0);
    out.totals = {
      pageLoadsPerWeek,
      extraSeconds: Math.round(totalExtraSeconds),
      extraSecondsHuman: humanDuration(totalExtraSeconds),
      extraBytes: Math.round(totalExtraBytes),
      extraBytesHuman: humanBytes(totalExtraBytes),
      wikipediaCopies: Math.round(totalExtraBytes / WIKIPEDIA_BYTES),
    };
  }
  return out;
}

function mean(a) { return a.reduce((s, x) => s + x, 0) / a.length; }

/** Seconds -> "5 years, 26 days" style, largest two units. */
export function humanDuration(seconds) {
  const units = [['year', 31557600], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
  const parts = [];
  let rem = Math.round(seconds);
  for (const [name, size] of units) {
    if (rem >= size && parts.length < 2) {
      const n = Math.floor(rem / size);
      rem -= n * size;
      parts.push(`${n.toLocaleString()} ${name}${n === 1 ? '' : 's'}`);
    }
  }
  return parts.join(', ') || '0 seconds';
}

/** Bytes -> human (TB/GB/MB), decimal units to match the Wikipedia figure. */
export function humanBytes(bytes) {
  const u = [['TB', 1e12], ['GB', 1e9], ['MB', 1e6], ['KB', 1e3]];
  for (const [name, size] of u) {
    if (bytes >= size) return `${(bytes / size).toFixed(1)} ${name}`;
  }
  return `${Math.round(bytes)} B`;
}
