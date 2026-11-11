/**
 * ARRM task/role lookup by WCAG success criterion.
 *
 * The bundled data is pinned to a W3C wai-arrm revision. It describes typical
 * task ownership; it is not an ownership assignment for a specific finding or
 * organization.
 */

import fs from 'node:fs';

const DATA = JSON.parse(fs.readFileSync(new URL('../data/arrm-tasks.json', import.meta.url), 'utf8'));
const BY_SC = new Map();
for (const task of DATA.tasks) {
  if (!BY_SC.has(task.wcag_sc)) BY_SC.set(task.wcag_sc, []);
  BY_SC.get(task.wcag_sc).push(task);
}

export const ARRM_SOURCE = Object.freeze(DATA.source);
export const ARRM_ROLES = Object.freeze([...new Set(DATA.tasks.flatMap((task) => task.primary))].sort());

export function arrmForWcag(sc) {
  if (!sc) return { tasks: [], roles: [] };
  const tasks = BY_SC.get(String(sc)) ?? [];
  const roles = [...new Set(tasks.flatMap((task) => task.primary))].sort();
  return { tasks, roles };
}

export function arrmForBug(bug) {
  return arrmForWcag(bug?.wcag_sc);
}

export function arrmSource() {
  return { ...ARRM_SOURCE };
}
