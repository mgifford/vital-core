/**
 * CDN / WAF fingerprinting from HTTP response headers, and throttle-profile
 * resolution for polite crawling.
 *
 * Usage pattern:
 *   const cdnResult = CdnDetector.detect(responseHeaders);
 *   const throttle = CdnDetector.resolveThrottleProfile(cdnResult, target.settings.throttle_profile);
 */

export type CdnProvider =
  | 'cloudflare'
  | 'akamai'
  | 'fastly'
  | 'awscloudfront'
  | 'azure'
  | 'imperva'
  | null;

export interface CdnDetectionResult {
  /** Identified CDN/WAF provider, or null if none detected. */
  provider: CdnProvider;
  /** Confidence level of the detection. */
  confidence: 'HIGH' | 'LOW';
  /** Header names that triggered the detection. */
  detectedHeaders: string[];
}

/**
 * Throttle profile names supported in target settings and CDN auto-detection.
 *
 *   conservative — 3 s base delay + 1.5 s jitter  (Akamai / Cloudflare / Imperva)
 *   moderate     — 1.5 s base delay + 750 ms jitter (default)
 *   aggressive   — 500 ms base delay + 250 ms jitter (internal / low-traffic sites)
 */
export type ThrottleProfileName = 'conservative' | 'moderate' | 'aggressive';

export interface ThrottleProfile {
  label: ThrottleProfileName;
  /** Minimum milliseconds between requests to the same hostname. */
  sameSiteDelayMs: number;
  /** Maximum random jitter added on top of sameSiteDelayMs. */
  jitterMs: number;
}

export const THROTTLE_PROFILES: Record<ThrottleProfileName, ThrottleProfile> = {
  conservative: { label: 'conservative', sameSiteDelayMs: 3000, jitterMs: 1500 },
  moderate:     { label: 'moderate',     sameSiteDelayMs: 1500, jitterMs: 750  },
  aggressive:   { label: 'aggressive',   sameSiteDelayMs: 500,  jitterMs: 250  }
};

/**
 * CDN providers known for aggressive bot-detection / rate-limiting.
 * Sites behind these CDNs should default to the `conservative` throttle profile.
 */
const STRICT_CDN_PROVIDERS: ReadonlySet<CdnProvider> = new Set<CdnProvider>([
  'cloudflare',
  'akamai',
  'imperva'
]);

interface CdnPattern {
  provider: CdnProvider;
  /** Header names that, when present, indicate this CDN. */
  headers: readonly string[];
  confidence: 'HIGH' | 'LOW';
}

const CDN_HEADER_PATTERNS: readonly CdnPattern[] = [
  {
    provider: 'cloudflare',
    headers: ['cf-ray', 'cf-cache-status', 'cf-request-id'],
    confidence: 'HIGH'
  },
  {
    provider: 'akamai',
    headers: [
      'x-akamai-request-id',
      'x-akamai-transformed',
      'akamai-origin-hop',
      'x-check-cacheable',
      'x-serial',
      'x-true-cache-key',
      'x-akamai-session-info'
    ],
    confidence: 'HIGH'
  },
  {
    provider: 'fastly',
    headers: ['x-served-by', 'x-cache-hits', 'fastly-restarts', 'x-fastly-request-id'],
    confidence: 'HIGH'
  },
  {
    provider: 'awscloudfront',
    headers: ['x-amz-cf-id', 'x-amz-cf-pop'],
    confidence: 'HIGH'
  },
  {
    provider: 'azure',
    headers: ['x-azure-ref', 'x-fd-ref-info', 'x-ms-ref'],
    confidence: 'HIGH'
  },
  {
    provider: 'imperva',
    headers: ['x-iinfo', 'incap-ses', 'x-cdn-forward'],
    confidence: 'HIGH'
  }
];

export class CdnDetector {
  /**
   * Identifies the CDN provider from a map of HTTP response headers.
   * Header name matching is case-insensitive.
   */
  public static detect(responseHeaders: Record<string, string>): CdnDetectionResult {
    const lowerHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(responseHeaders)) {
      lowerHeaders[k.toLowerCase()] = v;
    }

    for (const pattern of CDN_HEADER_PATTERNS) {
      const matched: string[] = [];
      for (const headerName of pattern.headers) {
        if (headerName in lowerHeaders) {
          matched.push(headerName);
        }
      }
      if (matched.length > 0) {
        return {
          provider: pattern.provider,
          // If two or more detection headers present, confidence is always HIGH.
          confidence: matched.length >= 2 ? 'HIGH' : pattern.confidence,
          detectedHeaders: matched
        };
      }
    }

    return { provider: null, confidence: 'LOW', detectedHeaders: [] };
  }

  /**
   * Returns true when the detected CDN is known for strict bot-detection
   * policies (Akamai, Cloudflare, Imperva).
   */
  public static isStrictCdn(result: CdnDetectionResult): boolean {
    return result.provider !== null && STRICT_CDN_PROVIDERS.has(result.provider);
  }

  /**
   * Resolves the throttle profile to use for a target.
   *
   * Priority order (highest to lowest):
   *   1. `profileOverride` — explicit value from target settings in the profile YAML
   *   2. CDN detection — `conservative` for known strict CDNs
   *   3. Fallback — `moderate`
   */
  public static resolveThrottleProfile(
    cdnResult: CdnDetectionResult,
    profileOverride?: ThrottleProfileName | null
  ): ThrottleProfile {
    if (profileOverride && isValidThrottleProfile(profileOverride)) {
      return THROTTLE_PROFILES[profileOverride];
    }
    if (this.isStrictCdn(cdnResult)) {
      return THROTTLE_PROFILES.conservative;
    }
    return THROTTLE_PROFILES.moderate;
  }
}

export function isValidThrottleProfile(value: unknown): value is ThrottleProfileName {
  return value === 'conservative' || value === 'moderate' || value === 'aggressive';
}
