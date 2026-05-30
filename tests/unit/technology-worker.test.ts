import { describe, expect, it, vi } from 'vitest';
import { TechnologyWorker } from '../../src/engine/workers/technology-worker';

describe('TechnologyWorker', () => {
  it('maps wappalyzer-next JSON output into normalized technology entries', async () => {
    const mockRunner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        'https://www.cms.gov': {
          Drupal: {
            version: '10',
            categories: ['CMS']
          },
          React: {
            version: '',
            categories: ['JavaScript frameworks']
          }
        }
      }),
      stderr: ''
    });

    const result = await TechnologyWorker.detectTechnologyStack('https://www.cms.gov', 'wappalyzer', mockRunner);

    expect(result).toEqual([
      { name: 'Drupal', category: 'CMS', version: '10' },
      { name: 'React', category: 'JavaScript frameworks', version: null }
    ]);
    expect(mockRunner).toHaveBeenCalledWith(
      'wappalyzer',
      ['-i', 'https://www.cms.gov', '--scan-type', 'balanced', '-oJ', '-'],
      expect.objectContaining({ timeout: expect.any(Number), maxBuffer: expect.any(Number) })
    );
  });

  it('returns empty list if scanner command fails', async () => {
    const mockRunner = vi.fn().mockRejectedValue(new Error('command not found'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await TechnologyWorker.detectTechnologyStack('https://www.cms.gov', 'wappalyzer', mockRunner);

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });
});
