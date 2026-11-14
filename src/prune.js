#!/usr/bin/env node
/**
 * Legacy prune entry point: intentionally disabled.
 *
 * Historical page evidence may only be removed by scripts/retention-prune.js
 * after the configured policy has a verified archive and the operator supplies
 * --execute --confirm-domain. Leaving this command as a destructive alias would
 * let npm run prune and old workflow calls bypass that gate.
 */

console.error('src/prune.js is disabled: it cannot verify an archive or obtain explicit authorization.');
console.error('Run: npm run retention:prune-check -- --domain <key>');
console.error('Then, only after approval: npm run retention:prune -- --domain <key> --execute --confirm-domain <key>');
process.exitCode = 1;
