import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './config.js';

/**
 * W3C ACT (Accessibility Conformance Testing) rule mapping. Both axe and
 * Alfa implement ACT rules, so the *same* underlying issue is often
 * reported by both under different rule ids (e.g. axe "image-alt" and
 * Alfa "sia-r2" are both ACT rule 23a2a8). Mapping rule ids to their ACT
 * rule lets us consolidate: count a real issue once, while still showing
 * that both engines agree on it.
 *
 * Data: src/data/act-mapping.json, generated from the upstream ACT
 * implementation reports (dequelabs/act-reports-axe and the alfa ACT
 * report). Regenerate with scripts/update-act-mapping.mjs.
 */

let mapping = null;

function load() {
  if (mapping) return mapping;
  const p = path.join(DIRS.root, 'src', 'data', 'act-mapping.json');
  try {
    mapping = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    mapping = { byActRuleId: {}, axeRuleToActIds: {}, alfaRuleToActIds: {} };
  }
  return mapping;
}

/**
 * The ACT rule id(s) an engine rule maps to, or [] if unmapped.
 *   engineKey: 'axe-core' | 'alfa'
 */
export function actRuleIdsFor(engineKey, ruleId) {
  const m = load();
  if (engineKey === 'axe-core') return m.axeRuleToActIds[ruleId] ?? [];
  if (engineKey === 'alfa') return m.alfaRuleToActIds[ruleId] ?? [];
  return [];
}

/**
 * A canonical key for correlating findings across engines. When a rule
 * maps to an ACT rule, use "act:<id>" so axe and Alfa rules for the same
 * ACT rule collide. Otherwise fall back to the engine's own rule id so
 * unmapped rules stay distinct (never wrongly merged).
 */
export function canonicalRuleKey(engineKey, ruleId) {
  const act = actRuleIdsFor(engineKey, ruleId);
  return act.length ? `act:${act[0]}` : `${engineKey}:${ruleId}`;
}
