import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

describe('fetch-history script', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('skips cleanly without installed dependencies when no base URL is configured', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-history-script-'));
    tempDirs.push(tempDir);

    const sourcePath = path.resolve(process.cwd(), 'scripts', 'fetch-history.mjs');
    const copiedScriptPath = path.join(tempDir, 'fetch-history.mjs');
    fs.copyFileSync(sourcePath, copiedScriptPath);

    const result = spawnSync(process.execPath, [copiedScriptPath], {
      cwd: tempDir,
      encoding: 'utf8',
      env: { ...process.env, VITAL_PAGES_BASE_URL: '' }
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Skipping history fetch: VITAL_PAGES_BASE_URL is not set.');
  });
});
