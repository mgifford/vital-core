import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import type { TargetScanResult } from '../../types/site-quality-spec';

export interface SqliteRunEntry {
  runId: string;
  generatedAt: string;
  profilePath: string;
  scanDurationMs: number;
  targetsScanned: number;
  pagesScanned: number;
  totalViolations: number;
  qualityIndexScore: number;
  qualityGateStatus: string;
  consensusFailure: number;
  alfaOnlyFailure: number;
  axeOnlyFailure: number;
}

/**
 * Persists scan results to a SQLite database at `dist/vital.db`.
 *
 * The database is additive — all existing JSON output files are preserved.
 * It enables ad-hoc queries that the JSON files cannot support, such as:
 *
 * - Violations detected in the last 7 days:
 *   SELECT v.rule_id, v.impact, p.url, p.scanned_at
 *   FROM violations v JOIN pages p ON v.page_id = p.id
 *   WHERE p.scanned_at > datetime('now', '-7 days')
 *   ORDER BY p.scanned_at DESC;
 *
 * - Errors newly appearing on a URL (first scan that recorded them):
 *   SELECT v.rule_id, p.url, MIN(p.scanned_at) AS first_seen
 *   FROM violations v JOIN pages p ON v.page_id = p.id
 *   GROUP BY v.rule_id, p.url
 *   ORDER BY first_seen DESC;
 *
 * - Technology stack pivot:
 *   SELECT t.value AS tech, COUNT(DISTINCT p.url) AS page_count
 *   FROM pages p, json_each(p.technologies) t
 *   GROUP BY tech ORDER BY page_count DESC;
 *
 * Uses the built-in `node:sqlite` module (Node.js ≥ 22.5) — no extra dependencies.
 */
export class SqlitePersister {
  private static get dbPath(): string {
    return path.resolve(process.cwd(), 'dist', 'vital.db');
  }

  private static initSchema(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id              TEXT PRIMARY KEY,
        generated_at        TEXT NOT NULL,
        profile_path        TEXT NOT NULL,
        scan_duration_ms    INTEGER NOT NULL,
        targets_scanned     INTEGER NOT NULL,
        pages_scanned       INTEGER NOT NULL,
        total_violations    INTEGER NOT NULL,
        quality_index_score REAL    NOT NULL DEFAULT 0,
        quality_gate_status TEXT    NOT NULL DEFAULT 'WARNING',
        consensus_failure   INTEGER NOT NULL DEFAULT 0,
        alfa_only_failure   INTEGER NOT NULL DEFAULT 0,
        axe_only_failure    INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS pages (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id              TEXT    NOT NULL REFERENCES runs(run_id),
        target_id           TEXT    NOT NULL,
        domain              TEXT    NOT NULL,
        url                 TEXT    NOT NULL,
        status              TEXT    NOT NULL,
        scanned_at          TEXT    NOT NULL,
        violation_count     INTEGER NOT NULL DEFAULT 0,
        lighthouse_score    REAL,
        plain_language_grade REAL,
        technologies        TEXT
      );

      CREATE TABLE IF NOT EXISTS violations (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        page_id   INTEGER NOT NULL REFERENCES pages(id),
        rule_id   TEXT    NOT NULL,
        impact    TEXT    NOT NULL,
        message   TEXT    NOT NULL,
        selector  TEXT,
        provider  TEXT
      );

      CREATE TABLE IF NOT EXISTS url_history (
        url                  TEXT NOT NULL,
        target_id            TEXT NOT NULL,
        first_seen_at        TEXT NOT NULL,
        last_success_at      TEXT,
        last_status          TEXT,
        PRIMARY KEY (url, target_id)
      );

      CREATE INDEX IF NOT EXISTS idx_pages_run_id     ON pages(run_id);
      CREATE INDEX IF NOT EXISTS idx_pages_scanned_at ON pages(scanned_at);
      CREATE INDEX IF NOT EXISTS idx_pages_url        ON pages(url);
      CREATE INDEX IF NOT EXISTS idx_pages_target_id  ON pages(target_id);
      CREATE INDEX IF NOT EXISTS idx_violations_page_id ON violations(page_id);
      CREATE INDEX IF NOT EXISTS idx_violations_rule_id ON violations(rule_id);
      CREATE INDEX IF NOT EXISTS idx_url_history_target ON url_history(target_id);
    `);
  }

  /**
   * Appends one run's data to `dist/vital.db`, creating the database and schema
   * if they do not yet exist.
   *
   * Wrapped in a single transaction so a partial failure leaves the database
   * consistent.  Never throws — errors are logged as warnings so that SQLite
   * failures cannot break the existing JSON output pipeline.
   */
  public static appendRun(allResults: TargetScanResult[], runEntry: SqliteRunEntry): void {
    try {
      const distDir = path.resolve(process.cwd(), 'dist');
      if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
      }

      const db = new DatabaseSync(this.dbPath);
      try {
        this.initSchema(db);
        this.insertRunData(db, allResults, runEntry);
      } finally {
        db.close();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  SQLite persistence skipped: ${msg}`);
    }
  }

  /**
   * Copies `vital.db` from the history cache into `dist/` if the file is
   * present in the cache and does not already exist at the destination.
   *
   * Called from `RunHistoryReporter.restoreCachedHistory()` to carry forward
   * historical scan data across CI pipeline runs, mirroring the pattern used
   * for the JSON run artifacts.
   */
  public static restoreCachedDb(historyCacheDir: string): void {
    const cachedDbPath = path.resolve(process.cwd(), historyCacheDir, 'vital.db');
    if (!fs.existsSync(cachedDbPath)) {
      return;
    }

    if (fs.existsSync(this.dbPath)) {
      return;
    }

    const distDir = path.dirname(this.dbPath);
    if (!fs.existsSync(distDir)) {
      fs.mkdirSync(distDir, { recursive: true });
    }

    fs.copyFileSync(cachedDbPath, this.dbPath);
    console.log('📦 Restored historical vital.db from cache.');
  }

  private static insertRunData(
    db: DatabaseSync,
    allResults: TargetScanResult[],
    runEntry: SqliteRunEntry
  ): void {
    const insertRun = db.prepare(`
      INSERT OR REPLACE INTO runs (
        run_id, generated_at, profile_path, scan_duration_ms,
        targets_scanned, pages_scanned, total_violations,
        quality_index_score, quality_gate_status,
        consensus_failure, alfa_only_failure, axe_only_failure
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertPage = db.prepare(`
      INSERT INTO pages (
        run_id, target_id, domain, url, status, scanned_at,
        violation_count, lighthouse_score, plain_language_grade, technologies
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertViolation = db.prepare(`
      INSERT INTO violations (page_id, rule_id, impact, message, selector, provider)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const upsertUrlHistory = db.prepare(`
      INSERT INTO url_history (url, target_id, first_seen_at, last_success_at, last_status)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(url, target_id) DO UPDATE SET
        last_success_at = CASE
          WHEN excluded.last_success_at IS NOT NULL THEN excluded.last_success_at
          ELSE url_history.last_success_at
        END,
        last_status = excluded.last_status
    `);

    db.exec('BEGIN');
    try {
      insertRun.run(
        runEntry.runId,
        runEntry.generatedAt,
        runEntry.profilePath,
        runEntry.scanDurationMs,
        runEntry.targetsScanned,
        runEntry.pagesScanned,
        runEntry.totalViolations,
        runEntry.qualityIndexScore,
        runEntry.qualityGateStatus,
        runEntry.consensusFailure,
        runEntry.alfaOnlyFailure,
        runEntry.axeOnlyFailure
      );

      for (const result of allResults) {
        for (const page of result.pagesScanned) {
          const violationCount = page.liveAudits?.accessibilityViolations.length ?? 0;
          const lighthouseScore = page.liveAudits?.lighthouse?.performanceScore ?? null;
          const plainLanguageGrade = page.offlineAudits?.contentMetrics?.fleschKincaidGrade ?? null;
          const technologies =
            page.technologyStack.length > 0
              ? JSON.stringify(page.technologyStack.map(t => t.name))
              : null;

          const pageResult = insertPage.run(
            runEntry.runId,
            result.targetId,
            result.domain,
            page.url,
            page.status,
            page.timestamp,
            violationCount,
            lighthouseScore,
            plainLanguageGrade,
            technologies
          );

          const pageId = pageResult.lastInsertRowid as number;

          for (const violation of page.liveAudits?.accessibilityViolations ?? []) {
            for (const instance of violation.instances) {
              insertViolation.run(
                pageId,
                violation.id,
                violation.severity,
                violation.description,
                instance.target.join(', '),
                'axe'
              );
            }
          }

          const isSuccess = page.status === 'COMPLETED' || page.status === 'SKIPPED_UNCHANGED';
          upsertUrlHistory.run(
            page.url,
            result.targetId,
            page.timestamp,
            isSuccess ? page.timestamp : null,
            page.status
          );
        }
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
