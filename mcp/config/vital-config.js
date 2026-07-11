import fs from 'node:fs';
import YAML from 'yaml';

const ENV_VAR_PATTERN = /\$\{([A-Z0-9_]+)\}/g;

// Substitution runs on the raw YAML text (before parsing) so values like
// `api: ${VITAL_API_URL}` never need quoting tricks. An unresolved reference
// is left as literal text and surfaced as a warning rather than throwing —
// the config may still be usable (e.g. the referenced var only matters for a
// later phase's fields).
export function substituteEnvVars(text) {
  const warnings = [];
  const substituted = text.replace(ENV_VAR_PATTERN, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(process.env, name)) {
      return process.env[name];
    }
    warnings.push(`Environment variable \${${name}} referenced in .vital.yml but not set; left as literal text.`);
    return match;
  });
  return { text: substituted, warnings };
}

// Pure validation/resolution over an already-parsed .vital.yml object.
// Returns only what the rest of the server needs — apiBase, domain, host,
// warnings — never the raw parsed object, so there is no accidental path for
// an unvalidated or secret-bearing field to reach a tool response.
export function resolveVitalConfig(raw) {
  if (raw?.version !== 1) {
    throw new Error(`.vital.yml: "version" must be 1 (got ${JSON.stringify(raw?.version)}).`);
  }
  const instance = raw.instance;
  if (!instance || typeof instance !== 'object') {
    throw new Error('.vital.yml: missing required "instance" section.');
  }
  const apiBase = instance.api;
  if (typeof apiBase !== 'string' || apiBase.trim() === '') {
    throw new Error('.vital.yml: "instance.api" must be a non-empty string.');
  }
  let apiUrl;
  try {
    apiUrl = new URL(apiBase);
  } catch {
    throw new Error(`.vital.yml: "instance.api" is not a valid URL: ${apiBase}`);
  }
  if (apiUrl.protocol !== 'https:') {
    throw new Error(`.vital.yml: "instance.api" must use https:// (got ${apiUrl.protocol}//).`);
  }
  const domain = instance.domain;
  if (typeof domain !== 'string' || domain.trim() === '') {
    throw new Error('.vital.yml: "instance.domain" must be a non-empty string.');
  }
  const apiBaseNormalized = apiBase.endsWith('/') ? apiBase : `${apiBase}/`;
  return {
    apiBase: apiBaseNormalized,
    domain,
    host: apiUrl.origin,
    warnings: [],
  };
}

export function parseVitalConfig(yamlText) {
  const { text, warnings: envWarnings } = substituteEnvVars(yamlText);
  let raw;
  try {
    raw = YAML.parse(text);
  } catch (err) {
    throw new Error(`.vital.yml: invalid YAML — ${err.message}`);
  }
  const resolved = resolveVitalConfig(raw);
  return { ...resolved, warnings: [...envWarnings, ...resolved.warnings] };
}

export function loadVitalConfig(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return parseVitalConfig(text);
}
