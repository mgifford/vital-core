#!/usr/bin/env node
/**
 * Quick diagnostic for the local LLM integration (any OpenAI-compatible
 * server: llama.cpp's llama-server, Ollama, LM Studio, etc.).
 *
 * Probes the configured server, reports availability and the detected
 * model, and runs a short test prompt so you can confirm the integration
 * works before running a full scan.
 *
 * Usage:
 *   node scripts/check-ollama.js
 *   node scripts/check-ollama.js --json   # machine-readable output
 *   npm run check:ollama
 *
 * Exit code: 0 always (diagnostic only, not a CI gate).
 */

import { isAvailable, detectModel, chat } from '../src/lib/ollama.js';

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');

const url = process.env.VITAL_OLLAMA_URL ?? 'http://localhost:11434';

const colour = !jsonMode && process.stdout.isTTY;
const c = {
  pass:  colour ? '\x1b[32m' : '',
  fail:  colour ? '\x1b[31m' : '',
  dim:   colour ? '\x1b[2m'  : '',
  bold:  colour ? '\x1b[1m'  : '',
  reset: colour ? '\x1b[0m'  : '',
};

const available = await isAvailable();
let model = null;
let testResponse = null;

if (available) {
  model = await detectModel();
  testResponse = await chat('Say "the LLM server is working" and nothing else.');
}

if (jsonMode) {
  process.stdout.write(JSON.stringify({ url, available, model, test_response: testResponse }, null, 2) + '\n');
  process.exit(0);
}

console.log(`\n${c.bold}Local LLM diagnostic${c.reset} ${c.dim}(${url})${c.reset}\n`);

if (available) {
  console.log(`  ${c.pass}✓${c.reset} Server reachable`);
  console.log(`  ${c.pass}✓${c.reset} Model: ${c.bold}${model}${c.reset}`);
  if (testResponse) {
    console.log(`  ${c.pass}✓${c.reset} Test response: ${c.dim}${testResponse}${c.reset}`);
  } else {
    console.log(`  ${c.fail}✗${c.reset} Test prompt returned no response`);
  }
} else {
  console.log(`  ${c.fail}✗${c.reset} Server not reachable at ${url}`);
  console.log(`\n  ${c.dim}Troubleshooting:${c.reset}`);
  console.log(`  ${c.dim}  • Is the server running? (llama.cpp: llama-server, Ollama: ollama serve)${c.reset}`);
  console.log(`  ${c.dim}  • Wrong URL? Set: export VITAL_OLLAMA_URL=http://<host>:11434${c.reset}`);
  console.log(`  ${c.dim}  • The LLM server is optional — reports build fine without it.${c.reset}`);
}

console.log('');
