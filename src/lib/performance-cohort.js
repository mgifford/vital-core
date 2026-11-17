/**
 * Stable performance monitoring cohort.
 *
 * The weekly hash sample is deliberately different each week, which is good
 * for discovery but not for matched-page performance trends. This selector
 * marks a bounded, persistent set of pages (homepage, priority URLs and one
 * representative per declared page family) so those pages are prioritised in
 * the frontier and receive Lighthouse even when the weekly hash would skip
 * them. It never adds a page visit: the existing batch and weekly cap still
 * decide what is scanned.
 */

import { routeMatches } from './page-families.js';
import { pageId } from './urls.js';

export const MAX_STABLE_COHORT = 12;

export function selectStablePerformanceCohort(state, target, siteOrigin) {
  const families = target.pageFamilies ?? [];
  const pages = Object.entries(state.pages ?? {});
  const byId = new Map(pages);
  const selected = new Set();
  const reasons = new Map();
  const choose = (id, reason) => {
    if (!id || !byId.has(id) || selected.has(id)) return false;
    selected.add(id);
    reasons.set(id, reason);
    return true;
  };

  // Preserve an existing stable selection before adding new pages. This keeps
  // a family representative stable across weeks.
  for (const [id, page] of pages) {
    if (page.performanceCohort?.stable) choose(id, page.performanceCohort.reason ?? 'existing');
  }

  // Homepage and configured top tasks are always stable where present.
  try {
    choose(pageId(siteOrigin + '/'), 'homepage');
  } catch { /* invalid origin: leave selection to state */ }
  for (const [id, page] of pages) {
    if (page.priority) choose(id, 'priority-url');
  }

  // One representative per declared family. Prefer the existing stable member
  // for that family; otherwise choose the lowest stable page id.
  for (const family of families) {
    if (pages.some(([id, page]) => selected.has(id) && page.performanceCohort?.family === family.id)) continue;
    const candidates = pages
      .filter(([id, page]) => !selected.has(id) && matchesFamily(page.url, family))
      .map(([id, page]) => ({ id, page }))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!candidates.length) continue;
    choose(candidates[0].id, `page-family:${family.id}`);
    state.pages[candidates[0].id].performanceCohort = { stable: true, reason: `page-family:${family.id}`, family: family.id };
  }

  // Apply the bounded selection. Priority/homepage are never dropped; family
  // representatives are capped only after those are included.
  const ordered = [...selected].filter((id) => byId.has(id));
  const priority = ordered.filter((id) => byId.get(id).priority);
  const home = ordered.filter((id) => reasons.get(id) === 'homepage');
  const rest = ordered.filter((id) => !priority.includes(id) && !home.includes(id))
    .slice(0, Math.max(0, MAX_STABLE_COHORT - priority.length - home.length));
  const final = [...new Set([...priority, ...home, ...rest])];

  for (const [id, page] of pages) {
    const reason = final.includes(id) ? reasons.get(id) : null;
    if (reason) {
      const family = families.find((candidate) => matchesFamily(page.url, candidate) && reason === `page-family:${candidate.id}`)?.id;
      page.performanceCohort = { stable: true, reason, ...(family ? { family } : {}) };
    } else if (page.performanceCohort?.stable && !final.includes(id)) {
      delete page.performanceCohort;
    }
  }
  return {
    stable: final.map((id) => ({ id, url: byId.get(id).url, reason: reasons.get(id) })),
    familiesRepresented: families.filter((family) => final.some((id) => byId.get(id).performanceCohort?.family === family.id)).map((family) => family.id),
    max: MAX_STABLE_COHORT,
  };
}

function matchesFamily(url, family) {
  try { return routeMatches(family.route, new URL(url).pathname); } catch { return false; }
}
