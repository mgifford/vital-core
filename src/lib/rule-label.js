import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './config.js';
import { remediationTip } from './remediation.js';

let labels = null;
let alfaLabels = null;

function loadLabels() {
  if (labels) return labels;
  const p = path.join(DIRS.config, 'rule-labels.json');
  try {
    labels = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    labels = { axe: {}, alfa: {} };
  }
  return labels;
}

function loadAlfaLabels() {
  if (alfaLabels) return alfaLabels;
  const p = path.join(DIRS.config, 'alfa-rule-labels.json');
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    alfaLabels = raw;
  } catch {
    alfaLabels = {};
  }
  return alfaLabels;
}

function bucketFor(engineKey) {
  return engineKey === 'axe-core' ? 'axe' : engineKey;
}

/**
 * Human-readable label for a scanner rule.
 *
 * Priority order:
 *  1) explicit override in config/rule-labels.json
 *  2) Alfa static label database (config/alfa-rule-labels.json) for sia-r* rules
 *  3) engine help text (axe)
 *  4) remediation tip first sentence
 *  5) WCAG criterion name (if known)
 *  6) null (caller should fall back to rule id)
 */
export function rulePlainLabel(engineKey, ruleId, { help = null, wcag = null } = {}) {
  const labelsByEngine = loadLabels()[bucketFor(engineKey)] ?? {};
  if (labelsByEngine[ruleId]) return labelsByEngine[ruleId];

  if (engineKey === 'alfa') {
    const alfaTitle = loadAlfaLabels()[ruleId];
    if (alfaTitle) return alfaTitle;
  }

  if (help) return help;

  const tip = remediationTip(engineKey, ruleId);
  if (tip) {
    const firstSentence = String(tip).split('. ')[0].trim();
    if (firstSentence) return firstSentence;
  }

  if (wcag?.name) return wcag.name;
  return null;
}
