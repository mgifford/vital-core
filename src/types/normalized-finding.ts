import { z } from 'zod';
import { IssueSeveritySchema } from './site-quality-spec';

export const FindingSourceEngineSchema = z.enum(['alfa', 'axe']);

export const StandardsReferencesSchema = z.object({
  act: z.array(z.string()),
  wcag: z.array(z.string()),
  section508: z.array(z.string())
});

export const EngineSourceMetadataSchema = z.object({
  engine: FindingSourceEngineSchema,
  ruleId: z.string(),
  ruleName: z.string().nullable(),
  helpUrl: z.string().url().nullable(),
  impact: z.string().nullable(),
  rawEvidenceRef: z.string().nullable()
});

export const NormalizedEvidenceSchema = z.object({
  sourceEngine: FindingSourceEngineSchema,
  html: z.string(),
  target: z.array(z.string()),
  failureSummary: z.string(),
  rawEvidenceRef: z.string().nullable()
});

export const NormalizedFindingSchema = z.object({
  canonicalRuleKey: z.string(),
  pageUrl: z.string().url(),
  title: z.string(),
  description: z.string(),
  severity: IssueSeveritySchema,
  sourceEngines: z.array(FindingSourceEngineSchema).min(1),
  standards: StandardsReferencesSchema,
  sourceMetadata: z.array(EngineSourceMetadataSchema).min(1),
  evidence: z.array(NormalizedEvidenceSchema)
});

export type FindingSourceEngine = z.infer<typeof FindingSourceEngineSchema>;
export type StandardsReferences = z.infer<typeof StandardsReferencesSchema>;
export type EngineSourceMetadata = z.infer<typeof EngineSourceMetadataSchema>;
export type NormalizedEvidence = z.infer<typeof NormalizedEvidenceSchema>;
export type NormalizedFinding = z.infer<typeof NormalizedFindingSchema>;
