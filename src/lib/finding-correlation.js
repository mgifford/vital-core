import crypto from 'node:crypto';
import { actRuleIdsFor } from './act.js';

// W3C ACT publication status checked 2026-11-03; unknown IDs stay explicit.
const ACT_RULE_STATUS = {
  afw4f7: 'Approved',
  '09o5cg': 'Approved',
  e086e5: 'Approved',
  ff89c9: 'Proposed',
  bc4a75: 'Proposed',
  '97a4e1': 'Approved',
  m6b1q3: 'Approved',
};

function parseElement(value) {
  if (typeof value !== 'string') return null;
  const match = /^\s*<\s*([a-z][\w:-]*)\b([^>]*)>/i.exec(value);
  if (!match) return null;

  const attributes = {};
  const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const attribute of match[2].matchAll(attributePattern)) {
    const name = attribute[1].toLowerCase();
    let attributeValue = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
    if (name === 'class') attributeValue = attributeValue.split(/\s+/).filter(Boolean).sort().join(' ');
    attributes[name] = attributeValue;
  }
  return { tag: match[1].toLowerCase(), attributes };
}

function elementKey(element) {
  return JSON.stringify([element.tag, Object.entries(element.attributes).sort(([a], [b]) => a.localeCompare(b))]);
}

function selectorMatchesElement(selector, element) {
  if (typeof selector !== 'string' || selector.startsWith('<') || selector.startsWith('text:')) return false;
  const compound = selector.trim().split(/\s*>\s*/).at(-1).trim();
  const tag = /^([a-z][\w-]*)/i.exec(compound)?.[1]?.toLowerCase();
  if (tag && tag !== element.tag) return false;

  let constraints = 0;
  const id = /#([\w-]+)/.exec(compound)?.[1];
  if (id) {
    constraints++;
    if (element.attributes.id !== id) return false;
  }
  const classes = [...compound.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
  for (const className of classes) {
    constraints++;
    if (!element.attributes.class?.split(' ').includes(className)) return false;
  }
  for (const match of compound.matchAll(/\[([\w:-]+)\s*=\s*(["'])(.*?)\2\]/g)) {
    constraints++;
    if (element.attributes[match[1].toLowerCase()] !== match[3]) return false;
  }
  return constraints > 0;
}

function classPrefixes(observation) {
  const classNames = new Set();
  const element = parseElement(observation.html_snippet) ?? parseElement(observation.xpath);
  if (element?.attributes.class) {
    for (const className of element.attributes.class.split(' ')) classNames.add(className);
  }
  for (const match of String(observation.xpath ?? '').matchAll(/\.([\w-]+)/g)) classNames.add(match[1]);

  const prefixes = new Set();
  for (const className of classNames) {
    const parts = className.split('-');
    for (let count = 2; count < parts.length; count++) {
      const prefix = parts.slice(0, count).join('-');
      if (prefix.length >= 8) prefixes.add(prefix);
    }
  }
  return prefixes;
}

function textTarget(observation) {
  const match = /^\s*text:\s*["']([\s\S]*)["']\s*$/.exec(observation.xpath ?? '');
  return match?.[1].replace(/\s+/g, ' ').trim().toLowerCase() ?? null;
}

function visibleText(snippet) {
  return String(snippet ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function compareObservations(left, right) {
  const leftElement = parseElement(left.html_snippet) ?? parseElement(left.xpath);
  const rightElement = parseElement(right.html_snippet) ?? parseElement(right.xpath);
  const leftText = textTarget(left);
  const rightText = textTarget(right);

  if (leftElement && selectorMatchesElement(right.xpath, leftElement)) {
    return { relation: 'same_element' };
  }
  if (rightElement && selectorMatchesElement(left.xpath, rightElement)) return { relation: 'same_element' };
  if (leftElement && rightElement && elementKey(leftElement) === elementKey(rightElement)) return { relation: 'same_markup' };

  if (leftText && visibleText(right.html_snippet).includes(leftText)) return { relation: 'same_text' };
  if (rightText && visibleText(left.html_snippet).includes(rightText)) return { relation: 'same_text' };

  const leftClasses = classPrefixes(left);
  const rightClasses = classPrefixes(right);
  const sharedComponent = [...leftClasses]
    .filter((className) => rightClasses.has(className))
    .sort((a, b) => b.length - a.length)[0];
  if (sharedComponent) return { relation: 'same_component', shared_component: sharedComponent };

  if (leftElement && rightElement) return { relation: 'separate_elements' };
  return { relation: 'unresolved' };
}

export function actRulesFor(report) {
  return actRuleIdsFor(report.engine_key, report.rule_id).map((id) => ({
    id,
    status: ACT_RULE_STATUS[id] ?? 'Unknown',
  }));
}

function stableCorrelationId(left, right) {
  const patterns = [left.pattern_id, right.pattern_id].sort();
  return `XC-${crypto.createHash('sha256').update(patterns.join('|')).digest('hex').slice(0, 10)}`;
}

function hasCompleteObservations(report) {
  return report.frequency?.instances === (report.examples ?? []).length &&
    report.frequency?.pages_affected === (report.affected_pages ?? []).length;
}

function observationStatus(relation, sharesActRule) {
  if (relation === 'same_element') return sharesActRule ? 'confirmed_duplicate' : 'related';
  if (relation === 'same_component') return 'related';
  if (relation === 'same_text' || relation === 'same_markup' || relation === 'unresolved') return 'uncertain';
  return 'independent';
}

/** Correlate cross-engine findings only when ACT or sampled element evidence supports a relationship. */
export function correlateFindings(reports) {
  const axe = reports.filter((report) => report.engine_key === 'axe-core');
  const alfa = reports.filter((report) => report.engine_key === 'alfa');
  const correlations = [];

  for (const left of axe) {
    const leftActRules = actRulesFor(left);
    for (const right of alfa) {
      const rightActRules = actRulesFor(right);
      const rightActIds = new Set(rightActRules.map((rule) => rule.id));
      const sharedActRules = leftActRules.filter((rule) => rightActIds.has(rule.id));
      const rightExamplesByUrl = new Map();
      for (const [index, example] of (right.examples ?? []).entries()) {
        const examples = rightExamplesByUrl.get(example.url) ?? [];
        examples.push({ ...example, index });
        rightExamplesByUrl.set(example.url, examples);
      }

      const observationPairs = [];
      let observationPairsCapped = false;
      for (const [leftIndex, leftExample] of (left.examples ?? []).entries()) {
        for (const rightExample of rightExamplesByUrl.get(leftExample.url) ?? []) {
          const match = compareObservations(leftExample, rightExample);
          if (match.relation === 'unresolved') continue;
          observationPairs.push({
            url: leftExample.url,
            relation: match.relation,
            status: observationStatus(match.relation, sharedActRules.length > 0),
            left_example_index: leftIndex,
            right_example_index: rightExample.index,
            left_target: leftExample.xpath ?? null,
            right_target: rightExample.xpath ?? null,
            ...(match.shared_component ? { shared_component: match.shared_component } : {}),
          });
          if (observationPairs.length >= 20) {
            observationPairsCapped = true;
            break;
          }
        }
        if (observationPairsCapped) break;
      }

      const leftPages = new Set(left.affected_pages ?? []);
      const rightPages = right.affected_pages ?? [];
      const sharedPageCount = rightPages.filter((url) => leftPages.has(url)).length;
      const leftComplete = hasCompleteObservations(left);
      const rightComplete = hasCompleteObservations(right);
      const completePageSamples = leftComplete && rightComplete;
      const leftMatches = new Set(observationPairs.map((pair) => pair.left_example_index));
      const rightMatches = new Set(observationPairs.map((pair) => pair.right_example_index));
      const oneToOne = observationPairs.length > 0 &&
        observationPairs.length === leftMatches.size && observationPairs.length === rightMatches.size &&
        leftMatches.size === (left.examples ?? []).length && rightMatches.size === (right.examples ?? []).length;
      const allObservationPairsConfirmed = observationPairs.length > 0 && observationPairs.every((pair) => pair.status === 'confirmed_duplicate');
      const completeDuplicateEvidence = completePageSamples && !observationPairsCapped && oneToOne && allObservationPairsConfirmed;
      const hasConfirmedObservation = observationPairs.some((pair) => pair.status === 'confirmed_duplicate');
      const hasRelatedEvidence = observationPairs.some((pair) => pair.status === 'related');
      const hasUncertainEvidence = observationPairs.some((pair) => pair.status === 'uncertain');
      const hasIndependentEvidence = observationPairs.some((pair) => pair.status === 'independent');
      let status;

      if (completeDuplicateEvidence) status = 'confirmed_duplicate';
      else if (hasConfirmedObservation || hasRelatedEvidence) status = 'related';
      else if (hasIndependentEvidence && !hasUncertainEvidence) status = 'independent';
      else if (hasUncertainEvidence || (sharedActRules.length > 0 && sharedPageCount > 0)) status = 'uncertain';
      else continue;

      correlations.push({
        correlation_id: stableCorrelationId(left, right),
        status,
        left: {
          instance_id: left.instance_id,
          pattern_id: left.pattern_id,
          engine: left.engine_key,
          rule_id: left.rule_id,
          act_rules: leftActRules,
        },
        right: {
          instance_id: right.instance_id,
          pattern_id: right.pattern_id,
          engine: right.engine_key,
          rule_id: right.rule_id,
          act_rules: rightActRules,
        },
        shared_act_rules: sharedActRules,
        evidence: {
          shared_page_sample_count: sharedPageCount,
          findings_observations_complete: completePageSamples,
          observation_pairs_one_to_one: oneToOne,
          observation_pairs: observationPairs,
          observation_pair_sample_capped: observationPairsCapped,
        },
      });
    }
  }

  return correlations;
}

/** Add relationship metadata without changing either engine's original observations. */
export function attachFindingCorrelations(reports) {
  const byId = new Map(reports.map((report) => [report.instance_id, report]));
  const correlations = correlateFindings(reports);

  for (const correlation of correlations) {
    const left = byId.get(correlation.left.instance_id);
    const right = byId.get(correlation.right.instance_id);
    for (const [source, peer, ownActRules, peerActRules] of [
      [left, right, correlation.left.act_rules, correlation.right.act_rules],
      [right, left, correlation.right.act_rules, correlation.left.act_rules],
    ]) {
      source.cross_engine_correlations ??= [];
      source.cross_engine_correlations.push({
        correlation_id: correlation.correlation_id,
        status: correlation.status,
        peer_instance_id: peer.instance_id,
        peer_pattern_id: peer.pattern_id,
        own_act_rules: ownActRules,
        peer_act_rules: peerActRules,
        shared_act_rules: correlation.shared_act_rules,
        evidence: correlation.evidence,
      });
    }

    if (correlation.status === 'confirmed_duplicate') {
      right.possible_duplicate_of = left.instance_id;
      right.possible_duplicate_pattern = left.pattern_id;
      right.possible_duplicate_act_rule = correlation.shared_act_rules[0].id;
    }
  }

  return correlations;
}