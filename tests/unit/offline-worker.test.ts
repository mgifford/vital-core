import { describe, expect, it } from 'vitest';
import { OfflineWorker } from '../../src/engine/workers/offline-worker';

describe('OfflineWorker', () => {
  it('extracts overlay, design-system, and alt-text metrics from a snapshot', () => {
    const html = `
      <html>
        <body class="usa-grid">
          <script src="https://cdn.userway.org/widget.js"></script>
          <p>The Centers for Medicare & Medicaid Services (CMS) helps people access benefits.</p>
          <a href="/details">Read more</a>
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
    expect(result.contentMetrics.fleschKincaidGrade).toBeGreaterThanOrEqual(0);
    expect(result.contentMetrics.averageSentenceLength).toBeGreaterThan(0);
    expect(result.contentMetrics.passiveVoiceSentenceRatio).toBeGreaterThanOrEqual(0);
    expect(result.contentMetrics.passiveVoiceSentenceRatio).toBeLessThanOrEqual(100);
    expect(result.contentMetrics.ambiguousLinkTextCount).toBe(1);
    expect(result.contentMetrics.unexplainedAcronymCount).toBe(0);
  });
});
