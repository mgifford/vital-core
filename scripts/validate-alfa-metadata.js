#!/usr/bin/env node
import { validateAlfaMetadataFromWorkspace } from '../src/lib/alfa-metadata-validation.js';

const { errors, warnings } = await validateAlfaMetadataFromWorkspace();
for (const w of warnings) console.warn(`[alfa-metadata] WARN: ${w}`);
for (const e of errors) console.error(`[alfa-metadata] ERROR: ${e}`);

if (errors.length > 0) {
  process.exitCode = 1;
} else {
  console.log(`[alfa-metadata] OK (${warnings.length} warning${warnings.length === 1 ? '' : 's'})`);
}
