#!/usr/bin/env bash
# Download the sysml-toolkit browser package (the app's engine) pinned in toolkit.json,
# check its SHA-256, and unpack what the app serves into static/toolkit/.
set -euo pipefail
cd "$(dirname "$0")/.."

field() { node -e "process.stdout.write(require('./toolkit.json')['$1'])"; }
url=$(field url)
sha=$(field sha256)
cache=.cache/toolkit
tarball="$cache/$(basename "$url")"

mkdir -p "$cache"
if [ ! -f "$tarball" ] || ! echo "$sha  $tarball" | sha256sum -c --status; then
	curl -fsSL --retry 3 -o "$tarball" "$url"
fi
echo "$sha  $tarball" | sha256sum -c --quiet

rm -rf static/toolkit "$cache/package"
tar -xzf "$tarball" -C "$cache"
mkdir -p static/toolkit/stdlib
cp "$cache/package/sysmlv2.js" "$cache/package/sysmlv2_bg.wasm" \
	"$cache/package/LICENSE" "$cache/package/LICENSE-EPL-2.0" "$cache/package/THIRD-PARTY-NOTICES.md" \
	static/toolkit/
cp "$cache/package/stdlib/"* static/toolkit/stdlib/
echo "sysml-toolkit $(field version) → static/toolkit/"
