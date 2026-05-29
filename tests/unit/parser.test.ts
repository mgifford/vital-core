import { describe, expect, it } from 'vitest';
import { ProfileParser } from '../../src/engine/parser';

describe('ProfileParser', () => {
  it('loads the documented US Health profile', () => {
    const profile = ProfileParser.loadProfile('profiles/us-health.yml');

    expect(profile.profile).toBe('US Health');
    expect(profile.targets.length).toBeGreaterThan(0);
  });

  it('throws a clear error when the profile file is missing', () => {
    expect(() => ProfileParser.loadProfile('profiles/does-not-exist.yml')).toThrow(
      /Profile configuration file not found/
    );
  });
});
