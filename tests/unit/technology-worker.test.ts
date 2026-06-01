import { describe, expect, it, vi } from 'vitest';
import { TechnologyWorker } from '../../src/engine/workers/technology-worker';

describe('TechnologyWorker', () => {
  it('maps wappalyzer-next JSON output into normalized technology entries', async () => {
    const command = '/tmp/wappalyzer-next/bin/wappalyzer';
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

    const result = await TechnologyWorker.detectTechnologyStack('https://www.cms.gov', command, mockRunner);

    expect(result).toEqual([
      { name: 'Drupal', category: 'CMS', version: '10' },
      { name: 'React', category: 'JavaScript frameworks', version: null }
    ]);
    expect(mockRunner).toHaveBeenCalledWith(
      command,
      ['--scan-type', 'full', '-oJ', '-i', 'https://www.cms.gov'],
      expect.objectContaining({ timeout: expect.any(Number), maxBuffer: expect.any(Number) })
    );
  });

  it('returns empty list if scanner command fails', async () => {
    const mockRunner = vi.fn().mockRejectedValue(new Error('command not found'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await TechnologyWorker.detectTechnologyStack('https://www.cms.gov', '/tmp/missing/wappalyzer-next', mockRunner);

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('parses valid JSON from stderr exit path when stdout is still available', async () => {
    const mockRunner = vi.fn().mockRejectedValue({
      message: 'command exited with non-zero status',
      stdout: JSON.stringify({
        'https://www.cms.gov': {
          Drupal: {
            version: '10',
            categories: ['CMS']
          }
        }
      })
    });

    const result = await TechnologyWorker.detectTechnologyStack('https://www.cms.gov', '/tmp/wappalyzer-next/bin/wappalyzer', mockRunner);

    expect(result).toEqual([{ name: 'Drupal', category: 'CMS', version: '10' }]);
  });

  it('tries file:// snapshot invocation first when htmlSnapshotPath is provided', async () => {
    const command = '/tmp/wappalyzer-next/bin/wappalyzer';
    const snapshotPath = '/tmp/snapshots/www_cms_gov.html';
    const mockRunner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        [`file://${snapshotPath}`]: {
          Drupal: { version: '10', categories: ['CMS'] }
        }
      }),
      stderr: ''
    });

    const result = await TechnologyWorker.detectTechnologyStack(
      'https://www.cms.gov',
      command,
      mockRunner,
      snapshotPath
    );

    expect(result).toEqual([{ name: 'Drupal', category: 'CMS', version: '10' }]);
    // First call must use the file:// URL, not the live URL
    expect(mockRunner).toHaveBeenNthCalledWith(
      1,
      command,
      ['--scan-type', 'full', '-oJ', '-i', `file://${snapshotPath}`],
      expect.any(Object)
    );
  });

  it('falls back to live URL when file-based snapshot invocation fails', async () => {
    const command = '/tmp/wappalyzer-next/bin/wappalyzer';
    const snapshotPath = '/tmp/snapshots/www_cms_gov.html';
    const livePayload = JSON.stringify({
      'https://www.cms.gov': { Drupal: { version: '10', categories: ['CMS'] } }
    });

    // First call (file://) throws; second call (live URL) succeeds.
    const mockRunner = vi.fn()
      .mockRejectedValueOnce(new Error('unsupported protocol'))
      .mockResolvedValueOnce({ stdout: livePayload, stderr: '' });

    const result = await TechnologyWorker.detectTechnologyStack(
      'https://www.cms.gov',
      command,
      mockRunner,
      snapshotPath
    );

    expect(result).toEqual([{ name: 'Drupal', category: 'CMS', version: '10' }]);
    expect(mockRunner).toHaveBeenCalledTimes(2);
    // Second call must be with the live URL
    expect(mockRunner).toHaveBeenNthCalledWith(
      2,
      command,
      ['--scan-type', 'full', '-oJ', '-i', 'https://www.cms.gov'],
      expect.any(Object)
    );
  });
});
