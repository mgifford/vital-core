import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqlitePersister } from '../../src/engine/reporters/sqlite-persister';
import type { TargetScanResult } from '../../src/types/site-quality-spec';

const originalCwd = process.cwd();

function makeRunEntry(runId = 'test-run-001') {
  return {
    runId,
    generatedAt: new Date().toISOString(),
    profilePath: 'profiles/test.yml',
    scanDurationMs: 1200,
    targetsScanned: 2,
    pagesScanned: 3,
    totalViolations: 4,
    qualityIndexScore: 72.5,
    qualityGateStatus: 'WARNING',
    consensusFailure: 1,
    alfaOnlyFailure: 1,
    axeOnlyFailure: 2
  };
}

function makeResult(targetId: string, violations: number, status: 'COMPLETED' | 'TIMEOUT' | 'SKIPPED_UNCHANGED' = 'COMPLETED'): TargetScanResult {
  return {
    targetId,
    domain: `https://${targetId}.example.org`,
    scanDurationMs: 800,
    pagesScanned: [
      {
        url: `https://${targetId}.example.org/page`,
        timestamp: new Date().toISOString(),
        status,
        errorMessage: null,
        technologyStack: [
          { name: 'WordPress', category: 'CMS', version: '6.4' },
          { name: 'jQuery', category: 'JavaScript Framework', version: '3.7' }
        ],
        liveAudits: {
          lighthouse: { performanceScore: 88, energyEstimateKwh: null },
          accessibilityViolations: Array.from({ length: violations }).map((_, i) => ({
            id: `rule-${i}`,
            severity: 'serious' as const,
            description: `Description for rule ${i}`,
            helpUrl: 'https://example.org/help',
            impactedCriteria: ['wcag2aa'],
            instances: [
              {
                html: `<div id="fail-${i}"></div>`,
                target: [`#fail-${i}`],
                failureSummary: `Fix rule ${i}`
              }
            ]
          }))
        },
        offlineAudits: {
          overlayDetected: { found: false, provider: null, evidence: null },
          designSystem: { usesUSWDS: false, versionDetected: null },
          contentMetrics: {
            readabilityScore: 65,
            fleschKincaidGrade: 8.2,
            suspiciousAltTextCount: 0,
            suspiciousAltInstances: []
          },
          linkHealth: { totalChecked: 5, brokenCount: 0, brokenLinks: [] }
        }
      }
    ]
  };
}

afterEach(() => {
  process.chdir(originalCwd);
});

describe('SqlitePersister', () => {
  it('creates vital.db in dist/ with all four tables', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-persister-schema-'));
    process.chdir(tmpDir);

    SqlitePersister.appendRun([makeResult('alpha', 1)], makeRunEntry());

    const dbPath = path.join(tmpDir, 'dist', 'vital.db');
    expect(fs.existsSync(dbPath)).toBe(true);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: Record<string, unknown>) => r.name);
    db.close();

    expect(tables).toContain('runs');
    expect(tables).toContain('pages');
    expect(tables).toContain('violations');
    expect(tables).toContain('url_history');
  });

  it('inserts a run, pages, violations, and url_history rows', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-persister-insert-'));
    process.chdir(tmpDir);

    const runEntry = makeRunEntry('run-insert-test');
    const results = [makeResult('alpha', 2), makeResult('beta', 1)];
    SqlitePersister.appendRun(results, runEntry);

    const db = new DatabaseSync(path.join(tmpDir, 'dist', 'vital.db'), { readOnly: true });

    const run = db.prepare('SELECT * FROM runs WHERE run_id = ?').get('run-insert-test') as Record<string, unknown>;
    expect(run).toBeDefined();
    expect(run['total_violations']).toBe(4);
    expect(run['quality_index_score']).toBeCloseTo(72.5, 1);
    expect(run['quality_gate_status']).toBe('WARNING');

    const pages = db.prepare('SELECT * FROM pages WHERE run_id = ?').all('run-insert-test') as Record<string, unknown>[];
    expect(pages.length).toBe(2);
    expect(pages.every(p => typeof p['id'] === 'number')).toBe(true);

    const alphaPage = pages.find(p => p['target_id'] === 'alpha');
    expect(alphaPage).toBeDefined();
    expect(alphaPage!['violation_count']).toBe(2);
    expect(alphaPage!['lighthouse_score']).toBeCloseTo(88, 0);
    expect(alphaPage!['plain_language_grade']).toBeCloseTo(8.2, 1);

    const betaPage = pages.find(p => p['target_id'] === 'beta');
    expect(betaPage!['violation_count']).toBe(1);

    const alphaViolations = db
      .prepare('SELECT * FROM violations WHERE page_id = ?')
      .all(alphaPage!['id'] as number) as Record<string, unknown>[];
    expect(alphaViolations.length).toBe(2);
    expect(alphaViolations[0]!['rule_id']).toBe('rule-0');
    expect(alphaViolations[0]!['impact']).toBe('serious');
    expect(alphaViolations[0]!['provider']).toBe('axe');
    expect(alphaViolations[0]!['selector']).toBe('#fail-0');

    const urlHistoryRows = db.prepare('SELECT * FROM url_history WHERE target_id = ?').all('alpha') as Record<string, unknown>[];
    expect(urlHistoryRows.length).toBe(1);
    expect(urlHistoryRows[0]!['last_status']).toBe('COMPLETED');
    expect(typeof urlHistoryRows[0]!['last_success_at']).toBe('string');

    db.close();
  });

  it('stores technologies as a JSON array string', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-persister-tech-'));
    process.chdir(tmpDir);

    SqlitePersister.appendRun([makeResult('alpha', 0)], makeRunEntry('run-tech'));

    const db = new DatabaseSync(path.join(tmpDir, 'dist', 'vital.db'), { readOnly: true });
    const page = db.prepare('SELECT technologies FROM pages WHERE target_id = ?').get('alpha') as Record<string, unknown>;
    db.close();

    expect(page).toBeDefined();
    const parsed = JSON.parse(page['technologies'] as string) as string[];
    expect(parsed).toContain('WordPress');
    expect(parsed).toContain('jQuery');
  });

  it('url_history preserves first_seen_at and updates last_success_at on re-insert', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-persister-history-'));
    process.chdir(tmpDir);

    const firstAt = new Date(Date.now() - 86_400_000).toISOString(); // yesterday
    const firstResult = makeResult('alpha', 0);
    firstResult.pagesScanned[0].timestamp = firstAt;

    SqlitePersister.appendRun([firstResult], makeRunEntry('run-first'));

    const laterAt = new Date().toISOString();
    const laterResult = makeResult('alpha', 0);
    laterResult.pagesScanned[0].timestamp = laterAt;
    SqlitePersister.appendRun([laterResult], makeRunEntry('run-later'));

    const db = new DatabaseSync(path.join(tmpDir, 'dist', 'vital.db'), { readOnly: true });
    const row = db
      .prepare('SELECT * FROM url_history WHERE url = ? AND target_id = ?')
      .get('https://alpha.example.org/page', 'alpha') as Record<string, unknown>;
    db.close();

    expect(row['first_seen_at']).toBe(firstAt);
    expect(row['last_success_at']).toBe(laterAt);
    expect(row['last_status']).toBe('COMPLETED');
  });

  it('url_history does not overwrite last_success_at on a TIMEOUT', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-persister-timeout-'));
    process.chdir(tmpDir);

    const successAt = new Date(Date.now() - 3_600_000).toISOString();
    const successResult = makeResult('alpha', 0, 'COMPLETED');
    successResult.pagesScanned[0].timestamp = successAt;
    SqlitePersister.appendRun([successResult], makeRunEntry('run-success'));

    const timeoutResult = makeResult('alpha', 0, 'TIMEOUT');
    timeoutResult.pagesScanned[0].timestamp = new Date().toISOString();
    SqlitePersister.appendRun([timeoutResult], makeRunEntry('run-timeout'));

    const db = new DatabaseSync(path.join(tmpDir, 'dist', 'vital.db'), { readOnly: true });
    const row = db
      .prepare('SELECT * FROM url_history WHERE url = ? AND target_id = ?')
      .get('https://alpha.example.org/page', 'alpha') as Record<string, unknown>;
    db.close();

    expect(row['last_success_at']).toBe(successAt);
    expect(row['last_status']).toBe('TIMEOUT');
  });

  it('appendRun is idempotent for the same run_id (INSERT OR REPLACE)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-persister-idempotent-'));
    process.chdir(tmpDir);

    const entry = makeRunEntry('run-idempotent');
    SqlitePersister.appendRun([makeResult('alpha', 1)], entry);

    const modifiedEntry = { ...entry, totalViolations: 99 };
    SqlitePersister.appendRun([makeResult('alpha', 1)], modifiedEntry);

    const db = new DatabaseSync(path.join(tmpDir, 'dist', 'vital.db'), { readOnly: true });
    const runs = db.prepare('SELECT * FROM runs WHERE run_id = ?').all('run-idempotent') as Record<string, unknown>[];
    db.close();

    expect(runs.length).toBe(1);
    expect(runs[0]!['total_violations']).toBe(99);
  });

  it('does not throw when dist/ does not yet exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-persister-nodist-'));
    process.chdir(tmpDir);

    expect(() => {
      SqlitePersister.appendRun([makeResult('alpha', 0)], makeRunEntry());
    }).not.toThrow();

    expect(fs.existsSync(path.join(tmpDir, 'dist', 'vital.db'))).toBe(true);
  });

  it('restoreCachedDb copies vital.db from cache when dist/ copy is absent', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-persister-restore-'));
    process.chdir(tmpDir);

    const cacheDir = path.join(tmpDir, '.history-cache');
    fs.mkdirSync(cacheDir, { recursive: true });

    // Write a small dummy database into the cache
    const seedDb = new DatabaseSync(path.join(cacheDir, 'vital.db'));
    seedDb.exec('CREATE TABLE seed (x INTEGER)');
    seedDb.close();

    SqlitePersister.restoreCachedDb('.history-cache');

    const destPath = path.join(tmpDir, 'dist', 'vital.db');
    expect(fs.existsSync(destPath)).toBe(true);

    // Verify the restored file is a valid SQLite database
    const restored = new DatabaseSync(destPath, { readOnly: true });
    const tables = restored
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: Record<string, unknown>) => r.name);
    restored.close();
    expect(tables).toContain('seed');
  });

  it('restoreCachedDb does not overwrite an existing vital.db', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-persister-no-overwrite-'));
    process.chdir(tmpDir);

    // Create an existing dist/vital.db with data
    const distDir = path.join(tmpDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    SqlitePersister.appendRun([makeResult('alpha', 1)], makeRunEntry('existing-run'));

    // Create a cache db
    const cacheDir = path.join(tmpDir, '.history-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const seedDb = new DatabaseSync(path.join(cacheDir, 'vital.db'));
    seedDb.exec('CREATE TABLE cache_only (x INTEGER)');
    seedDb.close();

    SqlitePersister.restoreCachedDb('.history-cache');

    // The existing db should not be replaced — it should still have the 'runs' table, not 'cache_only'
    const db = new DatabaseSync(path.join(tmpDir, 'dist', 'vital.db'), { readOnly: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: Record<string, unknown>) => r.name);
    db.close();

    expect(tables).toContain('runs');
    expect(tables).not.toContain('cache_only');
  });
});
