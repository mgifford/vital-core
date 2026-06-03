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

  describe('toA11yViolations', () => {
    it('returns empty array for a non-executed audit', () => {
      const audit = { executed: false, findingsCount: null, errorMessage: 'skip', rawResults: null };
      expect(AlfaWorker.toA11yViolations(audit)).toEqual([]);
    });

    it('converts outcomes grouped by rule ID into A11yViolation[]', () => {
      const audit = {
        executed: true,
        findingsCount: 3,
        errorMessage: null,
        rawResults: {
          outcomes: [
            {
              rule: 'sia-r10',
              title: 'Button has accessible name',
              description: 'Buttons must have an accessible name.',
              severity: 'serious',
              html: '<button></button>',
              target: ['button'],
              failureSummary: 'Add aria-label or visible text.',
              helpUrl: 'https://alfa.siteimprove.com/rules/sia-r10',
              wcag: ['wcag21aa']
            },
            {
              rule: 'sia-r10',
              title: 'Button has accessible name',
              description: 'Buttons must have an accessible name.',
              severity: 'serious',
              html: '<button class="icon"></button>',
              target: ['button.icon'],
              failureSummary: 'Add aria-label.',
              helpUrl: 'https://alfa.siteimprove.com/rules/sia-r10',
              wcag: ['wcag21aa']
            },
            {
              rule: 'sia-r62',
              title: 'Image has alt text',
              description: 'Images must have alt text.',
              severity: 'critical',
              html: '<img src="logo.png">',
              target: ['img'],
              failureSummary: 'Add an alt attribute.',
              helpUrl: 'https://alfa.siteimprove.com/rules/sia-r62',
              wcag: ['wcag2aa']
            }
          ]
        }
      };

      const violations = AlfaWorker.toA11yViolations(audit);

      expect(violations).toHaveLength(2);
      expect(violations.every(v => v.sourceEngine === 'alfa')).toBe(true);

      const r10 = violations.find(v => v.id === 'sia-r10');
      expect(r10).toBeDefined();
      expect(r10!.severity).toBe('serious');
      expect(r10!.instances).toHaveLength(2);
      expect(r10!.wcagVersion).toBe('2.1');
      expect(r10!.helpUrl).toBe('https://alfa.siteimprove.com/rules/sia-r10');

      const r62 = violations.find(v => v.id === 'sia-r62');
      expect(r62).toBeDefined();
      expect(r62!.severity).toBe('critical');
      expect(r62!.instances).toHaveLength(1);
      expect(r62!.wcagVersion).toBe('2.0');
    });

    it('falls back to a constructed Siteimprove URL when helpUrl is missing', () => {
      const audit = {
        executed: true,
        findingsCount: 1,
        errorMessage: null,
        rawResults: [{ rule: 'sia-r5', severity: 'moderate', html: '<div/>', target: [] }]
      };

      const violations = AlfaWorker.toA11yViolations(audit);
      expect(violations).toHaveLength(1);
      expect(violations[0].helpUrl).toBe('https://alfa.siteimprove.com/rules/sia-r5');
    });

    it('skips outcomes with no rule ID', () => {
      const audit = {
        executed: true,
        findingsCount: 2,
        errorMessage: null,
        rawResults: [
          { rule: 'sia-r1', severity: 'minor', html: '', target: [] },
          { severity: 'minor', html: '', target: [] } // no rule ID — should be skipped
        ]
      };

      const violations = AlfaWorker.toA11yViolations(audit);
      expect(violations).toHaveLength(1);
      expect(violations[0].id).toBe('sia-r1');
    });

    it('extracts rule id and help URL when Alfa returns nested rule objects', () => {
      const audit = {
        executed: true,
        findingsCount: 1,
        errorMessage: null,
        rawResults: {
          outcomes: [
            {
              rule: {
                id: 'sia-r73',
                uri: 'https://alfa.siteimprove.com/rules/sia-r73'
              },
              severity: 'moderate',
              description: { value: 'ARIA role must be valid.' },
              target: { value: '#main' },
              failureSummary: { value: 'Use a valid ARIA role.' },
              html: '<main id="main"></main>',
              wcag: ['best-practice']
            }
          ]
        }
      };

      const violations = AlfaWorker.toA11yViolations(audit);

      expect(violations).toHaveLength(1);
      expect(violations[0].id).toBe('sia-r73');
      expect(violations[0].helpUrl).toBe('https://alfa.siteimprove.com/rules/sia-r73');
      expect(violations[0].description).toBe('ARIA role must be valid.');
      expect(violations[0].instances[0].target).toEqual(['#main']);
      expect(violations[0].instances[0].failureSummary).toBe('Use a valid ARIA role.');
    });
  });
});