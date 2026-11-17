import { co2 } from '@tgwf/co2';

const swd = new co2({ model: 'swd', version: 4 });
const FALLBACK_GRID_INTENSITY = 494;
export const SUSTAINABILITY_MEASUREMENT_VERSION = 'sustainability-measurement/1';

/**
 * Page-weight and emissions estimates aligned with the W3C Web
 * Sustainability Guidelines' measurability focus.
 *
 * Historical fields (`bytes`, `byType`, `co2g`, `energyWh`, `model`) are kept
 * unchanged for compatibility. `bytes` is a legacy mixed basis: Content-Length
 * where present (usually encoded), otherwise decoded response body. It is not
 * a pure network-transfer measurement.
 *
 * New `measurement` metadata records the resource-timing bytes separately and
 * states the model boundary. CO2 and Wh are modeled estimates, not observed
 * client energy.
 */
export function createSustainabilityCollector(page) {
  const byType = {};
  let requests = 0;
  let legacyBytes = 0;
  let contentLengthBytes = 0;
  let decodedFallbackBytes = 0;
  let contentLengthResources = 0;
  let bodyFallbackResources = 0;
  let unmeasuredResources = 0;

  const onResponse = async (response) => {
    requests++;
    let size = 0;
    let measured = false;
    try {
      // Historical semantics intentionally preserved: Content-Length first,
      // decoded body only as fallback. Do not change without versioning.
      const lenHeader = response.headers()['content-length'];
      if (lenHeader) {
        size = parseInt(lenHeader, 10) || 0;
        contentLengthBytes += size;
        contentLengthResources++;
        measured = true;
      } else {
        const body = await response.body().catch(() => null);
        if (body) {
          size = body.length;
          decodedFallbackBytes += size;
          bodyFallbackResources++;
          measured = true;
        }
      }
    } catch {
      size = 0;
    }
    if (!measured) unmeasuredResources++;
    legacyBytes += size;
    const type = response.request().resourceType() || 'other';
    byType[type] = (byType[type] ?? 0) + size;
  };

  page.on('response', onResponse);

  return {
    async collect() {
      page.off('response', onResponse);
      let timing = [];
      try {
        timing = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => ({
          name: entry.name,
          transferSize: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
          encodedBodySize: Number.isFinite(entry.encodedBodySize) ? entry.encodedBodySize : null,
          decodedBodySize: Number.isFinite(entry.decodedBodySize) ? entry.decodedBodySize : null,
        })));
      } catch {
        timing = [];
      }
      const sum = (key) => timing.reduce((total, entry) => total + (entry[key] ?? 0), 0);
      const timingTransfer = sum('transferSize');
      const timingEncoded = sum('encodedBodySize');
      const timingDecoded = sum('decodedBodySize');
      const zeroTransfer = timing.filter((entry) => entry.transferSize === 0).length;

      let co2g = 0;
      let energyWh = 0;
      let gridIntensity = null;
      let gridIntensitySource = null;
      if (legacyBytes > 0) {
        // perByteTrace exposes the grid intensity used by the model.
        const trace = swd.perByteTrace(legacyBytes);
        co2g = trace.co2;
        gridIntensity = trace.variables?.gridIntensity?.device?.value ?? null;
        gridIntensitySource = gridIntensity != null ? 'co2.js trace' : 'fallback constant';
        if (gridIntensity == null) gridIntensity = FALLBACK_GRID_INTENSITY;
        energyWh = gridIntensity > 0 ? (co2g / gridIntensity) * 1000 : 0; // kWh -> Wh
      }

      return {
        engine: 'sustainability',
        requests,
        bytes: legacyBytes,
        byType,
        co2g: Math.round(co2g * 10000) / 10000,
        energyWh: Math.round(energyWh * 10000) / 10000,
        model: 'swd-v4 (co2.js)',
        measurement: {
          schema_version: SUSTAINABILITY_MEASUREMENT_VERSION,
          collected_at: new Date().toISOString(),
          functional_unit: 'page-view',
          boundary: 'client-observed resources during one page load; excludes server infrastructure, network embodied emissions and device energy',
          legacy_bytes: {
            value: legacyBytes,
            basis: 'content-length-or-decoded-body (mixed; historical)',
            content_length_bytes: contentLengthBytes,
            content_length_resources: contentLengthResources,
            decoded_fallback_bytes: decodedFallbackBytes,
            decoded_fallback_resources: bodyFallbackResources,
            unmeasured_resources: unmeasuredResources,
            note: 'Historical bytes/co2g/energyWh retain this basis. Content-Length is usually encoded; the fallback body length is decoded. This is not a pure transfer-size measurement.',
          },
          resource_timing: {
            entries: timing.length,
            transfer_bytes: timing.length ? timingTransfer : null,
            encoded_body_bytes: timing.length ? timingEncoded : null,
            decoded_body_bytes: timing.length ? timingDecoded : null,
            zero_transfer_entries: zeroTransfer,
            note: timing.length
              ? 'Resource Timing transferSize is actual network transfer when available; zero can mean cache or cross-origin restriction.'
              : 'Resource Timing entries unavailable; transfer bytes unknown.',
          },
          co2: {
            value_g: Math.round(co2g * 10000) / 10000,
            model: 'Sustainable Web Design',
            model_version: 'v4',
            basis: 'modelled estimate from the legacy page-byte total; not measured emissions',
          },
          energy: {
            value_wh: Math.round(energyWh * 10000) / 10000,
            basis: 'model-derived from CO2 / grid intensity; not observed client energy',
            grid_intensity_g_per_kwh: gridIntensity,
            grid_intensity_source: gridIntensitySource,
          },
          limitations: [
            'No server-side, network-embodied or device energy measurement.',
            'Cross-origin resources may report zero transfer size without Timing-Allow-Origin.',
            'CO2.js output is an estimate, not a measured carbon quantity.',
          ],
        },
      };
    },
  };
}
