import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrioritySeedStore } from '../../src/engine/priority-seeds';
import { TargetConfig } from '../../src/types/profile';

describe('PrioritySeedStore', () => {
  const originalCwd = process.cwd();
  let tempDir = '';

  const baseTarget: TargetConfig = {
    id: 'cms-gov',
    name: 'CMS',
    base_url: 'https://www.cms.gov',
    sitemap_url: 'https://www.cms.gov/sitemap.xml',
    include_paths: ['/*'],
    priority_urls: [],
    settings: {
      postLoadDelay: 2000,
      max_pages: 10,
      maxTimeoutMs: 120000,
      include_subdomains: false,
      sitemap_template_sample_cap: 5,
      sitemap_sample_stochastic: true,
      unique_page_focus: false
    }
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'priority-seeds-'));
    process.chdir(tempDir);
    PrioritySeedStore.setActiveSnapshotForTesting(null);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    PrioritySeedStore.setActiveSnapshotForTesting(null);
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('keeps target entries even when DuckDuckGo yields no result links', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '<html><body>About 12,345 results but no anchors</body></html>'
      })
    );

    const result = await PrioritySeedStore.initialize([baseTarget], {
      forceRefresh: true,
      maxAgeDays: 1,
      perTargetLimit: 12
    });

    expect(result.targetCount).toBe(1);

    const snapshotPath = path.join(tempDir, 'dist', 'runs', 'top-task-seeds.json');
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as {
      targets: Array<{ targetId: string; estimatedIndexedPages: number | null; topUrls: string[] }>;
    };

    expect(snapshot.targets).toHaveLength(1);
    expect(snapshot.targets[0]).toMatchObject({
      targetId: 'cms-gov',
      estimatedIndexedPages: 12345,
      topUrls: []
    });
  });

  it('keeps target entries when DuckDuckGo request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => '<html></html>'
      })
    );

    const result = await PrioritySeedStore.initialize([baseTarget], {
      forceRefresh: true,
      maxAgeDays: 1,
      perTargetLimit: 12
    });

    expect(result.targetCount).toBe(1);

    const snapshotPath = path.join(tempDir, 'dist', 'runs', 'top-task-seeds.json');
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as {
      targets: Array<{ targetId: string; estimatedIndexedPages: number | null; topUrls: string[] }>;
    };

    expect(snapshot.targets).toHaveLength(1);
    expect(snapshot.targets[0]).toMatchObject({
      targetId: 'cms-gov',
      estimatedIndexedPages: null,
      topUrls: []
    });
  });
});
