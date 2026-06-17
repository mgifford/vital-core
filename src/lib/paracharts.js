/**
 * Build a ParaCharts JIM manifest for a single-series line chart from the
 * {week, value} points the reports already compute. This is the data contract
 * for the <para-chart> web component (see vendor/paracharts/). Pure and
 * snapshot-testable; the actual mounting happens client-side in the loader
 * script (PARACHART_LOADER in report-html.js).
 *
 * The manifest shape was verified empirically against the vendored runtime:
 * a dataset needs `facets` describing the x/y axes, a `series` of
 * {x, y} records (string-valued, as the runtime expects), and a
 * `data.source` marker — omitting the last makes the runtime throw.
 */
export function buildLineManifest(title, yLabel, points, { xLabel = 'Week', unit = '' } = {}) {
  const records = points
    .filter((p) => p.value != null)
    .map((p) => ({ x: String(p.week), y: String(p.value) }));
  return {
    datasets: [
      {
        type: 'line',
        title,
        facets: {
          x: {
            label: xLabel,
            variableType: 'independent',
            measure: 'interval',
            datatype: 'string',
            displayType: { type: 'axis', orientation: 'horizontal' },
          },
          y: {
            label: yLabel,
            variableType: 'dependent',
            measure: 'ratio',
            datatype: 'number',
            displayType: { type: 'axis', orientation: 'vertical' },
            ...(unit ? { units: unit.trim() } : {}),
          },
        },
        series: [{ key: yLabel, records }],
        data: { source: 'inline' },
        settings: { 'controlPanel.isControlPanelDefaultOpen': false },
      },
    ],
  };
}
