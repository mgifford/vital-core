import { resolveLatestWeek } from './shared.js';

const SEVERITIES = ['Critical', 'Serious', 'Moderate', 'Minor'];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Static tool definition (spec.md NFR-04); handler sources data only from
// the already host-restricted ctx.apiClient (FR-07, FR-08).
export const listFindingsTool = {
  name: 'vital_list_findings',
  description:
    'List findings for the configured domain from the /api/v1/ findings feed, filtered and sorted by pages affected (not raw instance count).',
  inputSchema: {
    type: 'object',
    properties: {
      severity: {
        type: 'array',
        items: { type: 'string', enum: SEVERITIES },
        description: 'Restrict to these axe-core severities.',
      },
      min_pages_affected: {
        type: 'integer',
        minimum: 0,
        description: 'Only findings affecting at least this many pages.',
      },
      rule_id: {
        type: 'string',
        description: 'Restrict to one engine rule id (e.g. color-contrast).',
      },
      week: {
        type: 'string',
        description: "ISO week (YYYY-Www). Defaults to the domain's latest available week.",
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_LIMIT,
        description: `Max findings to return (default ${DEFAULT_LIMIT}, capped at ${MAX_LIMIT}).`,
      },
    },
    additionalProperties: false,
  },
  async handler(args = {}, ctx) {
    if (args.severity) {
      for (const s of args.severity) {
        if (!SEVERITIES.includes(s)) {
          throw new Error(`vital_list_findings: unknown severity "${s}". Expected one of ${SEVERITIES.join(', ')}.`);
        }
      }
    }
    const week = args.week ?? (await resolveLatestWeek(ctx));
    const doc = await ctx.apiClient.getFindings(ctx.config.domain, week);
    let findings = doc.findings ?? [];

    if (args.severity?.length) {
      const wanted = new Set(args.severity);
      findings = findings.filter((f) => wanted.has(f.severity));
    }
    if (typeof args.min_pages_affected === 'number') {
      findings = findings.filter((f) => f.pages_affected >= args.min_pages_affected);
    }
    if (args.rule_id) {
      findings = findings.filter((f) => f.rule_id === args.rule_id);
    }

    findings = [...findings].sort((a, b) => b.pages_affected - a.pages_affected);

    const totalMatched = findings.length;
    const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const truncated = totalMatched > limit;

    return {
      week,
      total_matched: totalMatched,
      returned: Math.min(totalMatched, limit),
      truncated,
      findings: findings.slice(0, limit),
    };
  },
};
