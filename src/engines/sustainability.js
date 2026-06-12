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
      const co2g = bytes > 0 ? swd.perByte(bytes) : 0;
      return {
        engine: 'sustainability',
        requests,
        bytes,
        byType,
        co2g: Math.round(co2g * 10000) / 10000,
        model: 'swd-v4 (co2.js)',
      };
    },
  };
}
