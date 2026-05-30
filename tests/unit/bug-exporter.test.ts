import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { BugExporter } from '../../src/engine/reporters/bug-exporter';
import { TargetScanResult } from '../../src/types/site-quality-spec';

const ORIGINAL_PURPLE_DIR = process.env.VITAL_PURPLE_AI_DIR;

afterEach(() => {
  if (ORIGINAL_PURPLE_DIR === undefined) {
    delete process.env.VITAL_PURPLE_AI_DIR;
  } else {
    process.env.VITAL_PURPLE_AI_DIR = ORIGINAL_PURPLE_DIR;
  }
});

describe('BugExporter', () => {
  it('writes markdown and csv issue reports for a target', () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vital-purple-bug-exporter-'));
    fs.mkdirSync(path.join(fixtureDir, 'results'), { recursive: true });
    fs.writeFileSync(
      path.join(fixtureDir, 'catalog.json'),
      JSON.stringify(
        {
          lastUpdated: '2026-05-29T00:00:00.000Z',
          'image-alt': ['img_src']
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      path.join(fixtureDir, 'results', 'image-alt.json'),
      JSON.stringify(
        {
          img_src: 'Use concise alt text describing the image purpose in page context.'
        },
        null,
        2
      )
    );
    process.env.VITAL_PURPLE_AI_DIR = fixtureDir;

    const payload: TargetScanResult = {
      targetId: 'sample-target',
      domain: 'https://example.org',
      scanDurationMs: 1234,
      pagesScanned: [
        {
          url: 'https://example.org/page',
          timestamp: new Date().toISOString(),
          status: 'COMPLETED',
          errorMessage: null,
          technologyStack: [],
          liveAudits: {
            lighthouse: {
              performanceScore: 88,
              energyEstimateKwh: null,
              firstContentfulPaintMs: 1200,
              largestContentfulPaintMs: 2100,
              speedIndexMs: 3000
            },
            accessibilityViolations: [
              {
                id: 'image-alt',
                severity: 'serious',
                description: 'Images must have alternate text',
                helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
                impactedCriteria: ['wcag2a'],
                instances: [
                  {
                    html: '<img src="hero.png">',
                    target: ['.hero img'],
                    failureSummary: 'Add a meaningful alt attribute.'
                  }
                ]
              }
            ]
          },
          offlineAudits: {
            overlayDetected: { found: false, provider: null, evidence: null },
            designSystem: { usesUSWDS: false, versionDetected: null },
            contentMetrics: {
              readabilityScore: 45,
              suspiciousAltTextCount: 0,
              suspiciousAltInstances: []
            },
            linkHealth: {
              totalChecked: 0,
              brokenCount: 0,
              brokenLinks: []
            }
          }
        }
      ]
    };

    const markdownFile = BugExporter.exportMarkdownReport(payload);
    const csvFile = markdownFile.replace('.md', '.csv');

    const markdownPath = path.resolve(process.cwd(), 'dist/reports', markdownFile);
    const csvPath = path.resolve(process.cwd(), 'dist/reports', csvFile);

    expect(fs.existsSync(markdownPath)).toBe(true);
    expect(fs.existsSync(csvPath)).toBe(true);

    const csvText = fs.readFileSync(csvPath, 'utf8');
    const markdownText = fs.readFileSync(markdownPath, 'utf8');

    expect(csvText).toContain(
      'target_id,page_url,status,error_message,lighthouse_performance_score,lighthouse_first_contentful_paint_ms,lighthouse_largest_contentful_paint_ms,lighthouse_speed_index_ms'
    );
    expect(csvText).toContain('sample-target,https://example.org/page,COMPLETED,,88,1200,2100,3000,serious,image-alt');
    expect(markdownText).toContain('**Primary Rule Guidance (Deque Axe):** [Deque Axe Ruleset Specification]');
    expect(markdownText).toContain('**Lighthouse Performance Score:** 88');
    expect(markdownText).toContain('**First Contentful Paint (ms):** 1200');
    expect(markdownText).toContain('**Largest Contentful Paint (ms):** 2100');
    expect(markdownText).toContain('**Speed Index (ms):** 3000');
    expect(markdownText).toContain('Supplemental Pattern Advice (curated-purple-ai, HIGH confidence)');
  });
});
