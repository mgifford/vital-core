// Shared by the findings-reading tools so "default to the latest week" has
// one implementation.
export async function resolveLatestWeek(ctx) {
  const snapshot = await ctx.apiClient.getSnapshot(ctx.config.domain);
  if (!snapshot?.latest_week) {
    throw new Error(`No "latest_week" in the snapshot for domain "${ctx.config.domain}".`);
  }
  return snapshot.latest_week;
}

// Shared by every tool that looks up a single finding by id, so there is
// one fetch-by-id implementation (used by get-finding-context.js and
// find-probable-sources.js).
export async function fetchFindingById(ctx, findingId, week) {
  const doc = await ctx.apiClient.getFindings(ctx.config.domain, week);
  return (doc.findings ?? []).find((f) => f.finding_id === findingId);
}
