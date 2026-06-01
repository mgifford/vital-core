import { z } from 'zod';

export const TargetSettingsSchema = z.object({
  postLoadDelay: z.number().default(2000), // Settle time in ms for dynamic frameworks
  max_pages: z.number().int().min(1).nullable().optional().default(null), // Optional crawl threshold; null means no cap
  maxTimeoutMs: z.number().default(120000), // 2-minute hard limit per page
  include_subdomains: z.boolean().default(false), // Keep scans constrained to base host by default
  sitemap_template_sample_cap: z.number().int().min(1).nullable().optional().default(null), // Optional per-template sample cap; null means unlimited
  sitemap_sample_stochastic: z.boolean().default(true), // Use deterministic pseudo-random ordering for sitemap sampling
  unique_page_focus: z.boolean().default(false), // Prioritize template diversity by limiting each template to one page
  /**
   * CDN-aware throttle profile for polite crawling.
   * Overrides CDN auto-detection when set explicitly.
   *   conservative — 3 s base delay (Akamai / Cloudflare / Imperva sites)
   *   moderate     — 1.5 s base delay (default when no strict CDN detected)
   *   aggressive   — 500 ms base delay (internal / low-traffic sites)
   */
  throttle_profile: z.enum(['conservative', 'moderate', 'aggressive']).nullable().optional().default(null),
  /**
   * Maximum number of pages to count as successfully scanned per calendar day for this target.
   * Prevents a single large domain from exhausting the daily scan budget.
   * Defaults to null (no per-target daily cap). When max_pages is set and daily_page_budget
   * is null, the engine applies a heuristic default of max_pages / 7.
   */
  daily_page_budget: z.number().int().min(1).nullable().optional().default(null)
});

export const TargetConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  base_url: z.string().url(),
  sitemap_url: z.string().url().optional(),
  include_paths: z.array(z.string()).default([]), // Glob patterns for path-filtering
  priority_urls: z.array(z.string().url()).default([]), // Forced execution URLs
  settings: TargetSettingsSchema.default({
    postLoadDelay: 2000,
    max_pages: null,
    maxTimeoutMs: 120000,
    include_subdomains: false,
    sitemap_template_sample_cap: null,
    sitemap_sample_stochastic: true,
    unique_page_focus: false,
    throttle_profile: null,
    daily_page_budget: null
  })
});

export const ProfileSchema = z.object({
  version: z.string(),
  profile: z.string(),
  description: z.string(),
  targets: z.array(TargetConfigSchema)
});

export type TargetSettings = z.infer<typeof TargetSettingsSchema>;
export type TargetConfig = z.infer<typeof TargetConfigSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
