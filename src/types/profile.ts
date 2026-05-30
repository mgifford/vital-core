import { z } from 'zod';

export const TargetSettingsSchema = z.object({
  postLoadDelay: z.number().default(2000), // Settle time in ms for dynamic frameworks
  max_pages: z.number().default(25),      // Maximum crawl threshold to prevent runner timeouts
  maxTimeoutMs: z.number().default(120000), // 2-minute hard limit per page
  include_subdomains: z.boolean().default(false) // Keep scans constrained to base host by default
});

export const TargetConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  base_url: z.string().url(),
  sitemap_url: z.string().url().optional(),
  include_paths: z.array(z.string()).default([]), // Glob patterns for path-filtering
  priority_urls: z.array(z.string().url()).default([]), // Forced execution URLs
  settings: TargetSettingsSchema.default({ postLoadDelay: 2000, max_pages: 25, maxTimeoutMs: 120000, include_subdomains: false })
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
