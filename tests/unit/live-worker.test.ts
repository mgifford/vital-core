import { describe, expect, it } from 'vitest';
import { LiveWorker } from '../../src/engine/workers/live-worker';

describe('LiveWorker.classifyWcagVersion', () => {
  it('returns "2.2" when tags include a wcag22 prefix', () => {
    expect(LiveWorker.classifyWcagVersion(['wcag22aa', 'wcag21aa'])).toBe('2.2');
  });

  it('returns "2.1" when tags include wcag21 but no wcag22', () => {
    expect(LiveWorker.classifyWcagVersion(['wcag21aa', 'wcag2aa'])).toBe('2.1');
  });

  it('returns "2.0" for wcag2a tags', () => {
    expect(LiveWorker.classifyWcagVersion(['wcag2a', 'best-practice'])).toBe('2.0');
  });

  it('returns "2.0" for wcag2aa tags', () => {
    expect(LiveWorker.classifyWcagVersion(['wcag2aa'])).toBe('2.0');
  });

  it('returns "2.0" for wcag2aaa tags', () => {
    expect(LiveWorker.classifyWcagVersion(['wcag2aaa'])).toBe('2.0');
  });

  it('returns "section508" when tags include a 508 reference and no wcag tags', () => {
    expect(LiveWorker.classifyWcagVersion(['section508'])).toBe('section508');
  });

  it('returns "best-practice" when no known tags are present', () => {
    expect(LiveWorker.classifyWcagVersion(['best-practice', 'cat.color'])).toBe('best-practice');
  });

  it('returns "best-practice" for an empty tag array', () => {
    expect(LiveWorker.classifyWcagVersion([])).toBe('best-practice');
  });

  it('is case-insensitive for WCAG tag matching', () => {
    expect(LiveWorker.classifyWcagVersion(['WCAG22AA'])).toBe('2.2');
    expect(LiveWorker.classifyWcagVersion(['WCAG21AA'])).toBe('2.1');
    expect(LiveWorker.classifyWcagVersion(['WCAG2AA'])).toBe('2.0');
  });
});
