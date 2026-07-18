import crypto from 'node:crypto';
import { severityFor } from './wcag.js';

const MAX_AFFECTED_PAGES = 5000;

const SEVERITY_WEIGHT = { Critical: 4, Serious: 3, Moderate: 2, Minor: 1 };

// axe-core findings are rule-based against the live DOM and have a materially
// lower false-positive rate than Alfa's heuristic checks, so they outrank an
// otherwise-equal Alfa cluster in the Next 10 actions queue (issue #210).
const ENGINE_WEIGHT = { 'axe-core': 1.2, alfa: 1, 'deprecated-html': 1 };

const DESIGN_SYSTEMS = {
	'cms-ds': {
		label: 'CMS Design System',
		prefixes: ['ds-c-'],
	},
	uswds: {
		label: 'USWDS',
		prefixes: ['usa-'],
	},
	none: {
		label: 'none',
		prefixes: [],
	},
};

function stableId(input) {
	return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
}

function normalizeSelector(selector) {
	const s = String(selector ?? '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
	if (!s) return '';
	return s
		.replace(/:nth-child\(\d+\)/g, ':nth-child(*)')
		.replace(/:nth-of-type\(\d+\)/g, ':nth-of-type(*)')
		.replace(/\[(data-testid|id)="[^"]*"\]/g, '[$1]')
		.replace(/\b\d+\b/g, '#');
}

function snippetShape(html) {
	const src = String(html ?? '').toLowerCase();
	if (!src) return '';
	const tag = src.match(/<\s*([a-z0-9-]+)/)?.[1] ?? 'node';
	const attrs = [];
	if (/\brole\s*=/.test(src)) attrs.push('role');
	if (/\baria-/.test(src)) attrs.push('aria');
	if (/\balt\s*=/.test(src)) attrs.push('alt');
	if (/\bhref\s*=/.test(src)) attrs.push('href');
	if (/\btype\s*=/.test(src)) attrs.push('type');
	return `${tag}:${attrs.sort().join('+')}`;
}

function extractClassTokens(selector, html) {
	const out = new Set();
	const add = (raw) => {
		for (const tok of String(raw ?? '').split(/[^a-zA-Z0-9_-]+/)) {
			if (!tok) continue;
			out.add(tok.toLowerCase());
		}
	};

	const sel = String(selector ?? '');
	const selClass = sel.matchAll(/\.([a-zA-Z0-9_-]+)/g);
	for (const m of selClass) add(m[1]);

	const snippet = String(html ?? '');
	const cls = snippet.match(/class\s*=\s*"([^"]+)"/i);
	if (cls?.[1]) add(cls[1]);

	return [...out];
}

function classifyComponent(token, prefixes) {
	for (const p of prefixes) {
		if (!token.startsWith(p)) continue;
		const cut = token.split(/__(.+)|--(.+)/)[0];
		return cut;
	}
	return null;
}

function likelyLookalike(token, knownStems) {
	if (!knownStems.size) return false;
	for (const stem of knownStems) {
		if (token === stem) return true;
		if (token.startsWith(`${stem}-`) || token.endsWith(`-${stem}`) || token.includes(`-${stem}-`)) {
			return true;
		}
	}
	return false;
}

export function createClusterTracker(target = {}) {
	const dsKey = String(target.design_system ?? 'none').toLowerCase();
	const ds = DESIGN_SYSTEMS[dsKey] ?? DESIGN_SYSTEMS.none;

	const clusters = new Map();
	const rulePages = new Map();
	const ruleImpact = new Map();
	const ruleExamples = new Map();
	const ruleComponentHits = new Map();
	const knownComponentStems = new Set();
	const pageComponents = new Map();
	const pageDrift = new Map();

	function rememberRule(engineKey, ruleId, impact, url) {
		const key = `${engineKey}:${ruleId}`;
		if (!rulePages.has(key)) rulePages.set(key, new Set());
		rulePages.get(key).add(url);
		if (impact && !ruleImpact.has(key)) ruleImpact.set(key, impact);
		if (!ruleExamples.has(key)) ruleExamples.set(key, 0);
	}

	function observe(engineKey, ruleId, impact, url, examples = []) {
		rememberRule(engineKey, ruleId, impact, url);
		for (const ex of examples ?? []) {
			const selector = String(ex?.target ?? '');
			const html = String(ex?.html ?? '');
			const normSelector = normalizeSelector(selector);
			const shape = snippetShape(html);
			const fp = `${engineKey}:${ruleId}|${normSelector}|${shape}`;
			const id = `cc-${stableId(fp)}`;

			const classTokens = extractClassTokens(selector, html);
			const components = classTokens
				.map((tok) => classifyComponent(tok, ds.prefixes))
				.filter(Boolean);

			for (const c of components) {
				const stem = c.replace(/^(ds-c-|usa-)/, '');
				knownComponentStems.add(stem);
			}

			if (!clusters.has(id)) {
				clusters.set(id, {
					id,
					fingerprint: fp,
					engine_key: engineKey,
					rule_id: ruleId,
					selector_path: normSelector,
					snippet_shape: shape,
					representative_selector: selector || null,
					representative_snippet: html || null,
					design_components: new Set(),
					lookalike_tokens: new Set(),
					pages: new Set(),
					instances: 0,
					affected_pages: [],
				});
			}

			const c = clusters.get(id);
			c.instances += 1;
			c.pages.add(url);
			if (c.affected_pages.length < MAX_AFFECTED_PAGES && !c.affected_pages.includes(url)) c.affected_pages.push(url);

			for (const comp of components) {
				c.design_components.add(comp);
				const ruleKey = `${engineKey}:${ruleId}`;
				if (!ruleComponentHits.has(ruleKey)) ruleComponentHits.set(ruleKey, new Map());
				const map = ruleComponentHits.get(ruleKey);
				map.set(comp, (map.get(comp) ?? 0) + 1);

				if (!pageComponents.has(url)) pageComponents.set(url, new Set());
				pageComponents.get(url).add(comp);
			}

			const ruleKey = `${engineKey}:${ruleId}`;
			ruleExamples.set(ruleKey, (ruleExamples.get(ruleKey) ?? 0) + 1);

			if (components.length === 0 && ds.prefixes.length > 0) {
				for (const tok of classTokens) {
					if (ds.prefixes.some((p) => tok.startsWith(p))) continue;
					if (!likelyLookalike(tok, knownComponentStems)) continue;
					c.lookalike_tokens.add(tok);
					if (!pageDrift.has(url)) {
						pageDrift.set(url, {
							url,
							tokens: new Set(),
							cluster_ids: new Set(),
							rule_keys: new Set(),
						});
					}
					const drift = pageDrift.get(url);
					drift.tokens.add(tok);
					drift.cluster_ids.add(c.id);
					drift.rule_keys.add(ruleKey);
				}
			}
		}
	}

	function finalize(totalPages, templatePageThreshold = 10) {
		const perRuleComponentCount = new Map();
		for (const c of clusters.values()) {
			const key = `${c.engine_key}:${c.rule_id}`;
			perRuleComponentCount.set(key, (perRuleComponentCount.get(key) ?? 0) + 1);
		}

		const out = [...clusters.values()].map((c) => {
			const ruleKey = `${c.engine_key}:${c.rule_id}`;
			const pagesAffected = rulePages.get(ruleKey)?.size ?? c.pages.size;
			const severity = severityFor(ruleImpact.get(ruleKey) ?? null, pagesAffected, totalPages);
			const distinctComponents = perRuleComponentCount.get(ruleKey) ?? 1;
			const engineWeight = ENGINE_WEIGHT[c.engine_key] ?? 1;
			const score = Math.round(((SEVERITY_WEIGHT[severity] ?? 1) * engineWeight * c.pages.size / Math.max(1, distinctComponents)) * 100) / 100;

			return {
				id: c.id,
				engine_key: c.engine_key,
				rule_id: c.rule_id,
				severity,
				rule_pages_affected: pagesAffected,
				pages_affected: c.pages.size,
				instances: c.instances,
				selector_path: c.selector_path,
				snippet_shape: c.snippet_shape,
				representative_selector: c.representative_selector,
				representative_snippet: c.representative_snippet,
				design_components: [...c.design_components].sort(),
				drift: c.lookalike_tokens.size > 0,
				drift_tokens: [...c.lookalike_tokens].sort(),
				likely_source: c.pages.size >= templatePageThreshold ? 'template' : c.pages.size <= 2 ? 'content' : 'unknown',
				distinct_components_for_rule: distinctComponents,
				action_score: score,
				estimated_fix_impact: {
					findings: c.instances,
					pages: c.pages.size,
					statement: `Fix one place, resolve ~${c.instances} finding(s) on ${c.pages.size} page(s).`,
				},
				affected_pages: c.affected_pages,
			};
		});

		out.sort((a, b) => b.action_score - a.action_score || b.pages_affected - a.pages_affected || b.instances - a.instances);

		const designUsage = [];
		for (const [ruleKey, byComp] of ruleComponentHits.entries()) {
			const totalRuleExamples = Math.max(1, ruleExamples.get(ruleKey) ?? 1);
			for (const [component, count] of byComp.entries()) {
				designUsage.push({
					rule_key: ruleKey,
					component,
					findings: count,
					share_percent: Math.round((count / totalRuleExamples) * 1000) / 10,
				});
			}
		}
		designUsage.sort((a, b) => b.share_percent - a.share_percent || b.findings - a.findings);

		const pageUsage = [...pageComponents.entries()]
			.map(([url, comps]) => ({ url, components: [...comps].sort() }))
			.sort((a, b) => b.components.length - a.components.length);

		const driftPages = [...pageDrift.values()]
			.map((d) => ({
				url: d.url,
				tokens: [...d.tokens].sort(),
				cluster_ids: [...d.cluster_ids].sort(),
				rule_keys: [...d.rule_keys].sort(),
			}))
			.sort((a, b) => b.tokens.length - a.tokens.length || b.cluster_ids.length - a.cluster_ids.length);

		return {
			design_system: dsKey,
			design_system_label: ds.label,
			design_system_theme: target.design_system_theme ?? null,
			template_page_threshold: templatePageThreshold,
			total_clusters: out.length,
			clusters: out,
			top_actions: out.slice(0, 10),
			design_component_usage: designUsage.slice(0, 100),
			page_component_usage: pageUsage.slice(0, 300),
			drift_page_count: driftPages.length,
			drift_pages: driftPages.slice(0, 300),
			drift_clusters: out.filter((c) => c.drift).slice(0, 30),
		};
	}

	return { observe, finalize };
}

