import { ProfileParser } from '../../src/engine/parser';
import { TargetScanResultSchema } from '../../src/types/site-quality-spec';

try {
  console.log('⏳ Running profile ingestion contract validation...');

  const parsedProfile = ProfileParser.loadProfile('profiles/us-health.yml');
  console.log(`✅ Profile verified successfully: "${parsedProfile.profile}" (${parsedProfile.targets.length} targets locked)`);

  const target = parsedProfile.targets[0];
  const sampleDataContainer: any = {
    targetId: target.id,
    domain: target.base_url,
    scanDurationMs: 14200,
    pagesScanned: [
      {
        url: 'https://www.cms.gov/medicare/physician-fee-schedule/search',
        timestamp: new Date().toISOString(),
        status: 'COMPLETED',
        errorMessage: null,
        technologyStack: [
          { name: 'React', category: 'JavaScript Frameworks', version: '18.2.0' }
        ],
        liveAudits: {
          lighthouse: { performanceScore: 78, energyEstimateKwh: 0.42 },
          accessibilityViolations: []
        },
        offlineAudits: {
          overlayDetected: { found: false, provider: null, evidence: null },
          designSystem: { usesUSWDS: true, versionDetected: '3.5.0' },
          contentMetrics: { readabilityScore: 45.2, suspiciousAltTextCount: 0, suspiciousAltInstances: [] },
          linkHealth: { totalChecked: 12, brokenCount: 0, brokenLinks: [] }
        }
      }
    ]
  };

  TargetScanResultSchema.parse(sampleDataContainer);
  console.log('✅ Universal Data Spec matching complete. Profile contract validation passed.');
} catch (err: any) {
  console.error('❌ Execution validation failed:', err.message);
  process.exit(1);
}
