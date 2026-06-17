#!/usr/bin/env bash
# Update the vendored @fizz/paracharts accessible-charts web component.
#
# ParaCharts (https://github.com/fizzstudio/ParaCharts, AGPL-3.0) is published
# only to a private npm registry, but Fizz Studio ships a prebuilt public
# runtime bundle via the fizzstudio/ParaCharts-demo repo, served over the
# jsDelivr GitHub CDN. We vendor that prebuilt bundle so the report pipeline
# needs no build step and the AGPL component is served first-party from
# GitHub Pages rather than pulled from a CDN at view time.
#
# Usage: bash scripts/update-paracharts.sh [ref]
#   ref defaults to "main" (the demo repo's branch/tag).
# Requires: curl.

set -euo pipefail

VENDOR="vendor/paracharts"
REF="${1:-main}"
BUNDLE_URL="https://cdn.jsdelivr.net/gh/fizzstudio/ParaCharts-demo@${REF}/script/paracharts.js"
SOURCE_REPO="https://github.com/fizzstudio/ParaCharts"

echo "Updating ParaCharts vendor from ${BUNDLE_URL}..."
mkdir -p "${VENDOR}"

# Fetch the prebuilt ESM bundle.
curl -fsSL "${BUNDLE_URL}" -o "${VENDOR}/paracharts.js"

# Sanity: the bundle should be non-trivial JavaScript.
BYTES=$(wc -c < "${VENDOR}/paracharts.js" | tr -d ' ')
if [ "${BYTES}" -lt 10000 ]; then
  echo "error: fetched bundle is suspiciously small (${BYTES} bytes)" >&2
  exit 1
fi

cat > "${VENDOR}/VERSION" <<EOF
source:  ${SOURCE_REPO}
bundle:  ${BUNDLE_URL}
ref:     ${REF}
license: AGPL-3.0
bytes:   ${BYTES}
date:    $(date -u +%Y-%m-%d)
EOF

# Record the license obligation (the bundle carries an inline @license header;
# this file makes the obligation explicit alongside the vendored copy).
cat > "${VENDOR}/LICENSE" <<EOF
ParaCharts is licensed under the GNU Affero General Public License v3.0
(AGPL-3.0). This directory vendors the prebuilt public runtime bundle from
${SOURCE_REPO}. The full license text is at:
https://www.gnu.org/licenses/agpl-3.0.txt
EOF

echo ""
echo "Vendored ParaCharts (${BYTES} bytes) into ${VENDOR}/"
ls -la "${VENDOR}/"
