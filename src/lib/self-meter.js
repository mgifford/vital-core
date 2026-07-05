// src/lib/self-meter.js
// Self‑metering utilities for estimating the service's own CO₂ impact.
// This module queries the GitHub Actions API for the past week’s workflow job durations
// and converts them to estimated energy consumption and CO₂ emissions using documented
// assumptions. The resulting record is stored append‑only in data/_meta/service-cost.json.

import fetch from 'node-fetch'; // node-fetch is available in the repo dependencies
import { weekRange } from './week.js';
import { writeJsonFile } from './fs-utils.js'; // utility to write JSON safely

/**
 * Configuration constants (all values are documented in the assumptions page).
 * Adjust these if the hosting environment changes.
 */
export const ASSUMPTIONS = {
  // Azure hosted runner spec: 4 vCPU, average power draw 20 W (range 15–25 W)
  POWER_WATTS: 20,
  // Power Usage Effectiveness – additional overhead for cooling, etc.
  PUE: 1.2,
  // Grid carbon intensity, g CO₂e per kWh (static for now)
  GRID_INTENSITY_G_PER_KWH: 500,
  // GitHub API base URL – can be overridden for GH Enterprise
  API_BASE: 'https://api.github.com',
};

/**
 * Helper to construct the authentication headers for the GitHub API.
 * It prefers the GITHUB_TOKEN environment variable; falls back to unauthenticated (rate‑limited).
 */
function authHeaders() {
  const token = process.env.GITHUB_TOKEN;
  return token ? { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } : { Accept: 'application/vnd.github+json' };
}

/**
 * Fetch all workflow runs for the repository that started within the provided ISO week.
 * Returns an array of run objects as returned by the GitHub API.
 */
export async function fetchWorkflowRuns({ owner, repo, isoWeek }) {
  const { start, end } = weekRange(isoWeek);
  const runs = [];
  let page = 1;
  const perPage = 100; // maximum allowed
  const urlBase = `${ASSUMPTIONS.API_BASE}/repos/${owner}/${repo}/actions/runs`;
  const isoStart = start.toISOString();
  const isoEnd = end.toISOString();

  while (true) {
    const url = `${urlBase}?created=>=${isoStart}&created=<=${isoEnd}&per_page=${perPage}&page=${page}`;
    const resp = await fetch(url, { headers: authHeaders() });
    if (!resp.ok) {
      throw new Error(`GitHub API request failed: ${resp.status} ${resp.statusText}`);
    }
    const data = await resp.json();
    runs.push(...(data.workflow_runs || []));
    if (!data.total_count || data.workflow_runs.length < perPage) break;
    page += 1;
  }
  return runs;
}

/**
 * Given an array of workflow runs, fetch each run’s jobs and sum their total duration (in minutes).
 * The GitHub jobs endpoint: GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs
 */
export async function fetchTotalJobMinutes({ owner, repo, runs }) {
  let totalMinutes = 0;
  for (const run of runs) {
    const jobsUrl = `${ASSUMPTIONS.API_BASE}/repos/${owner}/${repo}/actions/runs/${run.id}/jobs`;
    const resp = await fetch(jobsUrl, { headers: authHeaders() });
    if (!resp.ok) {
      console.warn(`Failed to fetch jobs for run ${run.id}: ${resp.status}`);
      continue;
    }
    const data = await resp.json();
    for (const job of data.jobs || []) {
      if (typeof job.run_duration_ms === 'number') {
        totalMinutes += job.run_duration_ms / 60000;
      } else if (job.started_at && job.completed_at) {
        const start = new Date(job.started_at);
        const end = new Date(job.completed_at);
        totalMinutes += (end - start) / 60000;
      }
    }
  }
  return totalMinutes;
}

/**
 * Convert runner‑minutes to energy (kWh) and CO₂e (g).
 * Formula: energy (kWh) = (minutes / 60) * POWER_WATTS / 1000 * PUE
 * CO₂e (g) = energy_kWh * GRID_INTENSITY_G_PER_KWH
 */
export function convertToCarbon({ minutes }) {
  const hours = minutes / 60;
  const energyKWh = hours * (ASSUMPTIONS.POWER_WATTS / 1000) * ASSUMPTIONS.PUE;
  const carbonG = energyKWh * ASSUMPTIONS.GRID_INTENSITY_G_PER_KWH;
  return { hours, energyKWH: energyKWh, carbonG };
}

/**
 * Main entry point – called by the aggregation step.
 * It resolves the repository from the environment, fetches job minutes for the
 * previous ISO week, converts them, and appends a record to data/_meta/service-cost.json.
 */
export async function recordSelfMetering({ isoWeek }) {
  const repoInfo = process.env.GITHUB_REPOSITORY || '';
  const [owner, repo] = repoInfo.split('/') || [];
  if (!owner || !repo) {
    throw new Error('GITHUB_REPOSITORY env var not set; cannot determine repository');
  }

  const runs = await fetchWorkflowRuns({ owner, repo, isoWeek });
  const minutes = await fetchTotalJobMinutes({ owner, repo, runs });
  const { hours, energyKWH, carbonG } = convertToCarbon({ minutes });

  const record = {
    isoWeek,
    timestamp: new Date().toISOString(),
    runnerHours: hours,
    estimatedKWh: energyKWH,
    estimatedCO2g: carbonG,
    rawMinutes: minutes,
  };

  const outPath = `${process.cwd()}/data/_meta/service-cost.json`;
  await writeJsonFile(outPath, record);
  return record;
}

export default {
  recordSelfMetering,
  ASSUMPTIONS,
};
