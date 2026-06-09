import { z } from 'zod';

export const IssueSeveritySchema = z.enum(['critical', 'serious', 'moderate', 'minor']);

// Structure aligned with ACCESSIBILITY.md bug reporting requirements
export const A11yViolationSchema = z.object({
  id: z.string(),                  // axe-core rule name (e.g., 'color-contrast') or alfa rule ID (e.g., 'sia-r10')
  severity: IssueSeveritySchema,
  description: z.string(),
  helpUrl: z.string().url(),
  impactedCriteria: z.array(z.string()), // Section 508 / WCAG mapping (e.g., '508-302.1')
  /** Minimum WCAG version that introduced this criterion: '2.0', '2.1', '2.2', 'section508', or 'best-practice'. */
  wcagVersion: z.enum(['2.0', '2.1', '2.2', 'section508', 'best-practice']).optional(),
  /** Which scan engine produced this violation: 'axe' (Deque axe-core) or 'alfa' (Siteimprove Alfa). */
  sourceEngine: z.enum(['axe', 'alfa']).optional(),
  instances: z.array(z.object({
    html: z.string(),              // Failing element markup snippet
    target: z.array(z.string()),   // CSS Selector array
    failureSummary: z.string()     // Remediation suggestion
  }))
});

export const PageAlfaAuditSchema = z.object({
  executed: z.boolean(),
  findingsCount: z.number().nullable(),
  errorMessage: z.string().nullable(),
  rawResults: z.unknown().nullable()
});

export const PageScanReportSchema = z.object({
  url: z.string().url(),
  timestamp: z.string().datetime(),
  status: z.enum(['COMPLETED', 'TIMEOUT', 'WAF_BLOCKED', 'FAILED', 'SKIPPED_UNCHANGED', 'SKIPPED_NON_HTML', 'NOT_FOUND']),
  errorMessage: z.string().nullable(),
  pageTitle: z.string().nullable().optional(),

  scanContext: z.object({
    browserFamily: z.enum(['chrome', 'firefox', 'safari']),
    viewportLabel: z.string(),
    viewport: z.object({
      width: z.number(),
      height: z.number()
    }),
    colorScheme: z.enum(['light', 'dark'])
  }).nullable().optional(),

  // 0. Raw Alfa scan capture for future normalized consensus mapping
  alfaAudits: PageAlfaAuditSchema.nullable().optional(),

  // 1. Technology Fingerprint Profile (wappalyzer-next)
  technologyStack: z.array(z.object({
    name: z.string(),
    category: z.string(),
    version: z.string().nullable()
  })),

  // 1b. Third-party JavaScript impact profiling (JS enabled vs JS disabled comparison)
  thirdPartyImpact: z.object({
    evaluated: z.boolean(),
    triggeredBy: z.array(z.string()),
    regressionDetected: z.boolean(),
    baselineViolationCount: z.number(),
    jsDisabledViolationCount: z.number(),
    addedByJavaScriptCount: z.number(),
    removedByJavaScriptCount: z.number(),
    highRiskRules: z.array(z.string()),
    providerAttribution: z.array(z.object({
      provider: z.string(),
      confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
      score: z.number(),
      signals: z.array(z.string())
    })),
    likelyIntroducedByProviders: z.array(z.string()),
    ruleToLikelyProviders: z.array(z.object({
      ruleId: z.string(),
      providers: z.array(z.string())
    })),
    ruleToProviderAttribution: z.array(z.object({
      ruleId: z.string(),
      providers: z.array(z.object({
        provider: z.string(),
        confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
        score: z.number()
      }))
    }))
  }).nullable().optional(),

  // 2. Live Browser Session Evaluation
  liveAudits: z.object({
    lighthouse: z.object({
      performanceScore: z.number().nullable(), // 0-100 scale
      energyEstimateKwh: z.number().nullable(), // SWD model energy calculation per page visit
      firstContentfulPaintMs: z.number().nullable().optional(),
      largestContentfulPaintMs: z.number().nullable().optional(),
      speedIndexMs: z.number().nullable().optional(),
      accessibilityScore: z.number().nullable().optional(), // 0-100 scale
      seoScore: z.number().nullable().optional(),           // 0-100 scale
      bestPracticesScore: z.number().nullable().optional(), // 0-100 scale
      agenticScore: z.number().nullable().optional()        // experimental: agentic browsing pass ratio 0-100
    }).nullable(),
    accessibilityViolations: z.array(A11yViolationSchema)
  }).nullable(),

  // 3. Offline Snapshot Diagnostics (Executed entirely local via file cache)
  offlineAudits: z.object({
    overlayDetected: z.object({
      found: z.boolean(),
      provider: z.string().nullable(), // Name of overlay discovered (e.g., 'UserWay')
      evidence: z.string().nullable()  // Script signature or snippet string
    }),
    designSystem: z.object({
      usesUSWDS: z.boolean(),
      versionDetected: z.string().nullable()
    }),
    contentMetrics: z.object({
      readabilityScore: z.number().nullable(), // Flesch-Kincaid index metric
      fleschKincaidGrade: z.number().nullable().optional(),
      averageSentenceLength: z.number().nullable().optional(),
      passiveVoiceSentenceRatio: z.number().nullable().optional(),
      longSentenceCount: z.number().optional(),
      unexplainedAcronymCount: z.number().optional(),
      ambiguousLinkTextCount: z.number().optional(),
      suspiciousAltTextCount: z.number(),      // Occurrences of 'image.png', 'blank', etc.
      suspiciousAltInstances: z.array(z.object({
        imgHtml: z.string(),
        invalidValue: z.string()
      })),
      wordCount: z.number().optional(),           // Word count in main content area (excl. nav/header/footer)
      totalImageCount: z.number().optional(),     // All <img> elements on the page
      contentImageCount: z.number().optional(),   // <img> elements within main content area only
      misspelledWordCount: z.number().optional(), // Unique misspelled lowercase words in main content
      misspelledWords: z.array(z.string()).optional() // Up to 20 unique misspelled words
    }),
    linkHealth: z.object({
      totalChecked: z.number(),
      brokenCount: z.number(),
      brokenLinks: z.array(z.object({
        sourceUrl: z.string(),
        targetUrl: z.string(),
        statusCode: z.number().nullable()
      }))
    })
  }).nullable()
});

export const TargetScanResultSchema = z.object({
  targetId: z.string(),
  domain: z.string(),
  scanDurationMs: z.number(),
  pagesScanned: z.array(PageScanReportSchema)
});

export type A11yViolation = z.infer<typeof A11yViolationSchema>;
export type PageAlfaAudit = z.infer<typeof PageAlfaAuditSchema>;
export type PageScanReport = z.infer<typeof PageScanReportSchema>;
export type TargetScanResult = z.infer<typeof TargetScanResultSchema>;
