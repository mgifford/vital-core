// Shared by the findings-reading tools so "default to the latest week" has
// one implementation.
export async function resolveLatestWeek(ctx) {
  const snapshot = await ctx.apiClient.getSnapshot(ctx.config.domain);
  if (!snapshot?.latest_week) {
    throw new Error(`No "latest_week" in the snapshot for domain "${ctx.config.domain}".`);
  }
  return snapshot.latest_week;
}
