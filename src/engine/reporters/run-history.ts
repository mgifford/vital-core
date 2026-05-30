import * as fs from 'fs';
import * as path from 'path';
import { TargetScanResult } from '../../types/site-quality-spec';
import {
  QualityIndexReporter,
  QualityIndexResult,
  TargetQualityIndexEntry
} from './quality-index';

interface RunEntry {
  runId: string;
  generatedAt: string;
  profilePath: string;
  scanDurationMs: number;
  targetsScanned: number;
  pagesScanned: number;
  totalViolations: number;
  qualityIndexScore: number;
  qualityGateStatus: QualityIndexResult['gateStatus'];
  artifactPath: string;
}

interface RunIndex {
  updatedAt: string;
  latestRunId: string;
  runs: RunEntry[];
}

interface TrendSummary {
  generatedAt: string;
  latestRunId: string;
  windowSize: number;
  latest: {
    targetsScanned: number;
    pagesScanned: number;
    totalViolations: number;
    scanDurationMs: number;
    violationsPerPage: number;
    qualityIndexScore: number;
    qualityGateStatus: QualityIndexResult['gateStatus'];
    targetQuality: TargetQualityIndexEntry[];
  };
  deltaFromPrevious: {
    targetsScanned: number;
    pagesScanned: number;
    totalViolations: number;
    scanDurationMs: number;
    violationsPerPage: number;
    qualityIndexScore: number;
  } | null;
  rollingAverage: {
    pagesScanned: number;
    totalViolations: number;
    scanDurationMs: number;
    violationsPerPage: number;
    qualityIndexScore: number;
  };
}

export class RunHistoryReporter {
  private static get distRunsDir(): string {
    return path.resolve(process.cwd(), 'dist/runs');
  }

  public static persistRunHistory(
    allResults: TargetScanResult[],
    profilePath: string,
    totalDurationMs: number
  ): RunEntry {
    if (!fs.existsSync(this.distRunsDir)) {
      fs.mkdirSync(this.distRunsDir, { recursive: true });
    }

    this.restoreCachedHistory();

    const generatedAt = new Date().toISOString();
    const runId = generatedAt.replace(/[:.]/g, '-');

    const pagesScanned = allResults.reduce((sum, result) => sum + result.pagesScanned.length, 0);
    const totalViolations = allResults.reduce((sum, result) => {
      return (
        sum +
        result.pagesScanned.reduce((pageSum, page) => {
          return pageSum + (page.liveAudits?.accessibilityViolations.length ?? 0);
        }, 0)
      );
    }, 0);

    const artifactPath = `runs/${runId}.json`;
    const qualityIndex = QualityIndexReporter.buildQualityIndex(allResults);
    const targetQuality = QualityIndexReporter.buildTargetQualityIndex(allResults);

    const latestPayload = {
      runId,
      generatedAt,
      profilePath,
      scanDurationMs: totalDurationMs,
      qualityIndex,
      targetQuality,
      results: allResults
    };

    const runEntry: RunEntry = {
      runId,
      generatedAt,
      profilePath,
      scanDurationMs: totalDurationMs,
      targetsScanned: allResults.length,
      pagesScanned,
      totalViolations,
      qualityIndexScore: qualityIndex.score,
      qualityGateStatus: qualityIndex.gateStatus,
      artifactPath
    };

    fs.writeFileSync(path.join(this.distRunsDir, `${runId}.json`), JSON.stringify(latestPayload, null, 2), 'utf8');
    fs.writeFileSync(path.join(this.distRunsDir, 'latest.json'), JSON.stringify(latestPayload, null, 2), 'utf8');

    const existingIndex = this.loadExistingIndex();
    const mergedRuns = [runEntry, ...existingIndex.runs.filter(run => run.runId !== runId)].slice(0, 200);

    const nextIndex: RunIndex = {
      updatedAt: generatedAt,
      latestRunId: runId,
      runs: mergedRuns
    };

    fs.writeFileSync(path.join(this.distRunsDir, 'index.json'), JSON.stringify(nextIndex, null, 2), 'utf8');
    fs.writeFileSync(
      path.join(this.distRunsDir, 'trends.json'),
      JSON.stringify(this.buildTrendSummary(nextIndex), null, 2),
      'utf8'
    );

    return runEntry;
  }

  private static loadExistingIndex(): RunIndex {
    const indexPath = path.join(this.distRunsDir, 'index.json');
    if (!fs.existsSync(indexPath)) {
      return {
        updatedAt: new Date(0).toISOString(),
        latestRunId: '',
        runs: []
      };
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as Partial<RunIndex>;
      if (!Array.isArray(parsed.runs)) {
        throw new Error('Invalid runs array');
      }

      return {
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
        latestRunId: typeof parsed.latestRunId === 'string' ? parsed.latestRunId : '',
        runs: parsed.runs.filter(this.isRunEntry).map(this.withQualityDefaults)
      };
    } catch {
      return {
        updatedAt: new Date(0).toISOString(),
        latestRunId: '',
        runs: []
      };
    }
  }

  private static isRunEntry(value: unknown): value is RunEntry {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const run = value as Record<string, unknown>;
    return (
      typeof run.runId === 'string' &&
      typeof run.generatedAt === 'string' &&
      typeof run.profilePath === 'string' &&
      typeof run.scanDurationMs === 'number' &&
      typeof run.targetsScanned === 'number' &&
      typeof run.pagesScanned === 'number' &&
      typeof run.totalViolations === 'number' &&
      typeof run.artifactPath === 'string'
    );
  }

  private static withQualityDefaults(run: RunEntry): RunEntry {
    return {
      ...run,
      qualityIndexScore: typeof run.qualityIndexScore === 'number' ? run.qualityIndexScore : 0,
      qualityGateStatus:
        run.qualityGateStatus === 'PASS' || run.qualityGateStatus === 'WARNING' || run.qualityGateStatus === 'BLOCKED'
          ? run.qualityGateStatus
          : 'WARNING'
    };
  }

  private static restoreCachedHistory(): void {
    const historyCacheDir = process.env.VITAL_HISTORY_CACHE_DIR;
    if (!historyCacheDir) {
      return;
    }

    const cachedRunsDir = path.resolve(process.cwd(), historyCacheDir, 'runs');
    if (!fs.existsSync(cachedRunsDir)) {
      return;
    }

    const entries = fs.readdirSync(cachedRunsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      const src = path.join(cachedRunsDir, entry.name);
      const dest = path.join(this.distRunsDir, entry.name);

      if (!fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
      }
    }
  }

  private static buildTrendSummary(index: RunIndex): TrendSummary {
    const windowedRuns = index.runs.slice(0, 7);
    const latest = windowedRuns[0] ?? {
      runId: '',
      targetsScanned: 0,
      pagesScanned: 0,
      totalViolations: 0,
      scanDurationMs: 0,
      qualityIndexScore: 0,
      qualityGateStatus: 'WARNING' as const
    };

    const previous = windowedRuns[1] ?? null;
    const average = this.calculateRollingAverage(windowedRuns);

    const latestViolationsPerPage = latest.pagesScanned > 0 ? latest.totalViolations / latest.pagesScanned : 0;
    const previousViolationsPerPage = previous && previous.pagesScanned > 0 ? previous.totalViolations / previous.pagesScanned : 0;

    return {
      generatedAt: new Date().toISOString(),
      latestRunId: latest.runId,
      windowSize: windowedRuns.length,
      latest: {
        targetsScanned: latest.targetsScanned,
        pagesScanned: latest.pagesScanned,
        totalViolations: latest.totalViolations,
        scanDurationMs: latest.scanDurationMs,
        violationsPerPage: Number(latestViolationsPerPage.toFixed(4)),
        qualityIndexScore: Number((latest.qualityIndexScore ?? 0).toFixed(2)),
        qualityGateStatus: latest.qualityGateStatus ?? 'WARNING',
        targetQuality: this.readTargetQualitySnapshot(latest)
      },
      deltaFromPrevious: previous
        ? {
            targetsScanned: latest.targetsScanned - previous.targetsScanned,
            pagesScanned: latest.pagesScanned - previous.pagesScanned,
            totalViolations: latest.totalViolations - previous.totalViolations,
            scanDurationMs: latest.scanDurationMs - previous.scanDurationMs,
            violationsPerPage: Number((latestViolationsPerPage - previousViolationsPerPage).toFixed(4)),
            qualityIndexScore: Number(((latest.qualityIndexScore ?? 0) - (previous.qualityIndexScore ?? 0)).toFixed(2))
          }
        : null,
      rollingAverage: average
    };
  }

  private static calculateRollingAverage(runs: RunEntry[]): TrendSummary['rollingAverage'] {
    if (runs.length === 0) {
      return {
        pagesScanned: 0,
        totalViolations: 0,
        scanDurationMs: 0,
        violationsPerPage: 0,
        qualityIndexScore: 0
      };
    }

    const totalPages = runs.reduce((sum, run) => sum + run.pagesScanned, 0);
    const totalViolations = runs.reduce((sum, run) => sum + run.totalViolations, 0);
    const totalDurationMs = runs.reduce((sum, run) => sum + run.scanDurationMs, 0);

    return {
      pagesScanned: Number((totalPages / runs.length).toFixed(2)),
      totalViolations: Number((totalViolations / runs.length).toFixed(2)),
      scanDurationMs: Number((totalDurationMs / runs.length).toFixed(2)),
      violationsPerPage: totalPages > 0 ? Number((totalViolations / totalPages).toFixed(4)) : 0,
      qualityIndexScore: Number(
        (runs.reduce((sum, run) => sum + (run.qualityIndexScore ?? 0), 0) / runs.length).toFixed(2)
      )
    };
  }

  private static readTargetQualitySnapshot(run: RunEntry): TargetQualityIndexEntry[] {
    if (!run.artifactPath) {
      return [];
    }

    const artifactFullPath = path.resolve(process.cwd(), 'dist', run.artifactPath);
    if (!fs.existsSync(artifactFullPath)) {
      return [];
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(artifactFullPath, 'utf8')) as {
        targetQuality?: TargetQualityIndexEntry[];
      };

      if (!Array.isArray(parsed.targetQuality)) {
        return [];
      }

      return parsed.targetQuality.filter(item =>
        item &&
        typeof item.targetId === 'string' &&
        typeof item.score === 'number' &&
        (item.gateStatus === 'PASS' || item.gateStatus === 'WARNING' || item.gateStatus === 'BLOCKED') &&
        typeof item.pagesScanned === 'number' &&
        typeof item.totalViolations === 'number'
      );
    } catch {
      return [];
    }
  }
}
