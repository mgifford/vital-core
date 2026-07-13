import { resolveLatestWeek, fetchFindingById } from './shared.js';
import { extractSignals } from '../local/signals.js';
import { searchForSignals } from '../local/search.js';

export const findProbableSourcesTool = {
  name: 'vital_find_probable_sources',
  description:
    'Search the local repository checkout for files that probably produced a finding\'s rendered output. ' +
    'Returns ranked candidates with a confidence tier (high/medium/low) and the specific matched signals — ' +
    'this is a probabilistic estimate, NOT certain attribution; multiple candidates or low confidence are ' +
    'normal and expected, verify manually before assuming a result is correct. ' +
    'Requires "permissions.read_repository: true" and "local.repository_path" in .vital.yml; ' +
    'returns a permission-disabled refusal otherwise.',
  inputSchema: {
    type: 'object',
    properties: {
      finding_id: {
        type: 'string',
        description: 'The VS-<hash> finding identifier, as returned by vital_list_findings.',
      },
      week: {
        type: 'string',
        description: "ISO week (YYYY-Www). Defaults to the domain's latest available week.",
      },
    },
    required: ['finding_id'],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    if (!args?.finding_id || typeof args.finding_id !== 'string') {
      throw new Error('vital_find_probable_sources requires a "finding_id" string.');
    }
    if (!ctx.config.readRepository) {
      return {
        found: false,
        reason: 'permission_disabled',
        message: 'Local repository search is disabled. Set "permissions.read_repository: true" and "local.repository_path" in .vital.yml to enable vital_find_probable_sources.',
      };
    }

    const week = args.week ?? (await resolveLatestWeek(ctx));
    const finding = await fetchFindingById(ctx, args.finding_id, week);
    if (!finding) {
      return {
        found: false,
        reason: 'finding_not_found',
        finding_id: args.finding_id,
        week,
        message: `No finding "${args.finding_id}" in week ${week} for domain "${ctx.config.domain}".`,
      };
    }

    const signals = extractSignals(finding);
    const candidates = searchForSignals(ctx.config.repositoryPath, signals, {
      ignorePatterns: ctx.config.ignorePatterns,
    });

    return {
      found: true,
      finding_id: args.finding_id,
      week,
      signal_count: signals.length,
      candidate_count: candidates.length,
      candidates,
    };
  },
};
