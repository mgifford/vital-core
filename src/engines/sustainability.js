import { co2 } from '@tgwf/co2';

const swd = new co2({ model: 'swd', version: 4 });

/**
 * Page-weight and emissions estimates aligned with the W3C Web
 * Sustainability Guidelines' measurability focus.
 *
 * Honest limits, stated plainly:
 * - Bytes are decoded body sizes observed by the browser, not on-wire
 *   transfer sizes. Compression makes real transfer smaller. The number
 *   is comparable week over week, which is what matters here.
 * - CO2 figures use the Sustainable Web Design model (v4) from
 *   thegreenwebfoundation's co2.js. They are estimates of an estimate.
 *   Use them for trends, not absolute claims.
 * - Energy (Wh) is the quantity underneath the CO2 estimate: the SWD
 *   model computes CO2 = energy x grid carbon intensity. We derive energy
 *   back out so reports can show either (see sustainability_metric).
 */
export function createSustainabilityCollector(page) {
  const byType = {};
  let requests = 0;
  let bytes = 0;

  const onResponse = async (response) => {
    requests++;
    let size = 0;
    try {
      const lenHeader = response.headers()['content-length'];
      if (lenHeader) {
        size = parseInt(lenHeader, 10) || 0;
      } else {
        const body = await response.body().catch(() => null);
        size = body ? body.length : 0;
      }
    } catch {
      size = 0;
    }
    bytes += size;
    const type = response.request().resourceType() || 'other';
    byType[type] = (byType[type] ?? 0) + size;
  };

  page.on('response', onResponse);

  return {
    collect() {
      page.off('response', onResponse);
      let co2g = 0;
      let energyWh = 0;
      if (bytes > 0) {
        // perByteTrace exposes both the CO2 and the grid intensity used to
        // produce it; energy (kWh) = CO2 (g) / gridIntensity (g/kWh).
        const trace = swd.perByteTrace(bytes);
        co2g = trace.co2;
        const gridIntensity = trace.variables?.gridIntensity?.device?.value ?? 494;
        energyWh = gridIntensity > 0 ? (co2g / gridIntensity) * 1000 : 0; // kWh -> Wh
      }
      return {
        engine: 'sustainability',
        requests,
        bytes,
        byType,
        co2g: Math.round(co2g * 10000) / 10000,
        energyWh: Math.round(energyWh * 10000) / 10000,
        model: 'swd-v4 (co2.js)',
      };
    },
  };
}
