const SC_LABELS = {
  '1.1.1': 'Non-text Content (images, icons)',
  '1.3.1': 'Info and Relationships (semantic structure)',
  '1.3.2': 'Meaningful Sequence',
  '1.3.3': 'Sensory Characteristics',
  '1.4.1': 'Use of Color',
  '1.4.2': 'Audio Control',
  '1.4.3': 'Contrast (Minimum)',
  '1.4.4': 'Resize Text',
  '1.4.5': 'Images of Text',
  '1.4.10': 'Reflow',
  '1.4.11': 'Non-text Contrast',
  '1.4.12': 'Text Spacing',
  '2.1.1': 'Keyboard Access',
  '2.1.2': 'No Keyboard Trap',
  '2.4.1': 'Bypass Blocks (skip links)',
  '2.4.2': 'Page Titled',
  '2.4.3': 'Focus Order',
  '2.4.4': 'Link Purpose',
  '2.4.6': 'Headings and Labels',
  '2.4.7': 'Focus Visible',
  '2.4.11': 'Focus Appearance',
  '3.1.1': 'Language of Page',
  '3.1.2': 'Language of Parts',
  '3.3.1': 'Error Identification',
  '3.3.2': 'Labels or Instructions',
  '4.1.1': 'Parsing (HTML validity)',
  '4.1.2': 'Name, Role, Value (ARIA)',
  '4.1.3': 'Status Messages',
};

/**
 * Groups bugs by WCAG SC, sums pages_affected, and returns the top 5 SCs
 * ranked by total pages affected. Sets component_inconsistency: true when
 * 3+ distinct rule_ids fire the same SC and each appears on >= 5 pages.
 */
export function computeTrainingPriorities(bugs) {
  const bysc = new Map();

  for (const b of bugs) {
    const sc = b.wcag_sc;
    if (!sc) continue;
    if (!bysc.has(sc)) bysc.set(sc, { wcag_sc: sc, total_pages: 0, rules: new Map() });
    const entry = bysc.get(sc);
    entry.total_pages += b.frequency.pages_affected;
    entry.rules.set(b.rule_id, (entry.rules.get(b.rule_id) ?? 0) + b.frequency.pages_affected);
  }

  return [...bysc.values()]
    .sort((a, b) => b.total_pages - a.total_pages)
    .slice(0, 5)
    .map(({ wcag_sc, total_pages, rules }) => {
      const ruleEntries = [...rules.entries()];
      const ruleIds = ruleEntries.map(([id]) => id);
      const component_inconsistency =
        ruleIds.length >= 3 && ruleEntries.every(([, pages]) => pages >= 5);
      return {
        wcag_sc,
        label: SC_LABELS[wcag_sc] ?? `WCAG ${wcag_sc}`,
        total_pages,
        rule_count: ruleIds.length,
        rules: ruleIds,
        component_inconsistency,
      };
    });
}
