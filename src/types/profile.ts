import { z } from 'zod';

export const TargetSettingsSchema = z.object({
  postLoadDelay: z.number().default(2000), // Settle time in ms for dynamic frameworks
  max_pages: z.number().int().min(1).nullable().optional().default(null), // Optional crawl threshold; null means no cap
  maxTimeoutMs: z.number().default(120000), // 2-minute hard limit per page
  include_subdomains: z.boolean().default(false), // Keep scans constrained to base host by default
  sitemap_template_sample_cap: z.number().int().min(1).nullable().optional().default(null), // Optional per-template sample cap; null means unlimited
  sitemap_sample_stochastic: z.boolean().default(true) // Use deterministic pseudo-random ordering for sitemap sampling
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
    sitemap_sample_stochastic: true
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
