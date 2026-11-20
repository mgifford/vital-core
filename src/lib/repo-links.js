/**
 * Repository links in generated reports.
 *
 * A fleet instance (vital-core-lgd and friends) deploys its own copy of this
 * engine and its docs, so "Repository", API.md, MCP.md and README belong to
 * the instance, not the upstream template. GitHub Actions sets
 * GITHUB_REPOSITORY for every step; a local build falls back to upstream.
 */
const DEFAULT_REPO = 'mgifford/vital-core';
const SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function sourceRepo(env = process.env) {
  const slug = env.GITHUB_REPOSITORY;
  return typeof slug === 'string' && SLUG.test(slug) ? slug : DEFAULT_REPO;
}

export function repoUrl(env) {
  return `https://github.com/${sourceRepo(env)}`;
}

export function repoBlobBase(env) {
  return `${repoUrl(env)}/blob/main`;
}
