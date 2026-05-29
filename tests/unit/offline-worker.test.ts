import { describe, expect, it } from 'vitest';
import { OfflineWorker } from '../../src/engine/workers/offline-worker';

describe('OfflineWorker', () => {
  it('extracts overlay, design-system, and alt-text metrics from a snapshot', () => {
    const html = `
      <html>
        <body class="usa-grid">
          <script src="https://cdn.userway.org/widget.js"></script>
          <img src="logo.png" alt="logo" />
          <img src="hero.jpg" />
          <p>This sentence is here. Another sentence is here for readability checks.</p>
        </body>
      </html>
    `;

    const result = OfflineWorker.processSnapshot(html);

    expect(result.overlayDetected.found).toBe(true);
    expect(result.overlayDetected.provider).toBe('UserWay');
    expect(result.designSystem.usesUSWDS).toBe(true);
    expect(result.contentMetrics.suspiciousAltTextCount).toBe(2);
    expect(result.contentMetrics.readabilityScore).toBeGreaterThanOrEqual(0);
    expect(result.contentMetrics.readabilityScore).toBeLessThanOrEqual(100);
  });
});
