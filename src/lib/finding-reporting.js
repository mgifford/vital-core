import { parseFragment, serialize } from 'parse5';
import { actRulesFor } from './finding-correlation.js';
import { priorityScore, tierOf } from './priority.js';
import { redactUrl } from './api-redact.js';
import actMapping from '../data/act-mapping.json' with { type: 'json' };

const SAFE_ATTRIBUTES = new Set(['id', 'class', 'role', 'type', 'name', 'for', 'tabindex', 'hidden', 'disabled', 'inert', 'href', 'src']);
const SAFE_ARIA = new Set(['aria-labelledby', 'aria-describedby', 'aria-hidden', 'aria-checked', 'aria-expanded', 'aria-required', 'aria-invalid', 'aria-level', 'aria-live', 'aria-atomic', 'aria-busy']);

export function sanitizeEvidence(example, opts = {}) {
  const fragment = parseFragment(String(example.html_snippet ?? '').slice(0, 4000));
  function clean(parent) {
    parent.childNodes = (parent.childNodes ?? []).filter((node) => !['#comment', 'script', 'style', 'iframe', 'object', 'template'].includes(node.nodeName));
    for (const node of parent.childNodes) {
      if (node.nodeName === '#text' && node.value.trim()) node.value = '[text omitted]';
      if (node.attrs) node.attrs = node.attrs.filter(({ name }) => SAFE_ATTRIBUTES.has(name) || SAFE_ARIA.has(name)).map((attribute) => {
        if (attribute.name !== 'href' && attribute.name !== 'src') return attribute;
        const value = attribute.value;
        return { ...attribute, value: /^(?:https?:\/\/|\/|#)/i.test(value) && !value.startsWith('//') ? redactUrl(value, opts) : '[REDACTED]' };
      });
      clean(node);
    }
  }
  clean(fragment);
  const selector = typeof example.xpath === 'string' && !/^\s*text:/i.test(example.xpath) && !/[<>]|\[\s*(?:value|data-|.*(?:token|secret|password|session))/i.test(example.xpath)
    ? example.xpath.slice(0, 1000) : null;
  return {
    url: typeof example.url === 'string' ? redactUrl(example.url, opts) : null,
    selector,
    html: example.html_snippet ? serialize(fragment).slice(0, 4000) : null,
    sanitized: true,
    text_and_values_omitted: true,
  };
}

export function sanitizeBugEvidence(bug, opts = {}) {
  if (!bug || typeof bug !== 'object') return bug;
  const out = { ...bug };
  const primary = sanitizeEvidence({ url: bug.url, xpath: bug.xpath, html_snippet: bug.html_snippet }, opts);
  out.url = primary.url;
  out.xpath = primary.selector;
  out.html_snippet = primary.html;
  if (Array.isArray(bug.affected_pages)) out.affected_pages = bug.affected_pages.map((url) => redactUrl(url, opts));
  if (Array.isArray(bug.example_pages)) out.example_pages = bug.example_pages.map((url) => redactUrl(url, opts));
  if (Array.isArray(bug.steps_to_reproduce)) {
    out.steps_to_reproduce = bug.steps_to_reproduce.map((step) => String(step).replace(/https?:\/\/[^\s"'<>]+/g, (url) => redactUrl(url, opts)));
  }
  if (Array.isArray(bug.examples)) {
    out.examples = bug.examples.slice(0, 3).map((example) => {
      const evidence = sanitizeEvidence({ url: example.url, xpath: example.xpath ?? example.target, html_snippet: example.html_snippet ?? example.html }, opts);
      return { url: evidence.url, xpath: evidence.selector, html_snippet: evidence.html, sanitized: true };
    });
  }
  return out;
}

export function buildFindingReporting(bugs, opts = {}) {
  const keyOf = (bug) => bug.instance_id ?? bug.pattern_id;
  const byKey = new Map(bugs.map((bug) => [keyOf(bug), bug]));
  const parents = new Map(bugs.map((bug) => [keyOf(bug), keyOf(bug)]));
  function root(key) {
    while (parents.get(key) !== key) key = parents.get(key);
    return key;
  }
  const confirmed = new Set();
  for (const bug of bugs) {
    for (const pair of bug.cross_engine_correlations ?? []) {
      const peer = byKey.get(pair.peer_instance_id);
      if (!peer || pair.status !== 'confirmed_duplicate' || !pair.shared_act_rules?.length ||
          !pair.evidence?.findings_observations_complete || !pair.evidence?.observation_pairs_one_to_one ||
          pair.evidence?.observation_pair_sample_capped) continue;
      const ownRoot = root(keyOf(bug));
      const peerRoot = root(keyOf(peer));
      if (ownRoot !== peerRoot) parents.set(peerRoot, ownRoot);
      confirmed.add(keyOf(bug));
      confirmed.add(keyOf(peer));
    }
  }
  const groups = new Map();
  for (const bug of bugs) {
    const group = root(keyOf(bug));
    const ids = groups.get(group) ?? [];
    ids.push(bug.pattern_id);
    groups.set(group, ids);
  }
  const byFindingId = new Map();
  for (const bug of bugs) {
    const rule = ({ 'axe-core': opts.summary?.axe?.rules, alfa: opts.summary?.alfa?.rules, 'deprecated-html': opts.summary?.deprecatedHtml?.rules })[bug.engine_key]?.[bug.rule_id];
    const capturedUrls = rule?.affectedPages?.map((page) => page.url) ?? bug.affected_pages ?? [];
    const urls = [...new Set(capturedUrls.filter((url) => typeof url === 'string'))];
    const pageCount = bug.frequency?.pages_affected;
    const correlations = (bug.cross_engine_correlations ?? []).map((pair) => ({
      correlation_id: pair.correlation_id,
      status: pair.status,
      peer_instance_id: pair.peer_instance_id,
      peer_pattern_id: pair.peer_pattern_id,
      own_act_rules: pair.own_act_rules ?? [],
      peer_act_rules: pair.peer_act_rules ?? [],
      shared_act_rules: pair.shared_act_rules ?? [],
      evidence: {
        shared_page_sample_count: pair.evidence?.shared_page_sample_count ?? null,
        findings_observations_complete: pair.evidence?.findings_observations_complete === true,
        observation_pairs_one_to_one: pair.evidence?.observation_pairs_one_to_one === true,
        observation_pair_sample_capped: pair.evidence?.observation_pair_sample_capped === true,
        observation_pairs: (pair.evidence?.observation_pairs ?? []).map((observation) => ({
          url: redactUrl(observation.url, opts),
          relation: observation.relation,
          status: observation.status,
          left_example_index: observation.left_example_index,
          right_example_index: observation.right_example_index,
        })),
      },
    }));
    byFindingId.set(bug.pattern_id, {
      act_rules: actRulesFor(bug),
      duplicate_status: confirmed.has(keyOf(bug)) ? 'confirmed_duplicate' : correlations.some((pair) => pair.status === 'uncertain') ? 'possible_duplicate' : correlations.some((pair) => pair.status === 'related') ? 'related' : 'not_confirmed',
      remediation_group_id: [...groups.get(root(keyOf(bug)))].sort()[0],
      remediation_task_count: null,
      ownership: 'not_established',
      engine_observation_count: bug.frequency?.instances ?? null,
      engine_severity: bug.engine_severity ?? rule?.impact ?? null,
      remediation_priority: { score: priorityScore(bug), conformance_tier: tierOf(bug), display_tier: bug.priority_tier ?? null },
      distinct_urls: { observed_count: urls.length, reported_page_count: pageCount ?? null, complete: Number.isInteger(pageCount) && urls.length === pageCount, sample: urls.slice(0, 25).map((url) => redactUrl(url, opts)), sample_capped: urls.length > 25, identity: 'stored_url_including_query' },
      representative_evidence: (bug.examples?.length ? bug.examples : [{ url: bug.url, xpath: bug.xpath, html_snippet: bug.html_snippet }]).slice(0, 3).map((example) => sanitizeEvidence(example, opts)),
      correlations,
    });
  }
  return {
    summary: {
      engine_finding_count: bugs.length,
      remediation_group_count: groups.size,
      confirmed_duplicate_findings_removed: bugs.length - groups.size,
      remediation_task_count: null,
      counting_basis: 'Only complete confirmed duplicate findings share a group. Groups are not an estimate of fixes or owners.',
      act_mapping: { generated_at: actMapping.generatedAt, source_urls: actMapping.sourceUrls },
    },
    byFindingId,
  };
}