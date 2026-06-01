import { describe, expect, it } from 'vitest';
import {
  CdnDetector,
  THROTTLE_PROFILES,
  isValidThrottleProfile
} from '../../src/engine/cdn-detection';

describe('CdnDetector.detect', () => {
  it('detects Cloudflare from cf-ray header', () => {
    const result = CdnDetector.detect({ 'cf-ray': '8abc123def-IAD' });
    expect(result.provider).toBe('cloudflare');
    expect(result.detectedHeaders).toContain('cf-ray');
  });

  it('detects Cloudflare with HIGH confidence when multiple matching headers present', () => {
    const result = CdnDetector.detect({
      'cf-ray': '8abc',
      'cf-cache-status': 'HIT'
    });
    expect(result.provider).toBe('cloudflare');
    expect(result.confidence).toBe('HIGH');
    expect(result.detectedHeaders).toHaveLength(2);
  });

  it('detects Akamai from x-akamai-request-id header', () => {
    const result = CdnDetector.detect({ 'x-akamai-request-id': 'r123' });
    expect(result.provider).toBe('akamai');
  });

  it('detects Fastly from x-fastly-request-id header', () => {
    const result = CdnDetector.detect({ 'x-fastly-request-id': 'f123' });
    expect(result.provider).toBe('fastly');
  });

  it('detects AWS CloudFront from x-amz-cf-id header', () => {
    const result = CdnDetector.detect({ 'x-amz-cf-id': 'cf-abc' });
    expect(result.provider).toBe('awscloudfront');
  });

  it('detects Azure from x-azure-ref header', () => {
    const result = CdnDetector.detect({ 'x-azure-ref': 'az-ref-123' });
    expect(result.provider).toBe('azure');
  });

  it('detects Imperva from x-iinfo header', () => {
    const result = CdnDetector.detect({ 'x-iinfo': 'imperva-info' });
    expect(result.provider).toBe('imperva');
  });

  it('returns null provider for empty headers', () => {
    const result = CdnDetector.detect({});
    expect(result.provider).toBeNull();
    expect(result.confidence).toBe('LOW');
    expect(result.detectedHeaders).toHaveLength(0);
  });

  it('returns null provider when no known CDN headers are present', () => {
    const result = CdnDetector.detect({
      'content-type': 'text/html',
      'x-custom-header': 'value'
    });
    expect(result.provider).toBeNull();
  });

  it('matches headers case-insensitively', () => {
    const result = CdnDetector.detect({ 'CF-Ray': '8abc123' });
    expect(result.provider).toBe('cloudflare');
  });

  it('prioritises the first matching CDN pattern (Cloudflare before Akamai)', () => {
    // When both Cloudflare and Akamai headers are present, Cloudflare wins
    // because it appears first in CDN_HEADER_PATTERNS.
    const result = CdnDetector.detect({
      'cf-ray': 'cf-value',
      'x-akamai-request-id': 'ak-value'
    });
    expect(result.provider).toBe('cloudflare');
  });
});

describe('CdnDetector.isStrictCdn', () => {
  it('returns true for cloudflare', () => {
    expect(CdnDetector.isStrictCdn({ provider: 'cloudflare', confidence: 'HIGH', detectedHeaders: [] })).toBe(true);
  });

  it('returns true for akamai', () => {
    expect(CdnDetector.isStrictCdn({ provider: 'akamai', confidence: 'HIGH', detectedHeaders: [] })).toBe(true);
  });

  it('returns true for imperva', () => {
    expect(CdnDetector.isStrictCdn({ provider: 'imperva', confidence: 'HIGH', detectedHeaders: [] })).toBe(true);
  });

  it('returns false for fastly', () => {
    expect(CdnDetector.isStrictCdn({ provider: 'fastly', confidence: 'HIGH', detectedHeaders: [] })).toBe(false);
  });

  it('returns false for awscloudfront', () => {
    expect(CdnDetector.isStrictCdn({ provider: 'awscloudfront', confidence: 'HIGH', detectedHeaders: [] })).toBe(false);
  });

  it('returns false for azure', () => {
    expect(CdnDetector.isStrictCdn({ provider: 'azure', confidence: 'HIGH', detectedHeaders: [] })).toBe(false);
  });

  it('returns false when provider is null', () => {
    expect(CdnDetector.isStrictCdn({ provider: null, confidence: 'LOW', detectedHeaders: [] })).toBe(false);
  });
});

describe('CdnDetector.resolveThrottleProfile', () => {
  const noProvider = { provider: null as null, confidence: 'LOW' as const, detectedHeaders: [] };
  const cloudflare = { provider: 'cloudflare' as const, confidence: 'HIGH' as const, detectedHeaders: ['cf-ray'] };
  const fastly    = { provider: 'fastly' as const,     confidence: 'HIGH' as const, detectedHeaders: ['x-fastly-request-id'] };

  it('returns conservative profile for a strict CDN with no override', () => {
    const profile = CdnDetector.resolveThrottleProfile(cloudflare);
    expect(profile).toBe(THROTTLE_PROFILES.conservative);
    expect(profile.sameSiteDelayMs).toBe(3000);
  });

  it('returns moderate profile when no CDN detected and no override', () => {
    const profile = CdnDetector.resolveThrottleProfile(noProvider);
    expect(profile).toBe(THROTTLE_PROFILES.moderate);
  });

  it('respects explicit override over CDN detection', () => {
    // Even for Cloudflare, if the target says aggressive, use aggressive
    const profile = CdnDetector.resolveThrottleProfile(cloudflare, 'aggressive');
    expect(profile).toBe(THROTTLE_PROFILES.aggressive);
  });

  it('returns moderate for non-strict CDN with no override', () => {
    const profile = CdnDetector.resolveThrottleProfile(fastly);
    expect(profile).toBe(THROTTLE_PROFILES.moderate);
  });

  it('respects conservative override even with no CDN', () => {
    const profile = CdnDetector.resolveThrottleProfile(noProvider, 'conservative');
    expect(profile).toBe(THROTTLE_PROFILES.conservative);
  });

  it('ignores a null override (falls back to CDN detection)', () => {
    const profile = CdnDetector.resolveThrottleProfile(cloudflare, null);
    expect(profile).toBe(THROTTLE_PROFILES.conservative);
  });
});

describe('THROTTLE_PROFILES constants', () => {
  it('conservative profile has larger delay than moderate', () => {
    expect(THROTTLE_PROFILES.conservative.sameSiteDelayMs).toBeGreaterThan(
      THROTTLE_PROFILES.moderate.sameSiteDelayMs
    );
  });

  it('moderate profile has larger delay than aggressive', () => {
    expect(THROTTLE_PROFILES.moderate.sameSiteDelayMs).toBeGreaterThan(
      THROTTLE_PROFILES.aggressive.sameSiteDelayMs
    );
  });
});

describe('isValidThrottleProfile', () => {
  it('accepts valid profile names', () => {
    expect(isValidThrottleProfile('conservative')).toBe(true);
    expect(isValidThrottleProfile('moderate')).toBe(true);
    expect(isValidThrottleProfile('aggressive')).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(isValidThrottleProfile('fast')).toBe(false);
    expect(isValidThrottleProfile('')).toBe(false);
    expect(isValidThrottleProfile(null)).toBe(false);
    expect(isValidThrottleProfile(undefined)).toBe(false);
    expect(isValidThrottleProfile(42)).toBe(false);
  });
});
