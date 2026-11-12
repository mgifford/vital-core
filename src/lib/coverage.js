/**
 * Plain-language scan coverage derived from existing weekly summary fields.
 *
 * It never invents an eligible-site total. The inventory count is an estimate
 * of known/scanned URLs, not an authoritative agency inventory.
 */
export function summarizeCoverage(summary, previous = null, inventory = null) {
  if (!summary) return null;
  const scanned = summary.pagesScanned ?? null;
  const audited = summary.pagesAudited ?? null;
  const attempted = summary.pagesAttempted ?? summary.access?.attempted ?? null;
  const succeeded = summary.pagesSucceeded ?? summary.access?.audited ?? null;
  const blocked = summary.access?.firewall?.pages ?? 0;
  const robotsSkipped = summary.access?.robots?.skipped ?? 0;
  const accessLevel = summary.access?.level ?? 'unknown';
  const engines = Object.entries(summary.coverage ?? {})
    .filter(([, pages]) => Number.isFinite(pages) && pages > 0)
    .map(([engine, pages]) => ({
      engine,
      pages,
      share: scanned ? Math.round((100 * pages) / scanned) : null,
    }))
    .sort((a, b) => b.pages - a.pages);
  const knownUrls = Number.isFinite(inventory?.totalKnownPages) ? inventory.totalKnownPages : null;
  const previousAudited = Number.isFinite(previous?.pagesAudited) ? previous.pagesAudited : null;
  const auditedDelta = audited != null && previousAudited != null ? audited - previousAudited : null;
  const auditedChangeShare = auditedDelta != null && previousAudited > 0
    ? Math.round((Math.abs(auditedDelta) / previousAudited) * 100)
    : null;
  const coverageChanged = auditedChangeShare != null && auditedChangeShare >= 20 && Math.abs(auditedDelta) >= 5;
  const skipped = attempted != null && audited != null ? Math.max(0, attempted - audited) : null;
  const notes = [];
  if (accessLevel === 'blocked') notes.push('The scanner was blocked or failed to load the site; this is not a clean result.');
  else if (accessLevel === 'partial') notes.push('Part of the site was blocked or skipped; coverage is incomplete.');
  if (blocked > 0) notes.push(`${blocked} page(s) were blocked by a firewall or refusal.`);
  if (robotsSkipped > 0) notes.push(`${robotsSkipped} URL(s) were skipped by robots.txt.`);
  if (skipped != null && skipped > 0) notes.push(`${skipped} attempted page(s) did not produce an audited page.`);
  if (coverageChanged) notes.push(`Audited pages changed ${auditedDelta > 0 ? '+' : ''}${auditedDelta} (${auditedChangeShare}%) from the previous week; week-to-week findings may reflect coverage, not remediation.`);
  return {
    access_level: accessLevel,
    pages_scanned: scanned,
    pages_audited: audited,
    pages_attempted: attempted,
    pages_succeeded: succeeded,
    pages_blocked: blocked,
    pages_skipped: skipped,
    robots_skipped: robotsSkipped,
    known_urls_estimate: knownUrls,
    known_urls_note: knownUrls != null ? 'Inventory estimate of known/scanned URLs; not an authoritative site inventory.' : 'Total eligible site size is unknown.',
    engines,
    previous_audited: previousAudited,
    audited_delta: auditedDelta,
    audited_change_share: auditedChangeShare,
    coverage_changed: coverageChanged,
    notes,
  };
}
