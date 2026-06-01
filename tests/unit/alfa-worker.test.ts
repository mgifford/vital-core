import { describe, expect, it, vi } from 'vitest';
import { AlfaWorker } from '../../src/engine/workers/alfa-worker';

describe('AlfaWorker', () => {
  it('captures raw Alfa JSON payload and estimates findings count', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        outcomes: [
          { rule: 'r-1', message: 'Issue 1' },
          { rule: 'r-2', message: 'Issue 2' }
        ]
      }),
      stderr: ''
    });

    const result = await AlfaWorker.runAlfaAudits('https://www.cms.gov', 'alfa', runner);

    expect(result.executed).toBe(true);
    expect(result.findingsCount).toBe(2);
    expect(result.errorMessage).toBeNull();
    expect(result.rawResults).toMatchObject({ outcomes: expect.any(Array) });
  });

  it('parses JSON payload even when CLI logs text before the payload', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: 'Alfa CLI v1.2.3\n{"results":[{"id":"rule-1"}]}' ,
      stderr: ''
    });

    const result = await AlfaWorker.runAlfaAudits('https://www.hhs.gov', 'alfa', runner);

    expect(result.executed).toBe(true);
    expect(result.findingsCount).toBe(1);
    expect(result.errorMessage).toBeNull();
  });

  it('returns a non-fatal skipped state when Alfa command fails', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('command not found'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await AlfaWorker.runAlfaAudits('https://www.cms.gov', 'alfa', runner);

    expect(result.executed).toBe(false);
    expect(result.findingsCount).toBeNull();
    expect(result.rawResults).toBeNull();
    expect(result.errorMessage).toContain('skipped');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('audits local snapshot via file:// URL when htmlSnapshotPath is provided', async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ outcomes: [{ rule: 'r-1', message: 'Issue 1' }] }),
      stderr: ''
    });

    const result = await AlfaWorker.runAlfaAudits(
      'https://www.cms.gov',
      'alfa',
      runner,
      '/tmp/snapshots/www_cms_gov.html'
    );

    expect(result.executed).toBe(true);
    expect(result.findingsCount).toBe(1);
    // Runner must receive the file:// URL, not the live https:// URL
    expect(runner).toHaveBeenCalledWith(
      'alfa',
      expect.arrayContaining(['file:///tmp/snapshots/www_cms_gov.html']),
      expect.any(Object)
    );
    expect(runner).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(['https://www.cms.gov']),
      expect.any(Object)
    );
  });
});