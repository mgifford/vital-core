import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { SUPPORTED_LOCALES } from './i18n.js';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const DESIGN_SYSTEMS = new Set(['none', 'cms-ds', 'uswds']);

// Mutable state (crawl progress, scan data, the built site) can be redirected
// to a persistent volume via VITAL_DATA_ROOT. This exists for the Hugging Face
// Docker deployment, whose container filesystem is wiped on every restart —
// pointing these at a mounted persistent disk (e.g. /data) keeps the crawl
// history append-only across restarts. Unset (GitHub Actions, local) keeps
// everything in the repo root exactly as before. `config` is always read from
// the repo (it is source, not state).
const DATA_ROOT = process.env.VITAL_DATA_ROOT
  ? path.resolve(process.env.VITAL_DATA_ROOT)
  : ROOT;

export const DIRS = {
  root: ROOT,
  config: path.join(ROOT, 'config'),
  state: path.join(DATA_ROOT, 'state'),
  data: path.join(DATA_ROOT, 'data'),
  docs: path.join(DATA_ROOT, 'docs'),
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
  // Localization: which languages each report is rendered in, and which one
  // gets the canonical (unsuffixed) file paths. Global default here; per-target
  // `languages` / `default_language` keys override.
  const globalLangs = resolveLanguages(cfg.languages, cfg.default_language, 'global config');
  // Whether the visible header language switcher is shown. The ?lang= /
  // localStorage runtime selection and per-language builds are independent of
  // this, so languages can be reachable by URL with no visible UI change.
  const globalShowSwitcher = cfg.language_switcher !== false;
  const targets = (cfg.targets ?? []).map((t) => ({ ...defaults, ...t }));
  for (const t of targets) {
    if (!t.domain) throw new Error('Every target needs a `domain` key.');
    t.reporting = { ...(defaults.reporting ?? {}), ...(t.reporting ?? {}) };
    t.key = domainKey(t.domain);
    const langs = resolveLanguages(t.languages, t.default_language, `target ${t.domain}`, globalLangs);
    t.languages = langs.languages;
    t.defaultLanguage = langs.defaultLanguage;
    t.showLanguageSwitcher = (t.language_switcher ?? cfg.language_switcher) !== false;
    if (t.design_system != null) {
      const ds = String(t.design_system).toLowerCase();
      if (!DESIGN_SYSTEMS.has(ds)) {
        throw new Error(`Unsupported design_system "${t.design_system}" in target ${t.domain}. Supported: ${[...DESIGN_SYSTEMS].join(', ')}.`);
      }
      t.design_system = ds;
    }
  }
  return {
    defaults,
    sampling,
    sustainabilityMetric,
    languages: globalLangs.languages,
    defaultLanguage: globalLangs.defaultLanguage,
    showLanguageSwitcher: globalShowSwitcher,
    targets,
  };
}

/**
 * Normalize and validate a languages list + default language, with a fallback
 * (used so per-target settings inherit the global default when unset). Every
 * locale must be supported, the list is de-duplicated, and the default must be
 * one of the listed languages. Returns { languages, defaultLanguage }.
 */
export function resolveLanguages(langsRaw, defaultRaw, where, fallback) {
  if (langsRaw == null && defaultRaw == null && fallback) return fallback;
  const languages = [...new Set(langsRaw ?? fallback?.languages ?? ['en'])];
  if (languages.length === 0) languages.push('en');
  for (const l of languages) {
    if (!SUPPORTED_LOCALES.includes(l)) {
      throw new Error(`Unsupported language "${l}" in ${where}. Supported: ${SUPPORTED_LOCALES.join(', ')}.`);
    }
  }
  const defaultLanguage = defaultRaw ?? fallback?.defaultLanguage ?? languages[0];
  if (!languages.includes(defaultLanguage)) {
    throw new Error(`default_language "${defaultLanguage}" in ${where} is not in its languages list [${languages.join(', ')}].`);
  }
  return { languages, defaultLanguage };
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

/**
 * Load a deployment profile from `config/profiles/<name>.yml`. A profile is a
 * *selection* over the targets registry plus report branding — it never
 * restates scan settings (see config/profiles/README.md). Returns `null` for
 * an unset/empty name, so callers can treat "no profile" as "full site,
 * default branding" (the GitHub Pages behavior, unchanged).
 */
export function loadProfile(name) {
  if (!name) return null;
  const file = path.join(DIRS.config, 'profiles', `${name}.yml`);
  if (!fs.existsSync(file)) {
    throw new Error(`No profile config/profiles/${name}.yml. See config/profiles/README.md.`);
  }
  const p = YAML.parse(fs.readFileSync(file, 'utf8')) ?? {};
  const keys = new Set((p.targets ?? []).map((t) => domainKey(t)));
  return {
    name: p.name ?? name,
    targetKeys: keys,
    branding: p.branding ?? {},
    reportBaseUrl: p.report_base_url || '',
  };
}

/**
 * Restrict a loaded config to a profile's selected targets. Returns the config
 * unchanged when `profile` is null. Never mutates input. A profile naming a
 * target absent from targets.yml is a config error worth failing loudly on.
 */
export function applyProfile(config, profile) {
  if (!profile) return config;
  const selected = config.targets.filter((t) => profile.targetKeys.has(t.key));
  const missing = [...profile.targetKeys].filter((k) => !config.targets.some((t) => t.key === k));
  if (missing.length) {
    throw new Error(`Profile "${profile.name}" names targets not in targets.yml: ${missing.join(', ')}`);
  }
  return { ...config, targets: selected, profile };
}
