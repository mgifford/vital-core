/**
 * update-act-mapping.mjs
 *
 * Fetches the upstream ACT-rule implementation reports from Deque (axe-core) and
 * Siteimprove (alfa), then derives a combined mapping that the engine uses to
 * correlate findings from both tools via their shared W3C ACT rule IDs.
 *
 * Sources:
 *   axe:  https://github.com/dequelabs/act-reports-axe/blob/main/reports/axe-core-mapping.json
 *   alfa: https://github.com/act-rules/act-rules-implementation-alfa/blob/master/report.json
 *
 * Run:  node scripts/update-act-mapping.mjs
 * CI:   .github/workflows/update-act-mapping.yml  (monthly, opens a PR on changes)
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const SOURCE_URLS = {
  axe: 'https://raw.githubusercontent.com/dequelabs/act-reports-axe/main/reports/axe-core-mapping.json',
  alfa: 'https://raw.githubusercontent.com/act-rules/act-rules-implementation-alfa/refs/heads/master/report.json',
};

const OUTPUT_PATH = path.resolve(process.cwd(), 'src/data/act-mapping.json');
const FETCH_TIMEOUT_MS = 30_000;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'vital-core-act-mapping-updater' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build ACT-rule-ID → axe-procedure-names map from the Deque axe-core-mapping.json.
 * Each entry looks like: { ruleId: "73f2c2", procedureNames: ["autocomplete-valid"] }
 */
function parseAxeMapping(json) {
  const actToAxe = {};
  for (const entry of json.actRuleMapping ?? []) {
    const actId = String(entry.ruleId || '').trim();
    const procedures = (Array.isArray(entry.procedureNames) ? entry.procedureNames : [])
      .map(p => String(p).trim())
      .filter(Boolean);
    if (!actId || procedures.length === 0) continue;
    if (!actToAxe[actId]) actToAxe[actId] = [];
    for (const p of procedures) {
      if (!actToAxe[actId].includes(p)) actToAxe[actId].push(p);
    }
  }
  return actToAxe;
}

/**
 * Build ACT-rule-ID → alfa-rule-IDs map from the Siteimprove EARL report.json.
 *
 * The file is an array mixing earl:TestSubject and earl:Assertion items.
 * Assertions have:
 *   earl:test["@id"]     → e.g. "https://alfa.siteimprove.com/rules/sia-r10"
 *   earl:subject["@id"]  → e.g. "https://act-rules.github.io/testcases/73f2c2/..."
 * The 6-hex-character segment after /testcases/ is the ACT rule ID.
 */
function parseAlfaMapping(json) {
  const actToAlfa = {};
  if (!Array.isArray(json)) return actToAlfa;
  for (const item of json) {
    if (item['@type'] !== 'earl:Assertion') continue;
    const testId = item['earl:test']?.['@id'];
    const subjectId = item['earl:subject']?.['@id'];
    if (!testId || !subjectId) continue;
    const actMatch = String(subjectId).match(/\/testcases\/([0-9a-f]{6})\//);
    if (!actMatch) continue;
    const actId = actMatch[1];
    const alfaId = String(testId).replace('https://alfa.siteimprove.com/rules/', '');
    if (!actToAlfa[actId]) actToAlfa[actId] = [];
    if (!actToAlfa[actId].includes(alfaId)) actToAlfa[actId].push(alfaId);
  }
  return actToAlfa;
}

/**
 * Invert a { actId → [ruleId, ...] } map to { ruleId → [actId, ...] }.
 */
function buildReverseMap(actToRules) {
  const ruleToAct = {};
  for (const [actId, ruleIds] of Object.entries(actToRules)) {
    for (const ruleId of ruleIds) {
      if (!ruleToAct[ruleId]) ruleToAct[ruleId] = [];
      if (!ruleToAct[ruleId].includes(actId)) ruleToAct[ruleId].push(actId);
    }
  }
  return ruleToAct;
}

async function main() {
  console.log('⏳ Fetching axe ACT mapping from Deque…');
  const axeJson = await fetchJson(SOURCE_URLS.axe);

  console.log('⏳ Fetching alfa ACT report from Siteimprove…');
  const alfaJson = await fetchJson(SOURCE_URLS.alfa);

  const actToAxe = parseAxeMapping(axeJson);
  const actToAlfa = parseAlfaMapping(alfaJson);

  // Merge into a unified per-ACT-rule index
  const allActIds = new Set([...Object.keys(actToAxe), ...Object.keys(actToAlfa)]);
  const byActRuleId = {};
  for (const actId of [...allActIds].sort()) {
    byActRuleId[actId] = {
      axe: actToAxe[actId] ?? [],
      alfa: actToAlfa[actId] ?? [],
    };
  }

  const mapping = {
    generatedAt: new Date().toISOString(),
    sourceUrls: SOURCE_URLS,
    // Primary index: ACT rule ID → { axe: [...], alfa: [...] }
    byActRuleId,
    // Reverse indexes for O(1) lookup during scan analysis
    axeRuleToActIds: buildReverseMap(actToAxe),
    alfaRuleToActIds: buildReverseMap(actToAlfa),
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(mapping, null, 2) + '\n', 'utf8');

  const actCount = Object.keys(byActRuleId).length;
  const axeRuleCount = Object.keys(mapping.axeRuleToActIds).length;
  const alfaRuleCount = Object.keys(mapping.alfaRuleToActIds).length;
  const overlapCount = Object.values(byActRuleId).filter(v => v.axe.length > 0 && v.alfa.length > 0).length;

  console.log(`✅ Wrote ${OUTPUT_PATH}`);
  console.log(`   ACT rules indexed : ${actCount}`);
  console.log(`   Axe rules mapped  : ${axeRuleCount}`);
  console.log(`   Alfa rules mapped : ${alfaRuleCount}`);
  console.log(`   Overlap (both tools cover same ACT rule): ${overlapCount}`);
}

main().catch(err => {
  console.error('❌ update-act-mapping failed:', err.message);
  process.exit(1);
});
