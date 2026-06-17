#!/usr/bin/env bash
# Update the vendored @fizz/paracharts accessible-charts web component.
#
# ParaCharts (https://github.com/fizzstudio/ParaCharts) ships as a prebuilt
# ESM bundle on npm. We vendor the built dist/ so the report pipeline never
# needs a build step (matching the no-build principle of this repo) and so
# the AGPL-3.0 component is served first-party from GitHub Pages rather than
# pulled from a CDN at view time.
#
# Usage: bash scripts/update-paracharts.sh [version]
#   version defaults to the latest published on npm.
# Requires: npm, node, tar.

set -euo pipefail

VENDOR="vendor/paracharts"
PKG="@fizz/paracharts"
VERSION="${1:-latest}"

echo "Updating ParaCharts vendor from npm ${PKG}@${VERSION}..."

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

# npm pack downloads the published tarball without installing it.
TARBALL="$(cd "${TMP}" && npm pack "${PKG}@${VERSION}" 2>/dev/null | tail -n1)"
RESOLVED_VERSION="$(node -e "console.log(require('${TMP}/'+process.argv[1]+'').version)" 2>/dev/null || true)"
tar -xzf "${TMP}/${TARBALL}" -C "${TMP}"

# npm tarballs extract to a top-level "package/" directory.
SRC="${TMP}/package"
if [ ! -f "${SRC}/package.json" ]; then
  echo "error: unexpected tarball layout (no package/package.json)" >&2
  exit 1
fi

# Read the real version + the dist entry points from package.json exports.
RESOLVED_VERSION="$(node -e "console.log(require('${SRC}/package.json').version)")"
JS_ENTRY="$(node -e "const p=require('${SRC}/package.json');console.log((p.exports&&p.exports['.'])||'./dist/paracharts.js')")"
CSS_ENTRY="$(node -e "const p=require('${SRC}/package.json');console.log((p.exports&&p.exports['./stylesheet'])||'./dist/style.css')")"

mkdir -p "${VENDOR}"
cp "${SRC}/${JS_ENTRY#./}"  "${VENDOR}/paracharts.js"
cp "${SRC}/${CSS_ENTRY#./}" "${VENDOR}/paracharts.css"

# Preserve the upstream license text (AGPL-3.0).
for lic in LICENSE LICENSE.md LICENSE.txt; do
  if [ -f "${SRC}/${lic}" ]; then cp "${SRC}/${lic}" "${VENDOR}/LICENSE"; break; fi
done

cat > "${VENDOR}/VERSION" <<EOF
source:  https://github.com/fizzstudio/ParaCharts
package: ${PKG}
version: ${RESOLVED_VERSION}
license: AGPL-3.0
date:    $(date -u +%Y-%m-%d)
EOF

echo ""
echo "Vendored ${PKG}@${RESOLVED_VERSION} into ${VENDOR}/"
ls -la "${VENDOR}/"
