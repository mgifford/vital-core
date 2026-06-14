import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './config.js';

/**
 * Curated, plain-language fix tips keyed by engine rule id, loaded once
 * from config/remediation-tips.json. These supplement (not replace) the
 * engine's own help URL — a short "here's what to do" next to the
 * "here's the full reference" link. Unknown rules return null and the
 * report falls back to the help URL alone.
 *
 * Keyed by engine ('axe' | 'alfa') then rule id.
 */

let tips = null;

function load() {
  if (tips) return tips;
  const p = path.join(DIRS.config, 'remediation-tips.json');
  try {
    tips = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    tips = {};
  }
  return tips;
}

/**
 * Tip for a finding, or null. `engineKey` is the engine_key on a bug
 * report ('axe-core' | 'alfa' | 'deprecated-html'); we map axe-core ->
 * 'axe' for the lookup.
 */
export function remediationTip(engineKey, ruleId) {
  const t = load();
  const bucket = engineKey === 'axe-core' ? 'axe' : engineKey;
  return t[bucket]?.[ruleId] ?? null;
}
