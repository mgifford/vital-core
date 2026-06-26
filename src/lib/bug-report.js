import crypto from 'node:crypto';
import { resolveWcag, classifyFinding, severityFor } from './wcag.js';
import { impactFor, estimateExcluded, pct } from './fpc.js';
import { remediationTip } from './remediation.js';
import { techRemediationTip } from './remediation-prompts.js';
import { rulePlainLabel } from './rule-label.js';

/**
 * Turn the weekly per-rule summary into structured accessibility bug
 * reports following ACCESSIBILITY_BUG_REPORTING_BEST_PRACTICES.
 *
 * Scope is one report per failing rule (the scanner aggregates weekly,
 * not per instance), carrying frequency counts and a few representative
 * example instances with real DOM context.
 *
 * Truthfulness: fields the engines observe (url, selector, snippet,
 * rule, WCAG SC, severity, frequency) are populated. Fields automated
 * scanning cannot observe (testing environment, affected disability
 * groups, manual steps to reproduce) are emitted with explicit
 * "requires manual testing" placeholders rather than invented values.
 */

const PREFIX = 'VS'; // vital-scans bug id prefix
const PLACEHOLDER = 'Not captured by automated scan — requires manual testing.';

function shortHash(...parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 8);
}

/** Derive a short human label from scanner metadata, with rule-id fallback. */
function componentLabel(engineKey, ruleId, help, wcag) {
  const label = rulePlainLabel(engineKey, ruleId, { help, wcag });
  if (!label) return ruleId;
  return label.replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * Build the list of bug-report objects for a domain/week.
 * Returns [] when there are no findings.
 */
export function buildBugReports(target, summary) {
  const reports = [];
  const total = summary.pagesScanned;

  const fromRule = (engine, toolName, ruleId, rule) => {
    const wcag = resolveWcag(engine, { tags: rule.tags, ruleId });
    const wcag_category = classifyFinding(engine, { tags: rule.tags, ruleId }, wcag);
    const severity = severityFor(rule.impact ?? null, rule.pages, total);
    const patternId = `${PREFIX}-${shortHash(engine, ruleId)}`;
    const first = rule.instances?.[0];
    const instanceId = `${PREFIX}-${shortHash(patternId, first?.url ?? '', first?.target ?? '')}`;
    const scLabel = wcag ? `WCAG ${wcag.sc}` : 'WCAG criterion undetermined';
    const component = componentLabel(engine, ruleId, rule.help, wcag);

    // Human impact: disability groups affected (via WCAG SC -> Section 508
    // FPC) with US prevalence. If the target supplies page_loads_per_week,
    // also estimate excluded users, scaled by the share of pages affected.
    const fpc = wcag ? impactFor(wcag.sc) : null;
    const loads = target.page_loads_per_week;
    const affectedShare = total > 0 ? rule.pages / total : 0;
    const impact = fpc
      ? {
          groups: fpc.groups.map((g) => {
            const excluded =
              loads ? estimateExcluded(g.prevalence, loads * affectedShare) : null;
            return { code: g.code, group: g.group, prevalence: g.prevalence, percent: pct(g.prevalence), estimatedExcluded: excluded };
          }),
          summary:
            'Affects ' +
            fpc.groups.map((g) => `${g.group} (${pct(g.prevalence)})`).join(', ') +
            '.',
        }
      : { groups: [], summary: PLACEHOLDER };

    const techTip = techRemediationTip(summary.tech, ruleId);

    return {
      instance_id: instanceId,
      pattern_id: patternId,
      url: first?.url ?? summary.domain,
      xpath: first?.target ?? null,
      html_snippet: first?.html ?? null,
      wcag_sc: wcag?.sc ?? null,
      wcag_name: wcag?.name ?? null,
      wcag_level: wcag?.level ?? null,
      wcag_version: wcag?.wcag_version ?? null,
      wcag_category,
      rule_id: ruleId,
      rule_label: component,
      engine_key: engine, // 'axe-core' | 'alfa' | 'deprecated-html' (stable; for CSV lookup)
      tool: toolName,
      rule_url: rule.helpUrl ?? rule.ruleUrl ?? null,
      severity,
      frequency: {
        instances: rule.count,
        pages_affected: rule.pages,
        total_pages_scanned: total,
      },
      likely_source: rule.pages >= (target.reporting?.template_page_threshold ?? 10)
        ? 'template'
        : rule.pages <= 2 ? 'content' : 'unknown',
      summary: `${component} (${scLabel})`,
      description: `${component}. Detected by ${toolName} rule ${ruleId} on ${rule.pages} of ${total} scanned pages (${rule.count} instances).`,
      // Capped representative instances with real DOM context.
      examples: (rule.instances ?? []).map((i) => ({
        url: i.url,
        xpath: i.target ?? null,
        html_snippet: i.html ?? null,
      })),
      example_pages: rule.examplePages ?? [],
      // Up to 25 affected-page URLs for inline listing in the report; the
      // CSV (set later) holds the complete set when there are more.
      affected_pages: (rule.affectedPages ?? []).slice(0, 25).map((p) => p.url),
      // Human impact derived from the WCAG SC (Section 508 FPC + US
      // prevalence). Empty groups => undetermined SC; falls back to the
      // manual-testing note. Severity/exact reproduction still need a human.
      impact,
      testing_environment: `Automated: ${toolName}, headless Chromium (Playwright). Manual AT verification: ${PLACEHOLDER}`,
      steps_to_reproduce: [
        `Open ${first?.url ?? 'an affected page (see example pages)'}.`,
        first?.target ? `Locate the element: ${first.target}` : 'Locate the affected element.',
        `Confirm the ${toolName} finding for rule ${ruleId}${wcag ? ` against ${scLabel} ${wcag.name}` : ''}.`,
      ],
      remediation_tip: remediationTip(engine, ruleId),
      tech_name: techTip?.tech ?? null,
      tech_remediation_tip: techTip?.tip ?? null,
      suggested_fix: rule.helpUrl ?? rule.ruleUrl
        ? `See remediation guidance: ${rule.helpUrl ?? rule.ruleUrl}`
        : PLACEHOLDER,
    };
  };

  for (const [id, rule] of Object.entries(summary.axe?.rules ?? {})) {
    reports.push(fromRule('axe-core', `axe-core${summary.axe?.version ? ' ' + summary.axe.version : ''}`, id, rule));
  }
  for (const [id, rule] of Object.entries(summary.alfa?.rules ?? {})) {
    reports.push(fromRule('alfa', 'Siteimprove Alfa', id, rule));
  }
  for (const [id, rule] of Object.entries(summary.deprecatedHtml?.rules ?? {})) {
    reports.push(fromRule('deprecated-html', 'deprecated-html', id, rule));
  }

  // Sort order for engineers: WCAG 2.2 AA requirements first (the primary
  // compliance target), then 2.1 additions, then 2.0 baseline, then AAA,
  // then Best Practice (not a WCAG requirement), then undetermined.
  // Within each category: by WCAG SC number so axe + alfa for the same
  // criterion are adjacent, then severity, then pages affected.
  const catRank = {
    'WCAG 2.2 A': 0, 'WCAG 2.2 AA': 1,
    'WCAG 2.1 A': 2, 'WCAG 2.1 AA': 3,
    'WCAG 2.0 A': 4, 'WCAG 2.0 AA': 5,
    'WCAG 2.x AAA': 6,
    'Best Practice': 7,
    'Undetermined': 8,
  };
  const sevRank = { Critical: 0, Serious: 1, Moderate: 2, Minor: 3 };
  reports.sort(
    (a, b) =>
      (catRank[a.wcag_category ?? 'Undetermined'] ?? 8) - (catRank[b.wcag_category ?? 'Undetermined'] ?? 8) ||
      (a.wcag_sc ?? 'zzz').localeCompare(b.wcag_sc ?? 'zzz') ||
      sevRank[a.severity] - sevRank[b.severity] ||
      b.frequency.pages_affected - a.frequency.pages_affected
  );

  // Duplicate detection: when axe and alfa both flag the same WCAG SC on
  // overlapping pages, the alfa report is likely a duplicate of the axe one
  // (axe is the canonical source for engineers since it ships remediation
  // tips). Mark the alfa (or second-engine) report so it can be filtered
  // in spreadsheets and de-prioritised in JIRA.
  const axeBySc = new Map(); // wcag_sc -> first axe bug that covers it
  for (const r of reports) {
    if (r.engine_key === 'axe-core' && r.wcag_sc) axeBySc.set(r.wcag_sc, r);
  }
  for (const r of reports) {
    if (r.engine_key !== 'axe-core' && r.wcag_sc && axeBySc.has(r.wcag_sc)) {
      const axeMatch = axeBySc.get(r.wcag_sc);
      // Only flag when the page-overlap is meaningful (>50% of the smaller
      // set) — avoids false positives on rules with very different scope.
      const smaller = Math.min(r.frequency.pages_affected, axeMatch.frequency.pages_affected);
      const larger = Math.max(r.frequency.pages_affected, axeMatch.frequency.pages_affected);
      if (smaller > 0 && smaller / larger >= 0.5) {
        r.possible_duplicate_of = axeMatch.instance_id;
        r.possible_duplicate_pattern = axeMatch.pattern_id;
      }
    }
  }

  return reports;
}

/** Render a single bug report as Markdown matching the guide's template. */
export function bugReportToMarkdown(r) {
  const lines = [];
  lines.push(`## ${r.summary}`);
  lines.push('');
  lines.push(`**Bug ID:** \`${r.instance_id}\`  `);
  lines.push(`**Pattern ID:** \`${r.pattern_id}\`  `);
  lines.push(`**URL:** ${r.url}  `);
  lines.push(`**XPath / selector:** ${r.xpath ? `\`${r.xpath}\`` : '_n/a_'}  `);
  lines.push(
    `**WCAG SC:** ${r.wcag_sc ? `${r.wcag_sc} — ${r.wcag_name} (Level ${r.wcag_level})` : '_undetermined_'}  `
  );
  lines.push(`**Rule:** ${r.tool} — \`${r.rule_id}\`${r.rule_url ? ` ([reference](${r.rule_url}))` : ''}  `);
  lines.push(`**Severity:** ${r.severity}  `);
  lines.push(
    `**Frequency:** ${r.frequency.instances} instances; ${r.frequency.pages_affected} of ${r.frequency.total_pages_scanned} pages affected`
  );
  if (r.first_seen) {
    lines.push(
      `  \n**History:** first seen ${r.first_seen}, last seen ${r.last_seen} (${r.weeks_seen} week${r.weeks_seen === 1 ? '' : 's'})`
    );
  }
  lines.push('');
  if (r.html_snippet) {
    lines.push('### HTML snippet');
    lines.push('```html');
    lines.push(r.html_snippet);
    lines.push('```');
    lines.push('');
  }
  lines.push('### Description');
  lines.push(r.description);
  lines.push('');
  lines.push('### Steps to reproduce');
  r.steps_to_reproduce.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push('');
  lines.push('### Impact');
  lines.push(r.impact.summary);
  for (const g of r.impact.groups ?? []) {
    const excl = g.estimatedExcluded != null ? ` — ~${g.estimatedExcluded.toLocaleString()} people/week potentially excluded` : '';
    lines.push(`- **${g.group}** (${g.percent} of population)${excl}`);
  }
  lines.push('');
  lines.push('### Affected pages');
  // <=25 affected pages: list the URLs inline (more useful than a CSV link
  // for a handful). >25: list the first 25, then link the full CSV.
  const total = r.frequency.pages_affected;
  const urls = r.affected_pages ?? [];
  if (total <= 25 && urls.length >= total) {
    urls.forEach((u) => lines.push(`- ${u}`));
  } else {
    urls.slice(0, 25).forEach((u) => lines.push(`- ${u}`));
    lines.push('', r.affected_pages_csv
      ? `…and more — ${total} pages total ([download CSV](${r.affected_pages_csv})).`
      : `…and more — ${total} pages total.`);
  }
  lines.push('');
  lines.push('### Testing environment');
  lines.push(r.testing_environment);
  lines.push('');
  lines.push('### Suggested fix');
  if (r.remediation_tip) lines.push(`**How to fix:** ${r.remediation_tip}`, '');
  lines.push(r.suggested_fix);
  if (r.example_pages.length > 1) {
    lines.push('');
    lines.push('### Example pages');
    r.example_pages.forEach((u) => lines.push(`- ${u}`));
  }
  return lines.join('\n');
}

/** Full Markdown document for a domain/week. */
export function bugReportsMarkdown(target, summary, reports) {
  const head = [
    `# Accessibility bug reports — ${target.domain}, week ${summary.week}`,
    '',
    `${reports.length} issue type(s) from ${summary.pagesScanned} pages scanned. ` +
      `Generated ${summary.generatedAt.slice(0, 10)} by ` +
      `[vital-scans](https://github.com/mgifford/vital-core), following ` +
      `[accessibility bug-reporting best practices](https://mgifford.github.io/ACCESSIBILITY.md/examples/ACCESSIBILITY_BUG_REPORTING_BEST_PRACTICES.html).`,
    '',
    '> Automated checks find roughly a third of accessibility barriers. ' +
      'Fields marked "requires manual testing" cannot be observed by an ' +
      'automated scan and need a human with assistive technology.',
    '',
    '---',
    '',
  ];
  if (reports.length === 0) {
    return head.join('\n') + '\nNo accessibility findings this week.\n';
  }
  return head.join('\n') + reports.map(bugReportToMarkdown).join('\n\n---\n\n') + '\n';
}
