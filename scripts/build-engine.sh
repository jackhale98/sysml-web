#!/usr/bin/env bash
# Build the SysML engine (sysml-wasm from jackhale98/sysml-cli) at the
# revision pinned in engine.json and install it into static/engine/.
#
#   scripts/build-engine.sh
#
# Set SYSML_CLI_DIR to build from an existing local checkout instead of the
# pinned revision (for engine development). Needs Rust with the
# wasm32-unknown-unknown target, clang, and wasm-bindgen-cli at the version
# in engine.json.
set -euo pipefail

cd "$(dirname "$0")/.."
repo=$(node -p "require('./engine.json').repository")
rev=$(node -p "require('./engine.json').rev")
out="static/engine"

if [[ -n "${SYSML_CLI_DIR:-}" ]]; then
    src="$SYSML_CLI_DIR"
else
    src=".cache/sysml-cli"
    if [[ "$(git -C "$src" rev-parse HEAD 2>/dev/null)" != "$rev" ]]; then
        rm -rf "$src"
        git init -q "$src"
        git -C "$src" remote add origin "$repo"
        git -C "$src" fetch -q --depth 1 origin "$rev"
        git -C "$src" checkout -q FETCH_HEAD
        git -C "$src" submodule update -q --init --depth 1
    fi
fi

"$src/scripts/build-wasm.sh" "$PWD/$out"
printf '{"rev":"%s"}\n' "$(git -C "$src" rev-parse HEAD)" >"$out/build.json"
