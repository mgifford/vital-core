#!/usr/bin/env bash
# Fails fast when CI cannot push to the data repo checked out at $1 (default
# data/). Both workflows run it before any scanning or building: without a
# usable VITAL_DATA_DEPLOY_KEY, actions/checkout falls back to the workflow
# token, which can read a public data repo but not push to it, so a run would
# otherwise do all its work and then lose it at the final push. Git's own
# error goes into a run annotation so the cause shows on the run page without
# opening the step log.
#
# Expects HAS_DEPLOY_KEY=true|false (secrets can't be tested in `if:`).

set -uo pipefail

DIR="${1:-data}"
TITLE="Data repo push access"

if [ "${HAS_DEPLOY_KEY:-}" != "true" ]; then
  echo "::error title=${TITLE}::The VITAL_DATA_DEPLOY_KEY repository secret is missing or empty, so the data repo was checked out with the workflow token, which can read it but not push to it. Add the private half of a write-enabled deploy key on the data repo as that secret (see ARCHITECTURE.md, Data repo)."
  exit 1
fi

if out=$(git -C "$DIR" push --dry-run origin HEAD 2>&1); then
  printf '%s\n' "$out"
  echo "Push access to the data repo confirmed."
  exit 0
fi

printf '%s\n' "$out" >&2
msg=${out//'%'/%25}
msg=${msg//$'\r'/}
msg=${msg//$'\n'/%0A}
echo "::error title=${TITLE}::git push --dry-run to the data repo was rejected. A read-only deploy key, a key added to the wrong repo, or a branch rule on the data repo can cause this.%0A${msg}"
exit 1
