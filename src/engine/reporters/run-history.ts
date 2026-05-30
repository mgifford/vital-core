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
    providerAttributionTop: ProviderAttributionRollupEntry[];
    urlFreshness: {
      newUrls: number;
      carriedOverUrls: number;
      newUrlPercent: number;
    };
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
  requirementComplianceOverTime: Array<{
    runId: string;
    generatedAt: string;
    pagesScanned: number;
    compliancePercentages: {
      wcag20AALegalBaseline: number;
      wcag21AA: number;
      wcag22AATarget: number;
      accessibilityNoViolations: number;
      performanceThreshold: number;
      plainLanguageGrade: number;
      plainLanguageLinks: number;
      completedStatus: number;
    };
  }>;
}

interface ProviderAttributionRollupEntry {
  provider: string;
  high: number;
  medium: number;
  low: number;
  score: number;
}

interface DomainOngoingReport {
  targetId: string;
  domain: string;
  period: {
    start: string;
    end: string;
    runCount: number;
  };
  qualityIndicators: {
    pagesObserved: number;
    completionRate: number;
    violationsPerPage: number;
    averagePerformanceScore: number | null;
    averageFleschKincaidGrade: number | null;
    averagePassiveVoiceRatio: number | null;
    averageAmbiguousLinkTextCount: number;
  };
  suggestions: string[];
  pagesNeedingMostImprovement: Array<{
    url: string;
    priorityScore: number;
    reasons: string[];
  }>;
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
    const providerAttributionTop = this.computeProviderAttributionRollup(allResults);

    const latestPayload = {
      runId,
      generatedAt,
      profilePath,
      scanDurationMs: totalDurationMs,
      qualityIndex,
      targetQuality,
      providerAttributionTop,
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
    fs.writeFileSync(
      path.join(this.distRunsDir, 'domain-ongoing.json'),
      JSON.stringify(this.buildDomainOngoingReports(nextIndex), null, 2),
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
    const latestPayload = this.readRunPayload(latest);
    const previousPayload = previous ? this.readRunPayload(previous) : null;
    const urlFreshness = this.computeUrlFreshness(latestPayload, previousPayload);

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
        targetQuality: this.readTargetQualitySnapshot(latest),
        providerAttributionTop: this.readProviderAttributionRollupSnapshot(latest),
        urlFreshness
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
      rollingAverage: average,
      requirementComplianceOverTime: this.buildRequirementComplianceOverTime(windowedRuns)
    };
  }

  private static computeUrlFreshness(
    latestPayload: { results: TargetScanResult[] } | null,
    previousPayload: { results: TargetScanResult[] } | null
  ): TrendSummary['latest']['urlFreshness'] {
    const latestUrls = new Set(
      (latestPayload?.results ?? [])
        .flatMap(result => result.pagesScanned)
        .map(page => page.url)
        .filter((url): url is string => typeof url === 'string' && url.length > 0)
    );

    const previousUrls = new Set(
      (previousPayload?.results ?? [])
        .flatMap(result => result.pagesScanned)
        .map(page => page.url)
        .filter((url): url is string => typeof url === 'string' && url.length > 0)
    );

    const newUrls = Array.from(latestUrls).filter(url => !previousUrls.has(url)).length;
    const carriedOverUrls = Array.from(latestUrls).filter(url => previousUrls.has(url)).length;
    const newUrlPercent = latestUrls.size > 0
      ? Number(((newUrls / latestUrls.size) * 100).toFixed(2))
      : 0;

    return {
      newUrls,
      carriedOverUrls,
      newUrlPercent
    };
  }

  private static buildRequirementComplianceOverTime(runs: RunEntry[]): TrendSummary['requirementComplianceOverTime'] {
    const chronologicalRuns = [...runs].reverse();

    return chronologicalRuns.map(run => {
      const payload = this.readRunPayload(run);
      const pages = payload?.results.flatMap(result => result.pagesScanned) ?? [];
      const totalPages = pages.length;

      const countPassing = (predicate: (page: TargetScanResult['pagesScanned'][number]) => boolean): number => {
        if (totalPages === 0) {
          return 0;
        }
        return pages.reduce((sum, page) => sum + (predicate(page) ? 1 : 0), 0);
      };

      const percentage = (count: number): number => {
        if (totalPages === 0) {
          return 0;
        }
        return Number(((count / totalPages) * 100).toFixed(2));
      };

      const passesWcag = (page: TargetScanResult['pagesScanned'][number], versionPrefix: string): boolean => {
        const violations = page.liveAudits?.accessibilityViolations ?? [];
        const hasVersionFailure = violations.some(violation =>
          (violation.impactedCriteria ?? []).some(tag => String(tag || '').toLowerCase().startsWith(versionPrefix))
        );
        return !hasVersionFailure;
      };

      return {
        runId: run.runId,
        generatedAt: run.generatedAt,
        pagesScanned: totalPages,
        compliancePercentages: {
          wcag20AALegalBaseline: percentage(
            countPassing(page => passesWcag(page, 'wcag2'))
          ),
          wcag21AA: percentage(
            countPassing(page => passesWcag(page, 'wcag21'))
          ),
          wcag22AATarget: percentage(
            countPassing(page => passesWcag(page, 'wcag22'))
          ),
          accessibilityNoViolations: percentage(
            countPassing(page => (page.liveAudits?.accessibilityViolations.length ?? 0) === 0)
          ),
          performanceThreshold: percentage(
            countPassing(page => {
              const perf = page.liveAudits?.lighthouse?.performanceScore;
              return typeof perf === 'number' && perf >= 70;
            })
          ),
          plainLanguageGrade: percentage(
            countPassing(page => {
              const grade = page.offlineAudits?.contentMetrics.fleschKincaidGrade;
              return typeof grade === 'number' && grade <= 8;
            })
          ),
          plainLanguageLinks: percentage(
            countPassing(page => (page.offlineAudits?.contentMetrics.ambiguousLinkTextCount ?? 0) === 0)
          ),
          completedStatus: percentage(countPassing(page => page.status === 'COMPLETED'))
        }
      };
    });
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

  private static readProviderAttributionRollupSnapshot(run: RunEntry): ProviderAttributionRollupEntry[] {
    if (!run.artifactPath) {
      return [];
    }

    const artifactFullPath = path.resolve(process.cwd(), 'dist', run.artifactPath);
    if (!fs.existsSync(artifactFullPath)) {
      return [];
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(artifactFullPath, 'utf8')) as {
        providerAttributionTop?: ProviderAttributionRollupEntry[];
      };

      if (!Array.isArray(parsed.providerAttributionTop)) {
        return [];
      }

      return parsed.providerAttributionTop.filter(item =>
        item &&
        typeof item.provider === 'string' &&
        typeof item.high === 'number' &&
        typeof item.medium === 'number' &&
        typeof item.low === 'number' &&
        typeof item.score === 'number'
      );
    } catch {
      return [];
    }
  }

  private static computeProviderAttributionRollup(allResults: TargetScanResult[]): ProviderAttributionRollupEntry[] {
    const byProvider = new Map<string, ProviderAttributionRollupEntry>();

    for (const target of allResults) {
      for (const page of target.pagesScanned) {
        const attributions = page.thirdPartyImpact?.providerAttribution ?? [];
        for (const attribution of attributions) {
          const current = byProvider.get(attribution.provider) ?? {
            provider: attribution.provider,
            high: 0,
            medium: 0,
            low: 0,
            score: 0
          };

          if (attribution.confidence === 'HIGH') current.high += 1;
          if (attribution.confidence === 'MEDIUM') current.medium += 1;
          if (attribution.confidence === 'LOW') current.low += 1;
          current.score += attribution.score;

          byProvider.set(attribution.provider, current);
        }
      }
    }

    return Array.from(byProvider.values())
      .sort((a, b) => {
        if (b.high !== a.high) return b.high - a.high;
        if (b.medium !== a.medium) return b.medium - a.medium;
        if (b.score !== a.score) return b.score - a.score;
        return a.provider.localeCompare(b.provider);
      })
      .slice(0, 10);
  }

  private static buildDomainOngoingReports(index: RunIndex): {
    generatedAt: string;
    windowSize: number;
    reports: DomainOngoingReport[];
  } {
    const windowedRuns = index.runs.slice(0, 8);
    const runPayloads = windowedRuns
      .map(run => ({ run, payload: this.readRunPayload(run) }))
      .filter(item => item.payload !== null) as Array<{ run: RunEntry; payload: { results: TargetScanResult[] } }>;

    const byTarget = new Map<string, {
      domain: string;
      runs: Array<{ run: RunEntry; result: TargetScanResult }>;
    }>();

    for (const item of runPayloads) {
      for (const result of item.payload.results) {
        const current = byTarget.get(result.targetId) ?? {
          domain: result.domain,
          runs: []
        };
        current.runs.push({ run: item.run, result });
        byTarget.set(result.targetId, current);
      }
    }

    const reports = Array.from(byTarget.entries())
      .map(([targetId, target]) => this.buildDomainOngoingReport(targetId, target.domain, target.runs))
      .sort((a, b) => a.targetId.localeCompare(b.targetId));

    return {
      generatedAt: new Date().toISOString(),
      windowSize: windowedRuns.length,
      reports
    };
  }

  private static readRunPayload(run: RunEntry): { results: TargetScanResult[] } | null {
    const artifactFullPath = path.resolve(process.cwd(), 'dist', run.artifactPath);
    if (!fs.existsSync(artifactFullPath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(artifactFullPath, 'utf8')) as { results?: TargetScanResult[] };
      if (!Array.isArray(parsed.results)) {
        return null;
      }

      return { results: parsed.results };
    } catch {
      return null;
    }
  }

  private static buildDomainOngoingReport(
    targetId: string,
    domain: string,
    runs: Array<{ run: RunEntry; result: TargetScanResult }>
  ): DomainOngoingReport {
    const sortedRuns = [...runs].sort((a, b) => b.run.generatedAt.localeCompare(a.run.generatedAt));
    const allPages = sortedRuns.flatMap(entry => entry.result.pagesScanned);

    const pagesObserved = allPages.length;
    const completedPages = allPages.filter(page => page.status === 'COMPLETED').length;
    const completionRate = pagesObserved > 0 ? (completedPages / pagesObserved) * 100 : 0;
    const totalViolations = allPages.reduce((sum, page) => sum + (page.liveAudits?.accessibilityViolations.length ?? 0), 0);
    const violationsPerPage = pagesObserved > 0 ? totalViolations / pagesObserved : 0;

    const performanceScores = allPages
      .map(page => page.liveAudits?.lighthouse?.performanceScore)
      .filter((value): value is number => typeof value === 'number');
    const gradeScores = allPages
      .map(page => page.offlineAudits?.contentMetrics.fleschKincaidGrade)
      .filter((value): value is number => typeof value === 'number');
    const passiveRatios = allPages
      .map(page => page.offlineAudits?.contentMetrics.passiveVoiceSentenceRatio)
      .filter((value): value is number => typeof value === 'number');
    const ambiguousLinkAverage = pagesObserved > 0
      ? allPages.reduce((sum, page) => sum + (page.offlineAudits?.contentMetrics.ambiguousLinkTextCount ?? 0), 0) / pagesObserved
      : 0;

    const suggestions: string[] = [];
    if (violationsPerPage > 0.8) {
      suggestions.push('Reduce recurring accessibility defects on high-traffic templates first.');
    }
    if (performanceScores.length > 0 && this.average(performanceScores) < 70) {
      suggestions.push('Improve performance budget for slow pages (images, scripts, and blocking assets).');
    }
    if (gradeScores.length > 0 && this.average(gradeScores) > 8) {
      suggestions.push('Simplify page language to target a Grade 8 reading level.');
    }
    if (passiveRatios.length > 0 && this.average(passiveRatios) > 15) {
      suggestions.push('Lower passive voice usage in primary content and instructions.');
    }
    if (ambiguousLinkAverage > 0.2) {
      suggestions.push('Replace ambiguous link text with specific action-oriented labels.');
    }
    if (suggestions.length === 0) {
      suggestions.push('Maintain quality indicators and continue incremental improvements.');
    }

    const latestPages = sortedRuns[0]?.result.pagesScanned ?? [];
    const pagesNeedingMostImprovement = latestPages
      .map(page => {
        const reasons: string[] = [];
        let priorityScore = 0;

        const violations = page.liveAudits?.accessibilityViolations.length ?? 0;
        if (violations > 0) {
          priorityScore += violations * 2;
          reasons.push(`${violations} accessibility violation(s)`);
        }

        const perf = page.liveAudits?.lighthouse?.performanceScore;
        if (typeof perf === 'number' && perf < 70) {
          const penalty = Math.ceil((70 - perf) / 10);
          priorityScore += penalty;
          reasons.push(`Low performance score (${perf})`);
        }

        const grade = page.offlineAudits?.contentMetrics.fleschKincaidGrade;
        if (typeof grade === 'number' && grade > 8) {
          const penalty = Math.ceil(grade - 8);
          priorityScore += penalty;
          reasons.push(`High reading grade (${grade.toFixed(1)})`);
        }

        const ambiguousLinks = page.offlineAudits?.contentMetrics.ambiguousLinkTextCount ?? 0;
        if (ambiguousLinks > 0) {
          priorityScore += ambiguousLinks;
          reasons.push(`${ambiguousLinks} ambiguous link text occurrence(s)`);
        }

        if (page.status !== 'COMPLETED') {
          priorityScore += 3;
          reasons.push(`Page status: ${page.status}`);
        }

        return {
          url: page.url,
          priorityScore,
          reasons
        };
      })
      .filter(page => page.priorityScore > 0)
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, 5);

    const periodEnd = sortedRuns[0]?.run.generatedAt ?? new Date().toISOString();
    const periodStart = sortedRuns[sortedRuns.length - 1]?.run.generatedAt ?? periodEnd;

    return {
      targetId,
      domain,
      period: {
        start: periodStart,
        end: periodEnd,
        runCount: sortedRuns.length
      },
      qualityIndicators: {
        pagesObserved,
        completionRate: Number(completionRate.toFixed(2)),
        violationsPerPage: Number(violationsPerPage.toFixed(3)),
        averagePerformanceScore: performanceScores.length > 0 ? Number(this.average(performanceScores).toFixed(2)) : null,
        averageFleschKincaidGrade: gradeScores.length > 0 ? Number(this.average(gradeScores).toFixed(2)) : null,
        averagePassiveVoiceRatio: passiveRatios.length > 0 ? Number(this.average(passiveRatios).toFixed(2)) : null,
        averageAmbiguousLinkTextCount: Number(ambiguousLinkAverage.toFixed(2))
      },
      suggestions,
      pagesNeedingMostImprovement
    };
  }

  private static average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
}
