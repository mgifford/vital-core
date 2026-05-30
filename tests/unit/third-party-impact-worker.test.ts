import { describe, expect, it } from 'vitest';
import { ThirdPartyImpactWorker } from '../../src/engine/workers/third-party-impact-worker';

describe('ThirdPartyImpactWorker', () => {
  it('detects high-risk third-party trigger reasons from technology stack and html signatures', () => {
    const reasons = ThirdPartyImpactWorker.findTriggerReasons(
      '<script src="https://www.googletagmanager.com/gtm.js"></script><iframe src="https://third-party.example.org"></iframe>',
      [
        { name: 'Google Tag Manager', category: 'Tag Manager', version: null },
        { name: 'Drupal', category: 'CMS', version: '10' }
      ],
      {
        overlayDetected: { found: false, provider: null, evidence: null },
        designSystem: { usesUSWDS: true, versionDetected: '3' },
        contentMetrics: { readabilityScore: 70, suspiciousAltTextCount: 0, suspiciousAltInstances: [] },
        linkHealth: { totalChecked: 0, brokenCount: 0, brokenLinks: [] }
      }
    );

    expect(reasons.some(reason => reason.includes('Tag manager'))).toBe(true);
    expect(reasons.some(reason => reason.includes('Tag manager present'))).toBe(true);
    expect(reasons.some(reason => reason.includes('iframe'))).toBe(true);
  });

  it('includes overlay trigger evidence when an accessibility overlay is detected', () => {
    const reasons = ThirdPartyImpactWorker.findTriggerReasons(
      '<html><body></body></html>',
      [],
      {
        overlayDetected: { found: true, provider: 'UserWay', evidence: 'cdn.userway.org' },
        designSystem: { usesUSWDS: false, versionDetected: null },
        contentMetrics: { readabilityScore: 60, suspiciousAltTextCount: 0, suspiciousAltInstances: [] },
        linkHealth: { totalChecked: 0, brokenCount: 0, brokenLinks: [] }
      }
    );

    expect(reasons).toContain('Accessibility overlay detected: UserWay');
  });
});
