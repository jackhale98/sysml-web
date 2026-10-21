#!/usr/bin/env bash
# SPIKE: copy a built @sysml/wasm web package (wasm-bindgen --target web output
# plus stdlib/) into static/toolkit/ (git-ignored), and write the demo's
# library subset next to the stdlib.
# usage: scripts/spike/copy-toolkit.sh [/home/user/eval-toolkit/pkg-tk/web]
set -euo pipefail
src="${1:-/home/user/eval-toolkit/pkg-tk/web}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
rm -rf "$root/static/toolkit" && mkdir -p "$root/static/toolkit"
cp -r "$src"/* "$root/static/toolkit/"
node "$root/scripts/spike/lib-subset.mjs" "$root/static/toolkit/stdlib/sysml-library.json.gz" "$root/src/demo/drone" \
	> "$root/static/toolkit/stdlib/demo-subset.json"
ls -l "$root/static/toolkit" "$root/static/toolkit/stdlib"
