import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';
import type { TargetScanResult } from '../../types/site-quality-spec';
import type {
  WeeklyDomainRating,
  PerRunDomainSnapshot,
  WeeklyTrendPoint,
  WeeklyRuleFrequency,
  RunDirectoryEntry,
  SeverityCount,
  LetterGrade
} from '../../types/domain-rating';

interface WeeklyIssueRow {
  violationId: number;
  runId: string;
  targetId: string;
  domain: string;
  pageId: number;
  url: string;
  status: string;
  scannedAt: string;
  ruleId: string;
  impact: string;
  message: string;
  selector: string | null;
  provider: string | null;
}

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

  /**
   * Exports a static, query-friendly snapshot of all violation instances observed
   * in the last `windowDays` days.
   *
   * Output files are written under:
   *   dist/api/issues-last-week/
   *
   * - index.json: metadata, counts, and chunk manifest
   * - all-issues-XXXX.json: global issue chunks
   * - targets/<targetId>.json: full per-target issue list
   */
  public static exportWeeklyIssuesSnapshot(windowDays = 7, chunkSize = 5000): void {
    try {
      if (!fs.existsSync(this.dbPath)) {
        return;
      }

      const db = new DatabaseSync(this.dbPath, { readOnly: true });
      try {
        const outputRoot = path.resolve(process.cwd(), 'dist', 'api', 'issues-last-week');
        const targetsDir = path.join(outputRoot, 'targets');
        fs.mkdirSync(targetsDir, { recursive: true });

        const totalIssues = Number(
          db.prepare(`
            SELECT COUNT(*) AS count
            FROM violations v
            JOIN pages p ON p.id = v.page_id
            WHERE julianday(p.scanned_at) >= julianday('now', ?)
          `).get(`-${windowDays} days`)?.count ?? 0
        );

        const chunks: string[] = [];
        for (let offset = 0, idx = 1; offset < totalIssues; offset += chunkSize, idx += 1) {
          const rows = this.queryWeeklyIssueRows(db, windowDays, chunkSize, offset);
          const fileName = `all-issues-${String(idx).padStart(4, '0')}.json`;
          fs.writeFileSync(
            path.join(outputRoot, fileName),
            JSON.stringify({
              windowDays,
              chunkIndex: idx,
              chunkSize,
              offset,
              rowCount: rows.length,
              rows
            }, null, 2),
            'utf8'
          );
          chunks.push(`api/issues-last-week/${fileName}`);
        }

        const targetSummaries = db.prepare(`
          SELECT
            p.target_id AS targetId,
            MIN(p.domain) AS domain,
            COUNT(*) AS issueCount,
            COUNT(DISTINCT p.url) AS affectedPages,
            COUNT(DISTINCT v.rule_id) AS distinctRules
          FROM violations v
          JOIN pages p ON p.id = v.page_id
          WHERE julianday(p.scanned_at) >= julianday('now', ?)
          GROUP BY p.target_id
          ORDER BY issueCount DESC
        `).all(`-${windowDays} days`) as Array<{
          targetId: string;
          domain: string;
          issueCount: number;
          affectedPages: number;
          distinctRules: number;
        }>;

        for (const target of targetSummaries) {
          const targetRows = db.prepare(`
            SELECT
              v.id AS violationId,
              p.run_id AS runId,
              p.target_id AS targetId,
              p.domain AS domain,
              p.id AS pageId,
              p.url AS url,
              p.status AS status,
              p.scanned_at AS scannedAt,
              v.rule_id AS ruleId,
              v.impact AS impact,
              v.message AS message,
              v.selector AS selector,
              v.provider AS provider
            FROM violations v
            JOIN pages p ON p.id = v.page_id
            WHERE p.target_id = ?
              AND julianday(p.scanned_at) >= julianday('now', ?)
            ORDER BY p.scanned_at DESC, p.url ASC, v.rule_id ASC, v.id ASC
          `).all(target.targetId, `-${windowDays} days`) as unknown as WeeklyIssueRow[];

          const targetFile = `${this.sanitizeTargetId(target.targetId)}.json`;
          fs.writeFileSync(
            path.join(targetsDir, targetFile),
            JSON.stringify({
              targetId: target.targetId,
              domain: target.domain,
              windowDays,
              issueCount: targetRows.length,
              rows: targetRows
            }, null, 2),
            'utf8'
          );
        }

        fs.writeFileSync(
          path.join(outputRoot, 'index.json'),
          JSON.stringify({
            generatedAt: new Date().toISOString(),
            windowDays,
            totalIssues,
            chunkSize,
            chunkCount: chunks.length,
            chunks,
            targets: targetSummaries.map(target => ({
              targetId: target.targetId,
              domain: target.domain,
              issueCount: Number(target.issueCount || 0),
              affectedPages: Number(target.affectedPages || 0),
              distinctRules: Number(target.distinctRules || 0),
              file: `api/issues-last-week/targets/${this.sanitizeTargetId(target.targetId)}.json`
            }))
          }, null, 2),
          'utf8'
        );
      } finally {
        db.close();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  Weekly issues snapshot export skipped: ${msg}`);
    }
  }

  private static queryWeeklyIssueRows(
    db: DatabaseSync,
    windowDays: number,
    limit: number,
    offset: number
  ): WeeklyIssueRow[] {
    return db.prepare(`
      SELECT
        v.id AS violationId,
        p.run_id AS runId,
        p.target_id AS targetId,
        p.domain AS domain,
        p.id AS pageId,
        p.url AS url,
        p.status AS status,
        p.scanned_at AS scannedAt,
        v.rule_id AS ruleId,
        v.impact AS impact,
        v.message AS message,
        v.selector AS selector,
        v.provider AS provider
      FROM violations v
      JOIN pages p ON p.id = v.page_id
      WHERE julianday(p.scanned_at) >= julianday('now', ?)
      ORDER BY p.scanned_at DESC, p.target_id ASC, p.url ASC, v.rule_id ASC, v.id ASC
      LIMIT ? OFFSET ?
    `).all(`-${windowDays} days`, limit, offset) as unknown as WeeklyIssueRow[];
  }

  private static sanitizeTargetId(value: string): string {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown';
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

  /**
   * Query violation counts by severity for a domain over a time window.
   * Used to populate WeeklyDomainRating scores.
   */
  public static queryWeeklyViolationsByDomain(
    targetId: string,
    windowDays = 7
  ): SeverityCount {
    try {
      if (!fs.existsSync(this.dbPath)) {
        return { critical: 0, serious: 0, moderate: 0, minor: 0 };
      }

      const db = new DatabaseSync(this.dbPath, { readOnly: true });
      try {
        const result = db.prepare(`
          SELECT
            SUM(CASE WHEN v.impact = 'critical' THEN 1 ELSE 0 END) AS critical,
            SUM(CASE WHEN v.impact = 'serious' THEN 1 ELSE 0 END) AS serious,
            SUM(CASE WHEN v.impact = 'moderate' THEN 1 ELSE 0 END) AS moderate,
            SUM(CASE WHEN v.impact = 'minor' THEN 1 ELSE 0 END) AS minor
          FROM violations v
          JOIN pages p ON p.id = v.page_id
          WHERE p.target_id = ?
            AND julianday(p.scanned_at) >= julianday('now', ?)
        `).get(targetId, `-${windowDays} days`) as unknown as SeverityCount;

        return result || { critical: 0, serious: 0, moderate: 0, minor: 0 };
      } finally {
        db.close();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  queryWeeklyViolationsByDomain skipped: ${msg}`);
      return { critical: 0, serious: 0, moderate: 0, minor: 0 };
    }
  }

  /**
   * Query rule frequency across all domains for a time window.
   */
  public static queryWeeklyRuleFrequency(windowDays = 7): WeeklyRuleFrequency[] {
    try {
      if (!fs.existsSync(this.dbPath)) {
        return [];
      }

      const db = new DatabaseSync(this.dbPath, { readOnly: true });
      try {
        const raw = db.prepare(`
          SELECT
            v.rule_id AS ruleId,
            COUNT(*) AS occurrences,
            COUNT(DISTINCT p.url) AS affectedPages,
            SUM(CASE WHEN v.impact = 'critical' THEN 1 ELSE 0 END) AS critical,
            SUM(CASE WHEN v.impact = 'serious' THEN 1 ELSE 0 END) AS serious,
            SUM(CASE WHEN v.impact = 'moderate' THEN 1 ELSE 0 END) AS moderate,
            SUM(CASE WHEN v.impact = 'minor' THEN 1 ELSE 0 END) AS minor
          FROM violations v
          JOIN pages p ON p.id = v.page_id
          WHERE julianday(p.scanned_at) >= julianday('now', ?)
          GROUP BY v.rule_id
          ORDER BY occurrences DESC
        `).all(`-${windowDays} days`) as unknown as Array<{
          ruleId: string;
          occurrences: number;
          affectedPages: number;
          critical: number;
          serious: number;
          moderate: number;
          minor: number;
        }>;

        return raw.map(row => {
          const severities = {
            critical: row.critical || 0,
            serious: row.serious || 0,
            moderate: row.moderate || 0,
            minor: row.minor || 0
          };
          const mostCommonSeverity = this.getMostCommonSeverity(severities);
          return {
            ruleId: row.ruleId,
            occurrences: row.occurrences,
            affectedPages: row.affectedPages,
            severities,
            mostCommonSeverity
          };
        });
      } finally {
        db.close();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  queryWeeklyRuleFrequency skipped: ${msg}`);
      return [];
    }
  }

  /**
   * Query pages with most violations for a domain in a time window.
   */
  public static queryWeeklyPageQuality(
    targetId: string,
    windowDays = 7,
    limit = 50
  ): Array<{ url: string; violationCount: number; severity: SeverityCount }> {
    try {
      if (!fs.existsSync(this.dbPath)) {
        return [];
      }

      const db = new DatabaseSync(this.dbPath, { readOnly: true });
      try {
        const raw = db.prepare(`
          SELECT
            p.url AS url,
            COUNT(v.id) AS violationCount,
            SUM(CASE WHEN v.impact = 'critical' THEN 1 ELSE 0 END) AS critical,
            SUM(CASE WHEN v.impact = 'serious' THEN 1 ELSE 0 END) AS serious,
            SUM(CASE WHEN v.impact = 'moderate' THEN 1 ELSE 0 END) AS moderate,
            SUM(CASE WHEN v.impact = 'minor' THEN 1 ELSE 0 END) AS minor
          FROM pages p
          LEFT JOIN violations v ON v.page_id = p.id
          WHERE p.target_id = ?
            AND julianday(p.scanned_at) >= julianday('now', ?)
          GROUP BY p.id, p.url
          ORDER BY violationCount DESC
          LIMIT ?
        `).all(targetId, `-${windowDays} days`, limit) as unknown as Array<{
          url: string;
          violationCount: number;
          critical: number;
          serious: number;
          moderate: number;
          minor: number;
        }>;

        return raw.map(row => ({
          url: row.url,
          violationCount: row.violationCount,
          severity: {
            critical: row.critical || 0,
            serious: row.serious || 0,
            moderate: row.moderate || 0,
            minor: row.minor || 0
          }
        }));
      } finally {
        db.close();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  queryWeeklyPageQuality skipped: ${msg}`);
      return [];
    }
  }

  /**
   * Query week-over-week compliance trends.
   */
  public static queryWeeklyTrends(backWeeks = 12): WeeklyTrendPoint[] {
    try {
      if (!fs.existsSync(this.dbPath)) {
        return [];
      }

      const db = new DatabaseSync(this.dbPath, { readOnly: true });
      try {
        const raw = db.prepare(`
          SELECT
            DATE(datetime(p.scanned_at, 'weekday 0', '-6 days')) AS weekStart,
            DATE(datetime(p.scanned_at, 'weekday 0')) AS weekEnd,
            COUNT(DISTINCT p.id) AS totalPages,
            COUNT(v.id) AS violationsCount,
            SUM(CASE WHEN (
              SELECT COUNT(*) FROM violations v2 WHERE v2.page_id = p.id
            ) = 0 THEN 1 ELSE 0 END) AS compliantPages
          FROM pages p
          LEFT JOIN violations v ON v.page_id = p.id
          WHERE julianday(p.scanned_at) >= julianday('now', ?)
          GROUP BY weekStart, weekEnd
          ORDER BY weekStart DESC
        `).all(`-${backWeeks} weeks`) as unknown as Array<{
          weekStart: string;
          weekEnd: string;
          totalPages: number;
          violationsCount: number;
          compliantPages: number;
        }>;

        return raw.map(row => ({
          weekStart: row.weekStart,
          weekEnd: row.weekEnd,
          totalPages: row.totalPages,
          violationsCount: row.violationsCount,
          compliantPages: row.compliantPages,
          compliancePercent: row.totalPages > 0
            ? Math.round((row.compliantPages / row.totalPages) * 100)
            : 0
        }));
      } finally {
        db.close();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  queryWeeklyTrends skipped: ${msg}`);
      return [];
    }
  }

  /**
   * Query per-run statistics for a specific domain in a run.
   */
  public static queryPerRunStats(runId: string, targetId: string): PerRunDomainSnapshot | null {
    try {
      if (!fs.existsSync(this.dbPath)) {
        return null;
      }

      const db = new DatabaseSync(this.dbPath, { readOnly: true });
      try {
        const runData = db.prepare(`
          SELECT
            r.run_id AS runId,
            r.generated_at AS generatedAt,
            COUNT(CASE WHEN p.status = 'COMPLETED' THEN 1 END) AS pagesCompleted,
            COUNT(CASE WHEN p.status = 'SKIPPED_UNCHANGED' THEN 1 END) AS pagesSkipped,
            COUNT(p.id) AS pagesTotalScanned,
            SUM(CASE WHEN v.impact = 'critical' THEN 1 ELSE 0 END) AS critical,
            SUM(CASE WHEN v.impact = 'serious' THEN 1 ELSE 0 END) AS serious,
            SUM(CASE WHEN v.impact = 'moderate' THEN 1 ELSE 0 END) AS moderate,
            SUM(CASE WHEN v.impact = 'minor' THEN 1 ELSE 0 END) AS minor,
            MIN(p.domain) AS domain
          FROM runs r
          JOIN pages p ON p.run_id = r.run_id
          LEFT JOIN violations v ON v.page_id = p.id AND (
            p.status = 'COMPLETED' OR p.status = 'SKIPPED_UNCHANGED'
          )
          WHERE r.run_id = ? AND p.target_id = ?
          GROUP BY r.run_id, r.generated_at
        `).get(runId, targetId) as unknown as {
          runId: string;
          generatedAt: string;
          pagesCompleted: number;
          pagesSkipped: number;
          pagesTotalScanned: number;
          critical: number;
          serious: number;
          moderate: number;
          minor: number;
          domain: string;
        } | undefined;

        if (!runData) {
          return null;
        }

        // Calculate score based on violations (simple: 100 - (violations / pages * 100))
        const totalViolations = runData.critical + runData.serious + runData.moderate + runData.minor;
        const scoreNumerical = runData.pagesTotalScanned > 0
          ? Math.max(0, 100 - Math.round((totalViolations / runData.pagesTotalScanned) * 20))
          : 100;

        const letterGrade = this.scoreToLetterGrade(scoreNumerical);

        return {
          runId: runData.runId,
          generatedAt: runData.generatedAt,
          targetId,
          domain: runData.domain,
          pagesCompleted: runData.pagesCompleted,
          pagesSkipped: runData.pagesSkipped,
          pagesTotalScanned: runData.pagesTotalScanned,
          violationCounts: {
            critical: runData.critical || 0,
            serious: runData.serious || 0,
            moderate: runData.moderate || 0,
            minor: runData.minor || 0
          },
          scoreNumerical,
          letterGrade
        };
      } finally {
        db.close();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  queryPerRunStats skipped: ${msg}`);
      return null;
    }
  }

  /**
   * Query directory of all runs (for run history index).
   */
  public static queryRunDirectory(limit = 100): RunDirectoryEntry[] {
    try {
      if (!fs.existsSync(this.dbPath)) {
        return [];
      }

      const db = new DatabaseSync(this.dbPath, { readOnly: true });
      try {
        return db.prepare(`
          SELECT
            r.run_id AS runId,
            r.generated_at AS generatedAt,
            COUNT(DISTINCT p.id) AS pagesScanned,
            COUNT(DISTINCT CASE WHEN p.status = 'COMPLETED' THEN p.id END) AS pagesCompleted,
            COUNT(DISTINCT CASE WHEN p.status = 'SKIPPED_UNCHANGED' THEN p.id END) AS pagesSkipped,
            COUNT(v.id) AS totalViolations,
            r.quality_index_score AS qualityIndexScore
          FROM runs r
          LEFT JOIN pages p ON p.run_id = r.run_id
          LEFT JOIN violations v ON v.page_id = p.id
          GROUP BY r.run_id, r.generated_at
          ORDER BY r.generated_at DESC
          LIMIT ?
        `).all(limit) as unknown as RunDirectoryEntry[];
      } finally {
        db.close();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  queryRunDirectory skipped: ${msg}`);
      return [];
    }
  }

  /**
   * Helper: convert numeric score to letter grade.
   */
  private static scoreToLetterGrade(score: number): LetterGrade {
    if (score >= 97) return 'A+';
    if (score >= 93) return 'A';
    if (score >= 90) return 'A-';
    if (score >= 87) return 'B+';
    if (score >= 83) return 'B';
    if (score >= 80) return 'B-';
    if (score >= 77) return 'C+';
    if (score >= 73) return 'C';
    if (score >= 70) return 'C-';
    if (score >= 67) return 'D+';
    if (score >= 63) return 'D';
    return 'D-';
  }

  /**
   * Helper: determine most common severity from counts.
   */
  private static getMostCommonSeverity(
    counts: SeverityCount
  ): 'critical' | 'serious' | 'moderate' | 'minor' {
    const severities = [
      { severity: 'critical' as const, count: counts.critical },
      { severity: 'serious' as const, count: counts.serious },
      { severity: 'moderate' as const, count: counts.moderate },
      { severity: 'minor' as const, count: counts.minor }
    ];
    return severities.reduce((max, curr) => (curr.count > max.count ? curr : max)).severity;
  }
}
