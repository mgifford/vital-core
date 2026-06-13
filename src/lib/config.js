import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);

export const DIRS = {
  root: ROOT,
  config: path.join(ROOT, 'config'),
  state: path.join(ROOT, 'state'),
  data: path.join(ROOT, 'data'),
  docs: path.join(ROOT, 'docs'),
};

export function loadConfig() {
  const raw = fs.readFileSync(path.join(DIRS.config, 'targets.yml'), 'utf8');
  const cfg = YAML.parse(raw);
  const defaults = cfg.defaults ?? {};
  // Per-engine weekly sampling rates live at the top level so a target
  // can override individual rates without restating the whole block
  // (ratesFor merges these defaults with target.sampling).
  const sampling = cfg.sampling ?? {};
  // Report display preference: 'co2' (default) or 'energy'.
  const sustainabilityMetric = cfg.sustainability_metric === 'energy' ? 'energy' : 'co2';
  const targets = (cfg.targets ?? []).map((t) => ({ ...defaults, ...t }));
  for (const t of targets) {
    if (!t.domain) throw new Error('Every target needs a `domain` key.');
    t.key = domainKey(t.domain);
  }
  return { defaults, sampling, sustainabilityMetric, targets };
}

/** Filesystem-safe identifier for a domain. Stable across runs. */
export function domainKey(domain) {
  return domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '').replace(/[^a-z0-9.-]/g, '_');
}

export function getTarget(config, domainOrKey) {
  const k = domainKey(domainOrKey);
  const t = config.targets.find((t) => t.key === k || t.domain === domainOrKey);
  if (!t) throw new Error(`No target configured for "${domainOrKey}". Add it to config/targets.yml.`);
  return t;
}
