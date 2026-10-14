#!/usr/bin/env node
// Prints the owner/name of the repo CI checks out into data/ (see
// `data_repo` in config/targets.yml). Used by scan.yml and report.yml.
import { loadConfig, ciDataRepo } from '../src/lib/config.js';

console.log(ciDataRepo(loadConfig()));
