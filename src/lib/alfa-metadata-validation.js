import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './config.js';

function normalizeRuleId(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  return s.startsWith('sia-r') ? s : `sia-r${s}`;
}

function collectRuleIdsFromMapping(mapping) {
  const ids = new Set();
  for (const arr of Object.values(mapping.rules ?? {})) {
    for (const raw of arr ?? []) {
      const id = normalizeRuleId(raw);
      if (id) ids.add(id);
    }
  }
  return ids;
}

function collectRuleIdsFromInstalledMeta(installed) {
  const ids = new Set();
  for (const id of installed ?? []) {
    const normalized = normalizeRuleId(id.replace(/^r/i, ''));
    if (normalized) ids.add(normalized);
  }
  return ids;
}

export function validateAlfaMetadata({ labels, mapping, installedRuleIds }) {
  const errors = [];
  const warnings = [];

  const expected = {
    'sia-r111': { scs: ['2.5.5'], labelContains: '44×44' },
    'sia-r113': { scs: ['2.5.8'], labelContains: '24×24' },
    'sia-r66': { scs: ['1.4.6'], labelContains: 'enhanced contrast' },
    // sia-r54 declares no WCAG requirement in its own source (verified
    // against @siteimprove/alfa-rules 0.117.0); it is intentionally absent
    // from ALFA_RULE_METADATA_OVERRIDES and from alfa-wcag-rules.json.
    'sia-r54': { scs: [], labelContains: 'live region' },
    'sia-r70': { scs: [], labelContains: 'obsolete' },
    // sia-r50 (autoplaying audio) declares Criterion.of("1.4.2") in its own
    // source and is mapped via the regenerated alfa-wcag-rules.json, not
    // an override -- see ALFA_RULE_METADATA_OVERRIDES's comment in wcag.js.
    'sia-r50': { scs: ['1.4.2'], labelContains: 'audio' },
  };

  const ruleToScs = new Map();
  for (const [sc, ruleList] of Object.entries(mapping.rules ?? {})) {
    for (const raw of ruleList ?? []) {
      const id = normalizeRuleId(raw);
      if (!id) continue;
      const set = ruleToScs.get(id) ?? new Set();
      set.add(sc);
      ruleToScs.set(id, set);
    }
  }

  for (const [id, spec] of Object.entries(expected)) {
    const got = [...(ruleToScs.get(id) ?? new Set())].sort();
    const want = [...spec.scs].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      errors.push(`expected ${id} WCAG mapping ${JSON.stringify(want)} but found ${JSON.stringify(got)}`);
    }
    const label = String(labels[id] ?? '').toLowerCase();
    if (!label.includes(String(spec.labelContains).toLowerCase())) {
      errors.push(`expected ${id} label to include "${spec.labelContains}" but got "${labels[id] ?? ''}"`);
    }
  }

  const mappingIds = collectRuleIdsFromMapping(mapping);
  const labelIds = new Set(Object.keys(labels).filter((k) => k.startsWith('sia-r')));
  const installedIds = collectRuleIdsFromInstalledMeta(installedRuleIds);

  for (const id of mappingIds) {
    if (installedIds.size > 0 && !installedIds.has(id)) {
      warnings.push(`mapped rule ${id} not present in installed @siteimprove/alfa-rules inventory`);
    }
  }

  for (const id of mappingIds) {
    if (!labelIds.has(id)) {
      warnings.push(`mapped rule ${id} has no label entry in config/alfa-rule-labels.json`);
    }
  }

  return { errors, warnings };
}

export async function validateAlfaMetadataFromWorkspace() {
  const labelsPath = path.join(DIRS.config, 'alfa-rule-labels.json');
  const mappingPath = path.join(DIRS.root, 'src', 'data', 'alfa-wcag-rules.json');
  const labels = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));
  const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));

  let installedRuleIds = [];
  try {
    const alfa = await import('@siteimprove/alfa-rules');
    const all = [...alfa.Rules, ...Object.entries(alfa.deprecatedRules), ...Object.entries(alfa.experimentalRules)];
    installedRuleIds = all.map(([id]) => String(id));
  } catch {
    // If the package isn't available, keep validation focused on local metadata consistency.
  }

  return validateAlfaMetadata({ labels, mapping, installedRuleIds });
}
