#!/usr/bin/env bash
# Update the vendored HTTPArchive/wappalyzer fingerprint database.
# Run this periodically (e.g. monthly) to pick up new technology detections.
#
# Usage: bash scripts/update-wappalyzer.sh
# Requires: gh (GitHub CLI), authenticated.

set -euo pipefail

VENDOR="vendor/wappalyzer"
REPO="HTTPArchive/wappalyzer"
BRANCH="main"

echo "Updating wappalyzer vendor from github.com/${REPO}@${BRANCH}..."

mkdir -p "${VENDOR}/technologies"

fetch() {
  local remote_path="$1" local_path="$2"
  gh api "repos/${REPO}/contents/${remote_path}" --jq '.content' | base64 -d > "${local_path}"
}

fetch "src/js/wappalyzer.js"  "${VENDOR}/wappalyzer.js"
fetch "src/categories.json"   "${VENDOR}/categories.json"

for letter in _ a b c d e f g h i j k l m n o p q r s t u v w x y z; do
  fetch "src/technologies/${letter}.json" "${VENDOR}/technologies/${letter}.json"
  printf "  ✓ %s.json\n" "${letter}"
done

COMMIT=$(gh api "repos/${REPO}/commits/${BRANCH}" --jq '.sha[0:8]')
DATE=$(gh api "repos/${REPO}/commits/${BRANCH}" --jq '.commit.author.date[0:10]')

cat > "${VENDOR}/VERSION" <<EOF
source: https://github.com/${REPO}
commit: ${COMMIT}
date:   ${DATE}
EOF

echo ""
echo "Done. Vendored ${REPO}@${COMMIT} (${DATE})."
echo "Run 'node --test tests/unit/lib.test.js' to verify nothing broke."
