import * as fs from 'fs';
import * as path from 'path';
import { TargetScanResult } from '../../types/site-quality-spec';
import {
  QualityIndexReporter,
  QualityIndexResult,
  TargetQualityIndexEntry
} from './quality-index';
import { ConsensusPrioritizer, ConsensusSummary } from './consensus-prioritizer';

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
  consensusFailure: number;
  alfaOnlyFailure: number;
  axeOnlyFailure: number;
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
    consensus: ConsensusSummary;
  };
  deltaFromPrevious: {
    targetsScanned: number;
    pagesScanned: number;
    totalViolations: number;
    scanDurationMs: number;
    violationsPerPage: number;
    qualityIndexScore: number;
    consensusFailure: number;
    alfaOnlyFailure: number;
    axeOnlyFailure: number;
  } | null;
  rollingAverage: {
    pagesScanned: number;
    totalViolations: number;
    scanDurationMs: number;
    violationsPerPage: number;
    qualityIndexScore: number;
    consensusFailure: number;
    alfaOnlyFailure: number;
    axeOnlyFailure: number;
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

interface SoftwareByDomainPayload {
  generatedAt: string;
  runId: string;
  aggregatedByDomain: Array<{
    targetId: string;
    domain: string;
    technologiesDetected: number;
    technologies: Array<{
      name: string;
      categories: string[];
      versions: string[];
      urlCount: number;
    }>;
  }>;
  detailedByDomain: Array<{
    targetId: string;
    domain: string;
    pages: Array<{
      url: string;
      status: string;
      timestamp: string;
      technologies: Array<{
        name: string;
        category: string;
        version: string;
      }>;
    }>;
  }>;
}

export class RunHistoryReporter {
  private static get distRunsDir(): string {
    return path.resolve(process.cwd(), 'dist/runs');
  }

  private static get distApiDir(): string {
    return path.resolve(process.cwd(), 'dist/api');
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
    const consensusSummary = ConsensusPrioritizer.buildSummary(allResults);

    const latestPayload = {
      runId,
      generatedAt,
      profilePath,
      scanDurationMs: totalDurationMs,
      qualityIndex,
      targetQuality,
      providerAttributionTop,
      consensusSummary,
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
      consensusFailure: consensusSummary.consensusFailure,
      alfaOnlyFailure: consensusSummary.alfaOnlyFailure,
      axeOnlyFailure: consensusSummary.axeOnlyFailure,
      artifactPath
    };

    fs.writeFileSync(path.join(this.distRunsDir, `${runId}.json`), JSON.stringify(latestPayload, null, 2), 'utf8');
    fs.writeFileSync(path.join(this.distRunsDir, 'latest.json'), JSON.stringify(latestPayload, null, 2), 'utf8');
    fs.writeFileSync(
      path.join(this.distRunsDir, 'software-by-domain.json'),
      JSON.stringify(this.buildSoftwareByDomainPayload(allResults, runId, generatedAt), null, 2),
      'utf8'
    );

    const existingIndex = this.loadExistingIndex();
    const mergedRuns = [runEntry, ...existingIndex.runs.filter(run => run.runId !== runId)].slice(0, 200);

    const nextIndex: RunIndex = {
      updatedAt: generatedAt,
      latestRunId: runId,
      runs: mergedRuns
    };

    fs.writeFileSync(path.join(this.distRunsDir, 'index.json'), JSON.stringify(nextIndex, null, 2), 'utf8');
    const trendSummary = this.buildTrendSummary(nextIndex);
    fs.writeFileSync(
      path.join(this.distRunsDir, 'trends.json'),
      JSON.stringify(trendSummary, null, 2),
      'utf8'
    );
    this.writeApiInterface(nextIndex, latestPayload, targetQuality, trendSummary);
    fs.writeFileSync(
      path.join(this.distRunsDir, 'domain-ongoing.json'),
      JSON.stringify(this.buildDomainOngoingReports(nextIndex), null, 2),
      'utf8'
    );

    return runEntry;
  }

  private static writeApiInterface(
    index: RunIndex,
    latestPayload: {
      runId: string;
      generatedAt: string;
      profilePath: string;
      scanDurationMs: number;
      qualityIndex: QualityIndexResult;
      results: TargetScanResult[];
    },
    targetQuality: TargetQualityIndexEntry[],
    trendSummary: TrendSummary
  ): void {
    if (!fs.existsSync(this.distApiDir)) {
      fs.mkdirSync(this.distApiDir, { recursive: true });
    }

    const qualityByTarget = new Map(targetQuality.map(item => [String(item.targetId || ''), item]));

    const targets = latestPayload.results
      .map(result => {
        const pages = Array.isArray(result.pagesScanned) ? result.pagesScanned : [];
        const completedPages = pages.filter(page => page.status === 'COMPLETED').length;
        const timeoutPages = pages.filter(page => page.status === 'TIMEOUT').length;
        const skippedUnchangedPages = pages.filter(page => page.status === 'SKIPPED_UNCHANGED').length;
        const totalViolations = pages.reduce((sum, page) => sum + (page.liveAudits?.accessibilityViolations.length ?? 0), 0);
        const quality = qualityByTarget.get(String(result.targetId || ''));

        return {
          targetId: result.targetId,
          domain: result.domain,
          pagesScanned: pages.length,
          completedPages,
          timeoutPages,
          skippedUnchangedPages,
          totalViolations,
          quality: {
            score: typeof quality?.score === 'number' ? Number(quality.score.toFixed(2)) : null,
            gateStatus: quality?.gateStatus ?? null
          }
        };
      })
      .sort((a, b) => String(a.targetId || '').localeCompare(String(b.targetId || '')));

    const latestApi = {
      apiVersion: 'v1',
      generatedAt: latestPayload.generatedAt,
      run: {
        runId: latestPayload.runId,
        profilePath: latestPayload.profilePath,
        scanDurationMs: latestPayload.scanDurationMs,
        targetsScanned: latestPayload.results.length,
        pagesScanned: trendSummary.latest.pagesScanned,
        completedPages: latestPayload.results
          .flatMap(result => result.pagesScanned)
          .filter(page => page.status === 'COMPLETED').length,
        totalViolations: trendSummary.latest.totalViolations,
        qualityIndexScore: Number((latestPayload.qualityIndex.score ?? 0).toFixed(2)),
        qualityGateStatus: latestPayload.qualityIndex.gateStatus,
        consensus: trendSummary.latest.consensus,
        urlFreshness: trendSummary.latest.urlFreshness
      }
    };

    const runsApi = {
      apiVersion: 'v1',
      generatedAt: new Date().toISOString(),
      latestRunId: index.latestRunId,
      runs: index.runs.slice(0, 100)
    };

    const targetsApi = {
      apiVersion: 'v1',
      generatedAt: latestPayload.generatedAt,
      runId: latestPayload.runId,
      targets
    };

    const manifest = {
      apiVersion: 'v1',
      generatedAt: new Date().toISOString(),
      latestRunId: index.latestRunId,
      endpoints: {
        latest: 'api/latest.json',
        runs: 'api/runs.json',
        targets: 'api/targets.json',
        trendSummary: 'runs/trends.json',
        runIndex: 'runs/index.json',
        latestRawRun: 'runs/latest.json',
        softwareByDomain: 'runs/software-by-domain.json'
      }
    };

    fs.writeFileSync(path.join(this.distApiDir, 'latest.json'), JSON.stringify(latestApi, null, 2), 'utf8');
    fs.writeFileSync(path.join(this.distApiDir, 'runs.json'), JSON.stringify(runsApi, null, 2), 'utf8');
    fs.writeFileSync(path.join(this.distApiDir, 'targets.json'), JSON.stringify(targetsApi, null, 2), 'utf8');
    fs.writeFileSync(path.join(this.distApiDir, 'index.json'), JSON.stringify(manifest, null, 2), 'utf8');
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
          : 'WARNING',
      consensusFailure: typeof run.consensusFailure === 'number' ? run.consensusFailure : 0,
      alfaOnlyFailure: typeof run.alfaOnlyFailure === 'number' ? run.alfaOnlyFailure : 0,
      axeOnlyFailure: typeof run.axeOnlyFailure === 'number' ? run.axeOnlyFailure : 0
    };
  }

  private static buildSoftwareByDomainPayload(
    allResults: TargetScanResult[],
    runId: string,
    generatedAt: string
  ): SoftwareByDomainPayload {
    const aggregatedByDomain: SoftwareByDomainPayload['aggregatedByDomain'] = [];
    const detailedByDomain: SoftwareByDomainPayload['detailedByDomain'] = [];

    allResults.forEach(result => {
      const pages = Array.isArray(result.pagesScanned) ? result.pagesScanned : [];
      const technologyRollup = new Map<
        string,
        {
          name: string;
          categories: Set<string>;
          versions: Set<string>;
          urls: Set<string>;
        }
      >();

      const detailedPages = pages
        .map(page => {
          const technologies = Array.isArray(page.technologyStack) ? page.technologyStack : [];
          const normalizedTechnologies = technologies
            .map(tech => ({
              name: String(tech?.name || '').trim(),
              category: String(tech?.category || '').trim(),
              version: String(tech?.version || '').trim()
            }))
            .filter(tech => tech.name.length > 0);

          const pageUrl = String(page.url || '');
          normalizedTechnologies.forEach(tech => {
            const key = tech.name.toLowerCase();
            const existing = technologyRollup.get(key) || {
              name: tech.name,
              categories: new Set<string>(),
              versions: new Set<string>(),
              urls: new Set<string>()
            };

            if (tech.category) {
              existing.categories.add(tech.category);
            }
            if (tech.version) {
              existing.versions.add(tech.version);
            }
            if (pageUrl) {
              existing.urls.add(pageUrl);
            }

            technologyRollup.set(key, existing);
          });

          return {
            url: pageUrl,
            status: String(page.status || ''),
            timestamp: String(page.timestamp || ''),
            technologies: normalizedTechnologies
          };
        })
        .filter(page => page.technologies.length > 0)
        .sort((a, b) => a.url.localeCompare(b.url));

      aggregatedByDomain.push({
        targetId: String(result.targetId || ''),
        domain: String(result.domain || ''),
        technologiesDetected: technologyRollup.size,
        technologies: Array.from(technologyRollup.values())
          .map(tech => ({
            name: tech.name,
            categories: Array.from(tech.categories).sort((a, b) => a.localeCompare(b)),
            versions: Array.from(tech.versions).sort((a, b) => a.localeCompare(b)),
            urlCount: tech.urls.size
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
      });

      detailedByDomain.push({
        targetId: String(result.targetId || ''),
        domain: String(result.domain || ''),
        pages: detailedPages
      });
    });

    return {
      generatedAt,
      runId,
      aggregatedByDomain: aggregatedByDomain.sort((a, b) => a.targetId.localeCompare(b.targetId)),
      detailedByDomain: detailedByDomain.sort((a, b) => a.targetId.localeCompare(b.targetId))
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
        urlFreshness,
        consensus: this.readConsensusSummarySnapshot(latest)
      },
      deltaFromPrevious: previous
        ? {
            targetsScanned: latest.targetsScanned - previous.targetsScanned,
            pagesScanned: latest.pagesScanned - previous.pagesScanned,
            totalViolations: latest.totalViolations - previous.totalViolations,
            scanDurationMs: latest.scanDurationMs - previous.scanDurationMs,
            violationsPerPage: Number((latestViolationsPerPage - previousViolationsPerPage).toFixed(4)),
            qualityIndexScore: Number(((latest.qualityIndexScore ?? 0) - (previous.qualityIndexScore ?? 0)).toFixed(2)),
            consensusFailure: latest.consensusFailure - previous.consensusFailure,
            alfaOnlyFailure: latest.alfaOnlyFailure - previous.alfaOnlyFailure,
            axeOnlyFailure: latest.axeOnlyFailure - previous.axeOnlyFailure
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
        const hasVersionFailure = violations.some(violation => {
          const tags = (violation.impactedCriteria ?? []).map(t => String(t || '').toLowerCase());
          if (versionPrefix === 'wcag2') {
            // WCAG 2.0 only: match wcag2a/wcag2aa/wcag2aaa but NOT wcag21* or wcag22*
            return tags.some(t => t === 'wcag2a' || t === 'wcag2aa' || t === 'wcag2aaa');
          }
          return tags.some(t => t.startsWith(versionPrefix));
        });
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
        qualityIndexScore: 0,
        consensusFailure: 0,
        alfaOnlyFailure: 0,
        axeOnlyFailure: 0
      };
    }

    const totalPages = runs.reduce((sum, run) => sum + run.pagesScanned, 0);
    const totalViolations = runs.reduce((sum, run) => sum + run.totalViolations, 0);
    const totalDurationMs = runs.reduce((sum, run) => sum + run.scanDurationMs, 0);
    const totalConsensusFailure = runs.reduce((sum, run) => sum + (run.consensusFailure ?? 0), 0);
    const totalAlfaOnlyFailure = runs.reduce((sum, run) => sum + (run.alfaOnlyFailure ?? 0), 0);
    const totalAxeOnlyFailure = runs.reduce((sum, run) => sum + (run.axeOnlyFailure ?? 0), 0);

    return {
      pagesScanned: Number((totalPages / runs.length).toFixed(2)),
      totalViolations: Number((totalViolations / runs.length).toFixed(2)),
      scanDurationMs: Number((totalDurationMs / runs.length).toFixed(2)),
      violationsPerPage: totalPages > 0 ? Number((totalViolations / totalPages).toFixed(4)) : 0,
      qualityIndexScore: Number(
        (runs.reduce((sum, run) => sum + (run.qualityIndexScore ?? 0), 0) / runs.length).toFixed(2)
      ),
      consensusFailure: Number((totalConsensusFailure / runs.length).toFixed(2)),
      alfaOnlyFailure: Number((totalAlfaOnlyFailure / runs.length).toFixed(2)),
      axeOnlyFailure: Number((totalAxeOnlyFailure / runs.length).toFixed(2))
    };
  }

  private static readConsensusSummarySnapshot(run: RunEntry): ConsensusSummary {
    if (!run.artifactPath) {
      return {
        consensusFailure: run.consensusFailure ?? 0,
        alfaOnlyFailure: run.alfaOnlyFailure ?? 0,
        axeOnlyFailure: run.axeOnlyFailure ?? 0,
        totalCorrelatedFindings: (run.consensusFailure ?? 0) + (run.alfaOnlyFailure ?? 0) + (run.axeOnlyFailure ?? 0)
      };
    }

    const artifactFullPath = path.resolve(process.cwd(), 'dist', run.artifactPath);
    if (!fs.existsSync(artifactFullPath)) {
      return {
        consensusFailure: run.consensusFailure ?? 0,
        alfaOnlyFailure: run.alfaOnlyFailure ?? 0,
        axeOnlyFailure: run.axeOnlyFailure ?? 0,
        totalCorrelatedFindings: (run.consensusFailure ?? 0) + (run.alfaOnlyFailure ?? 0) + (run.axeOnlyFailure ?? 0)
      };
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(artifactFullPath, 'utf8')) as {
        consensusSummary?: ConsensusSummary;
      };

      const summary = parsed.consensusSummary;
      if (!summary) {
        throw new Error('Missing summary');
      }

      return {
        consensusFailure: typeof summary.consensusFailure === 'number' ? summary.consensusFailure : 0,
        alfaOnlyFailure: typeof summary.alfaOnlyFailure === 'number' ? summary.alfaOnlyFailure : 0,
        axeOnlyFailure: typeof summary.axeOnlyFailure === 'number' ? summary.axeOnlyFailure : 0,
        totalCorrelatedFindings: typeof summary.totalCorrelatedFindings === 'number'
          ? summary.totalCorrelatedFindings
          : 0
      };
    } catch {
      return {
        consensusFailure: run.consensusFailure ?? 0,
        alfaOnlyFailure: run.alfaOnlyFailure ?? 0,
        axeOnlyFailure: run.axeOnlyFailure ?? 0,
        totalCorrelatedFindings: (run.consensusFailure ?? 0) + (run.alfaOnlyFailure ?? 0) + (run.axeOnlyFailure ?? 0)
      };
    }
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

  // ---------------------------------------------------------------------------
  // CSV + flat-violations JSON exports
  // ---------------------------------------------------------------------------

  /**
   * Escapes a single CSV cell value: wraps in double-quotes if the value
   * contains commas, quotes, or newlines; internal quotes are doubled.
   */
  private static escapeCsvCell(value: unknown): string {
    const str = String(value ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }

    return str;
  }

  /**
   * Builds a CSV document with one row per scanned page.
   * Column layout is inspired by open-scans' report.csv format, adapted to the
   * fields that vital-core actually produces.
   */
  public static buildRunCsv(
    allResults: TargetScanResult[],
    runId: string,
    generatedAt: string
  ): string {
    const headers = [
      'run_id', 'generated_at',
      'target_id', 'domain',
      'url', 'status', 'timestamp',
      // Alfa
      'alfa_executed', 'alfa_findings', 'alfa_error',
      // axe
      'axe_executed', 'axe_violations', 'axe_violation_instances', 'axe_failed_rules', 'axe_error',
      // Lighthouse
      'lighthouse_performance', 'fcp_ms', 'lcp_ms', 'speed_index_ms',
      // Offline
      'overlay_detected', 'overlay_provider',
      'flesch_kincaid_grade', 'ambiguous_links', 'suspicious_alt_count',
      // Tech
      'tech_count', 'tech_stack',
      // Third-party
      'third_party_regression'
    ];

    const rows: string[] = [headers.join(',')];

    for (const result of allResults) {
      const targetId = String(result.targetId || '');
      const domain = String(result.domain || '');
      const pages = Array.isArray(result.pagesScanned) ? result.pagesScanned : [];

      for (const page of pages) {
        const alfa = page.alfaAudits;
        const live = page.liveAudits;
        const offline = page.offlineAudits;
        const lh = live?.lighthouse ?? null;

        const axeViolations = live ? live.accessibilityViolations.length : 0;
        const axeInstances = live
          ? live.accessibilityViolations.reduce((sum, v) => sum + (Array.isArray(v.instances) ? v.instances.length : 0), 0)
          : 0;
        const axeFailedRules = live
          ? live.accessibilityViolations.map(v => v.id).join(';')
          : '';

        const tech = Array.isArray(page.technologyStack) ? page.technologyStack : [];

        const cells = [
          runId, generatedAt,
          targetId, domain,
          page.url || '', page.status || '', page.timestamp || '',
          // Alfa
          alfa ? (alfa.executed ? 'true' : 'false') : 'false',
          alfa ? String(alfa.findingsCount ?? 0) : '0',
          alfa?.errorMessage || '',
          // axe
          live ? 'true' : 'false',
          String(axeViolations),
          String(axeInstances),
          axeFailedRules,
          '',  // axe_error — axe errors surface as page status=FAILED
          // Lighthouse
          lh?.performanceScore != null ? String(lh.performanceScore) : '',
          lh?.firstContentfulPaintMs != null ? String(lh.firstContentfulPaintMs) : '',
          lh?.largestContentfulPaintMs != null ? String(lh.largestContentfulPaintMs) : '',
          lh?.speedIndexMs != null ? String(lh.speedIndexMs) : '',
          // Offline
          offline?.overlayDetected?.found ? 'true' : 'false',
          offline?.overlayDetected?.provider || '',
          offline?.contentMetrics?.fleschKincaidGrade != null ? String(offline.contentMetrics.fleschKincaidGrade) : '',
          offline?.contentMetrics?.ambiguousLinkTextCount != null ? String(offline.contentMetrics.ambiguousLinkTextCount) : '',
          offline?.contentMetrics?.suspiciousAltTextCount != null ? String(offline.contentMetrics.suspiciousAltTextCount) : '',
          // Tech
          String(tech.length),
          tech.map(t => t.name).join(';'),
          // Third-party
          page.thirdPartyImpact?.regressionDetected ? 'true' : 'false'
        ].map(v => this.escapeCsvCell(v));

        rows.push(cells.join(','));
      }
    }

    return rows.join('\n') + '\n';
  }

  /**
   * Flat JSON array — one record per axe violation _instance_ (not per rule).
   * Useful for filtering, pivoting, and feeding into other tools.
   */
  public static buildViolationsFlatJson(
    allResults: TargetScanResult[],
    runId: string,
    generatedAt: string
  ): {
    generatedAt: string;
    runId: string;
    totalInstances: number;
    violations: Array<{
      run_id: string;
      target_id: string;
      domain: string;
      url: string;
      page_timestamp: string;
      engine: 'axe';
      rule_id: string;
      severity: string;
      wcag_criteria: string;
      description: string;
      help_url: string;
      instance_html: string;
      instance_target: string;
      failure_summary: string;
    }>;
  } {
    const violations: ReturnType<typeof this.buildViolationsFlatJson>['violations'] = [];

    for (const result of allResults) {
      const targetId = String(result.targetId || '');
      const domain = String(result.domain || '');
      const pages = Array.isArray(result.pagesScanned) ? result.pagesScanned : [];

      for (const page of pages) {
        const pageViolations = page.liveAudits?.accessibilityViolations ?? [];

        for (const violation of pageViolations) {
          const wcagCriteria = (violation.impactedCriteria ?? [])
            .filter(c => c.startsWith('wcag'))
            .join(';');

          for (const instance of (Array.isArray(violation.instances) ? violation.instances : [])) {
            violations.push({
              run_id: runId,
              target_id: targetId,
              domain,
              url: String(page.url || ''),
              page_timestamp: String(page.timestamp || ''),
              engine: 'axe',
              rule_id: violation.id,
              severity: violation.severity,
              wcag_criteria: wcagCriteria,
              description: violation.description,
              help_url: violation.helpUrl,
              instance_html: String(instance.html || ''),
              instance_target: Array.isArray(instance.target) ? instance.target.join(' ') : String(instance.target || ''),
              failure_summary: String(instance.failureSummary || '')
            });
          }
        }
      }
    }

    return { generatedAt, runId, totalInstances: violations.length, violations };
  }
}
