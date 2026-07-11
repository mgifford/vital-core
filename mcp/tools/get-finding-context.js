import { resolveLatestWeek } from './shared.js';

// Returns the finding record verbatim from the /api/v1/ findings feed — no
// server-side enrichment or inference (spec.md FR-06). Remote text fields
// (rule_label, etc.) pass through as opaque data; nothing here interprets
// them (NFR-05).
export const getFindingContextTool = {
  name: 'vital_get_finding_context',
  description:
    "Return one finding's evidence record (severity, pages affected, trend, first/last seen) verbatim from the /api/v1/ findings feed, by finding_id.",
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
      throw new Error('vital_get_finding_context requires a "finding_id" string.');
    }
    const week = args.week ?? (await resolveLatestWeek(ctx));
    const doc = await ctx.apiClient.getFindings(ctx.config.domain, week);
    const finding = (doc.findings ?? []).find((f) => f.finding_id === args.finding_id);
    if (!finding) {
      return {
        found: false,
        finding_id: args.finding_id,
        week,
        message: `No finding "${args.finding_id}" in week ${week} for domain "${ctx.config.domain}".`,
      };
    }
    return { found: true, week, finding };
  },
};
