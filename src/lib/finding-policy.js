import { alfaRuleMetadata } from './wcag.js';

// Vocabulary matches ACCESSIBILITY.md finding schema 2.1's policy
// classification (obligation / handling) -- see
// https://mgifford.github.io/ACCESSIBILITY.md/examples/ACCESSIBILITY_FINDING_TRACKING.html#policy-classification.
// 'not-applicable' is reviewed-and-does-not-apply, distinct from 'unmapped'
// (no authoritative obligation established yet); it is only ever assigned
// by an explicit policy rule (see selectRule), never by classifyBaseLane,
// because determining non-applicability requires a human decision this
// module cannot make on its own.
export const POLICY_OBLIGATIONS = new Set(['required', 'aspirational', 'advisory', 'unmapped', 'not-applicable']);
export const POLICY_HANDLINGS = new Set(['report', 'review', 'suppress']);
export const KNOWN_POLICY_ENGINES = new Set(['axe-core', 'alfa', 'deprecated-html']);

export const DEFAULT_FINDING_POLICY = {
  conformance: {
    standard: 'WCAG',
    version: '2.2',
    level: 'AA',
  },
  defaults: {
    wcag_a_aa: { obligation: 'required', handling: 'report' },
    // A confirmed AAA finding under an AA (or lower) target is a visible,
    // non-blocking stretch goal, not an arbitrary best-practice suggestion.
    // See ACCESSIBILITY_FINDING_TRACKING.md, "Policy Classification": AAA
    // criteria under an AA target must normally be aspirational, not
    // advisory. A project may elevate a specific AAA criterion to
    // 'required' via finding_policy.rules.
    wcag_aaa: { obligation: 'aspirational', handling: 'report' },
    best_practice: { obligation: 'advisory', handling: 'report' },
    not_required_for_conformance: { obligation: 'advisory', handling: 'report' },
    unmapped: { obligation: 'unmapped', handling: 'review' },
  },
  rules: [],
};

const LEVEL_ORDER = { A: 1, AA: 2, AAA: 3 };

function parseDate(dateText) {
  if (!dateText) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText))) return null;
  const d = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function normalizeVersion(v) {
  const n = String(v ?? '').trim();
  return /^2\.[0-9]+$/.test(n) ? n : null;
}

function versionToNumber(v) {
  return Number.parseFloat(v);
}

function supportsMatcherKey(match) {
  return !!(
    match.engine ||
    match.rule_id ||
    match.wcag_sc ||
    match.wcag_level ||
    match.wcag_version ||
    match.url_patterns ||
    match.pattern_id
  );
}

function compileUrlPattern(pattern) {
  const str = String(pattern ?? '');
  const m = /^\/(.+)\/([a-z]*)$/i.exec(str);
  if (m) {
    return new RegExp(m[1], m[2]);
  }
  return null;
}

function normalizeRule(rule, source) {
  const out = {
    ...rule,
    source,
    match: { ...(rule.match ?? {}) },
    evidence: Array.isArray(rule.evidence) ? [...rule.evidence] : [],
  };
  if (Array.isArray(out.match.url_patterns)) {
    out.match.url_patterns = out.match.url_patterns.map((p) => String(p));
  }
  if (out.match.engine) out.match.engine = String(out.match.engine);
  if (out.match.rule_id) out.match.rule_id = String(out.match.rule_id).toLowerCase();
  if (out.match.pattern_id) out.match.pattern_id = String(out.match.pattern_id);
  if (out.match.wcag_sc) out.match.wcag_sc = String(out.match.wcag_sc);
  if (out.match.wcag_level) out.match.wcag_level = String(out.match.wcag_level).toUpperCase();
  if (out.match.wcag_version) out.match.wcag_version = String(out.match.wcag_version);
  return out;
}

function rulePrecedence(rule) {
  const hasEngineRule = !!(rule.match.engine && rule.match.rule_id);
  const hasUrl = Array.isArray(rule.match.url_patterns) && rule.match.url_patterns.length > 0;
  if (hasEngineRule && hasUrl) return 500;
  if (hasEngineRule) return 400;
  if (rule.match.pattern_id) return 350;
  if (rule.match.wcag_sc) return 300;
  return 200;
}

function canonicalSignature(rule) {
  const m = rule.match;
  const urls = Array.isArray(m.url_patterns) ? [...m.url_patterns].sort() : [];
  return JSON.stringify({
    engine: m.engine ?? null,
    rule_id: m.rule_id ?? null,
    wcag_sc: m.wcag_sc ?? null,
    wcag_level: m.wcag_level ?? null,
    wcag_version: m.wcag_version ?? null,
    pattern_id: m.pattern_id ?? null,
    url_patterns: urls,
    precedence: rulePrecedence(rule),
  });
}

export function mergeFindingPolicy(globalPolicyRaw = {}, targetPolicyRaw = {}) {
  const globalPolicy = globalPolicyRaw ?? {};
  const targetPolicy = targetPolicyRaw ?? {};
  return {
    conformance: {
      ...DEFAULT_FINDING_POLICY.conformance,
      ...(globalPolicy.conformance ?? {}),
      ...(targetPolicy.conformance ?? {}),
    },
    defaults: {
      ...DEFAULT_FINDING_POLICY.defaults,
      ...(globalPolicy.defaults ?? {}),
      ...(targetPolicy.defaults ?? {}),
    },
    rules: [
      ...((globalPolicy.rules ?? []).map((r) => normalizeRule(r, 'global'))),
      ...((targetPolicy.rules ?? []).map((r) => normalizeRule(r, 'target'))),
    ],
  };
}

export function validateFindingPolicy(policy, { scope = 'config', knownRuleIds = null } = {}) {
  const errors = [];
  const warnings = [];
  const seen = new Map();
  const now = new Date();

  const version = normalizeVersion(policy.conformance?.version ?? DEFAULT_FINDING_POLICY.conformance.version);
  if (!version) {
    errors.push(`${scope}: finding_policy.conformance.version must look like 2.0, 2.1, or 2.2`);
  }
  const level = String(policy.conformance?.level ?? DEFAULT_FINDING_POLICY.conformance.level).toUpperCase();
  if (!LEVEL_ORDER[level]) {
    errors.push(`${scope}: finding_policy.conformance.level must be A, AA, or AAA`);
  }

  for (const [name, lane] of Object.entries(policy.defaults ?? {})) {
    if (!POLICY_OBLIGATIONS.has(lane?.obligation)) {
      errors.push(`${scope}: finding_policy.defaults.${name}.obligation is invalid`);
    }
    if (!POLICY_HANDLINGS.has(lane?.handling)) {
      errors.push(`${scope}: finding_policy.defaults.${name}.handling is invalid`);
    }
  }

  (policy.rules ?? []).forEach((rule, idx) => {
    const where = `${scope}: finding_policy.rules[${idx}]`;
    if (!POLICY_OBLIGATIONS.has(rule.obligation)) {
      errors.push(`${where} has unknown obligation "${rule.obligation}"`);
    }
    if (!POLICY_HANDLINGS.has(rule.handling)) {
      errors.push(`${where} has unknown handling "${rule.handling}"`);
    }
    if (rule.handling === 'suppress') {
      // A scoped suppression record requires a reason, supporting evidence,
      // an accountable owner, and a review/expiry date -- see
      // ACCESSIBILITY_FINDING_TRACKING.md, "Policy Classification": suppression
      // requires narrow scope, reason, evidence, owner, and review or expiry
      // date. The matcher itself (checked by supportsMatcherKey below) is
      // the "narrow scope" requirement.
      if (!String(rule.reason ?? '').trim()) {
        errors.push(`${where} uses handling:suppress but has no reason`);
      }
      if (!Array.isArray(rule.evidence) || rule.evidence.length === 0 || !rule.evidence.some((e) => String(e ?? '').trim())) {
        errors.push(`${where} uses handling:suppress but has no evidence`);
      }
      if (!String(rule.owner ?? '').trim()) {
        errors.push(`${where} uses handling:suppress but has no owner`);
      }
      if (!rule.expires) {
        errors.push(`${where} uses handling:suppress but has no expires (review or expiry date)`);
      }
    }
    if (!supportsMatcherKey(rule.match ?? {})) {
      errors.push(`${where} must include at least one matcher key`);
    }
    if (rule.match?.engine && !KNOWN_POLICY_ENGINES.has(rule.match.engine)) {
      errors.push(`${where} references unknown engine "${rule.match.engine}"`);
    }
    for (const p of rule.match?.url_patterns ?? []) {
      const s = String(p);
      if (/^\/.+\/[a-z]*$/i.test(s)) {
        try {
          compileUrlPattern(s);
        } catch {
          errors.push(`${where} has malformed regular expression url pattern "${s}"`);
        }
      }
    }
    if (rule.expires != null) {
      const expires = parseDate(rule.expires);
      if (!expires) {
        errors.push(`${where} has invalid expires date "${rule.expires}"; expected YYYY-MM-DD`);
      } else if (expires < now) {
        warnings.push(`${where} is expired (${rule.expires}) and will be skipped`);
      }
    }
    if (rule.match?.wcag_version && !normalizeVersion(rule.match.wcag_version)) {
      errors.push(`${where} has invalid wcag_version "${rule.match.wcag_version}"`);
    }
    if (rule.match?.wcag_level && !LEVEL_ORDER[String(rule.match.wcag_level).toUpperCase()]) {
      errors.push(`${where} has invalid wcag_level "${rule.match.wcag_level}"`);
    }
    if (knownRuleIds && rule.match?.rule_id && !knownRuleIds.has(rule.match.rule_id)) {
      warnings.push(`${where} references unknown rule_id "${rule.match.rule_id}"`);
    }

    const signature = canonicalSignature(rule);
    const prior = seen.get(signature);
    if (prior) {
      const changed = prior.obligation !== rule.obligation || prior.handling !== rule.handling;
      if (changed) {
        errors.push(`${where} conflicts with finding_policy.rules[${prior.index}] at equal specificity`);
      }
    } else {
      seen.set(signature, { index: idx, obligation: rule.obligation, handling: rule.handling });
    }
  });

  return { errors, warnings };
}

function classifyBaseLane(policy, bug) {
  if (bug.engine_key === 'axe-core' && bug.wcag_category === 'Best Practice' && !bug.wcag_sc) {
    return 'best_practice';
  }

  if (bug.engine_key === 'alfa') {
    const alfaMeta = alfaRuleMetadata(bug.rule_id);
    if (alfaMeta.notRequiredForConformance) return 'not_required_for_conformance';
  }

  if (bug.wcag_level && bug.wcag_version) {
    if (bug.wcag_level === 'AAA') return 'wcag_aaa';

    const targetVersion = normalizeVersion(policy.conformance?.version) ?? DEFAULT_FINDING_POLICY.conformance.version;
    const targetLevel = String(policy.conformance?.level ?? DEFAULT_FINDING_POLICY.conformance.level).toUpperCase();
    const withinVersion = versionToNumber(bug.wcag_version) <= versionToNumber(targetVersion);
    const withinLevel = LEVEL_ORDER[String(bug.wcag_level).toUpperCase()] <= LEVEL_ORDER[targetLevel];
    if (withinVersion && withinLevel) return 'wcag_a_aa';
    return 'wcag_aaa';
  }

  return 'unmapped';
}

function matchesUrlPatterns(bug, patterns) {
  const urls = new Set([bug.url, ...(bug.affected_pages ?? [])]);
  for (const pattern of patterns ?? []) {
    const regex = compileUrlPattern(pattern);
    if (regex) {
      for (const url of urls) if (regex.test(String(url))) return true;
      continue;
    }
    const needle = String(pattern).toLowerCase();
    for (const url of urls) {
      if (String(url).toLowerCase().includes(needle)) return true;
    }
  }
  return false;
}

function ruleMatchesBug(rule, bug) {
  const m = rule.match ?? {};
  if (m.engine && m.engine !== bug.engine_key) return false;
  if (m.rule_id && m.rule_id !== String(bug.rule_id).toLowerCase()) return false;
  if (m.pattern_id && m.pattern_id !== bug.pattern_id) return false;
  if (m.wcag_sc && m.wcag_sc !== bug.wcag_sc) return false;
  if (m.wcag_level && String(m.wcag_level).toUpperCase() !== String(bug.wcag_level ?? '').toUpperCase()) return false;
  if (m.wcag_version && String(m.wcag_version) !== String(bug.wcag_version ?? '')) return false;
  if (Array.isArray(m.url_patterns) && m.url_patterns.length > 0 && !matchesUrlPatterns(bug, m.url_patterns)) return false;

  if (rule.expires) {
    const expires = parseDate(rule.expires);
    if (expires && expires < new Date()) return false;
  }

  return true;
}

function selectRule(rules, bug) {
  const matches = rules
    .filter((r) => ruleMatchesBug(r, bug))
    .map((r) => ({ ...r, precedence: rulePrecedence(r) }))
    .sort((a, b) => b.precedence - a.precedence);

  if (!matches.length) return null;
  const top = matches[0];
  const conflicting = matches.filter((m) => m.precedence === top.precedence && (m.obligation !== top.obligation || m.handling !== top.handling));
  if (conflicting.length > 0) {
    const ids = conflicting.map((r) => JSON.stringify(r.match)).join(' | ');
    throw new Error(`Conflicting finding_policy rules at equal specificity for ${bug.engine_key}:${bug.rule_id}: ${ids}`);
  }
  return top;
}

export function applyFindingPolicy(policy, bugs) {
  const policyConfig = policy ?? DEFAULT_FINDING_POLICY;
  const withPolicy = [];
  const suppressed = [];

  for (const bug of bugs) {
    const baseLane = classifyBaseLane(policyConfig, bug);
    const base = policyConfig.defaults?.[baseLane] ?? DEFAULT_FINDING_POLICY.defaults.unmapped;
    const matchedRule = selectRule(policyConfig.rules ?? [], bug);
    const chosen = matchedRule
      ? {
          obligation: matchedRule.obligation,
          handling: matchedRule.handling,
          policy_source: matchedRule.source,
          policy_reason: matchedRule.reason ?? null,
          policy_evidence: Array.isArray(matchedRule.evidence) ? matchedRule.evidence : [],
          policy_owner: matchedRule.owner ?? null,
          policy_expires: matchedRule.expires ?? null,
        }
      : {
          // An unresolved automated indicator defaults to handling:
          // "review", never straight to "report", regardless of WCAG
          // level or obligation -- see ACCESSIBILITY_FINDING_TRACKING.md,
          // "Policy Classification": "An automated result is evidence,
          // not a conformance decision. ... An unconfirmed result
          // normally goes to review, not suppress" (and, by the same
          // reasoning, not silently straight to report either). This
          // only applies to the *default* lane: an explicit
          // finding_policy.rules match (above) can still deliberately
          // set handling: "report" for a specific engine/rule a project
          // has decided is trustworthy enough not to need per-finding
          // review.
          obligation: base.obligation,
          handling: bug.evidence_status === 'automated-indicator' && base.handling === 'report' ? 'review' : base.handling,
          policy_source: 'default',
          policy_reason: null,
          policy_evidence: [],
          policy_owner: null,
          policy_expires: null,
        };

    const normalized = {
      ...bug,
      obligation: chosen.obligation,
      handling: chosen.handling,
      policy_source: chosen.policy_source,
      policy_reason: chosen.policy_reason,
      policy_evidence: chosen.policy_evidence,
      policy_owner: chosen.policy_owner,
      policy_expires: chosen.policy_expires,
      included_in_primary_score: chosen.obligation === 'required' && chosen.handling === 'report',
    };

    if (normalized.handling === 'suppress') suppressed.push(normalized);
    withPolicy.push(normalized);
  }

  const reportBugs = withPolicy.filter((b) => b.handling !== 'suppress');
  const suppressedByPattern = new Map();
  for (const b of suppressed) {
    const key = b.pattern_id;
    const cur = suppressedByPattern.get(key) ?? {
      pattern_id: b.pattern_id,
      rule_id: b.rule_id,
      engine_key: b.engine_key,
      reason: b.policy_reason,
      evidence: b.policy_evidence ?? [],
      owner: b.policy_owner ?? null,
      expires: b.policy_expires ?? null,
      pages_affected: 0,
      occurrences: 0,
    };
    cur.pages_affected += b.frequency?.pages_affected ?? 0;
    cur.occurrences += b.frequency?.instances ?? 0;
    suppressedByPattern.set(key, cur);
  }

  return {
    bugs: withPolicy,
    reportBugs,
    suppressed,
    suppressionSummary: {
      patterns: suppressedByPattern.size,
      pages: [...suppressedByPattern.values()].reduce((n, r) => n + r.pages_affected, 0),
      occurrences: [...suppressedByPattern.values()].reduce((n, r) => n + r.occurrences, 0),
      entries: [...suppressedByPattern.values()].sort((a, b) => b.occurrences - a.occurrences),
    },
  };
}
