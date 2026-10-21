#!/usr/bin/env bash
# SPIKE: the full measurement batch. Needs: npm run build; the gzip server
# (node scripts/spike/serve-gz.mjs 4575 build); CPU_THROTTLE_BIN.
# usage: scripts/spike/run-all.sh <results.jsonl> [runs=5]
set -u
out="$1"; n="${2:-5}"
cd "$(dirname "$0")/../.."
m() { echo "== $(date -u +%H:%M:%S) $* | $(uptime)" | tee -a "$out.log"; node scripts/spike/measure.mjs --out "$out" "$@" 2>>"$out.log"; }
# phone, cold cache
m --profile phone --cache cold --target app --runs "$n"
m --profile phone --cache cold --target ours --runs "$n" --edits
m --profile phone --cache cold --target libcache --runs "$n" --edits
m --profile phone --cache cold --target none --runs "$n" --edits
m --profile phone --cache cold --target prepared-stream --runs "$n" --edits
m --profile phone --cache cold --target prepared --runs 3
m --profile phone --cache cold --target subset --runs 3 --edits
m --profile phone --cache cold --target libcache --wasm plain --runs 3
# phone, warm cache (service worker active, second visit)
m --profile phone --cache warm --target app --runs "$n"
m --profile phone --cache warm --target ours --runs "$n"
m --profile phone --cache warm --target libcache --runs "$n"
m --profile phone --cache warm --target none --runs "$n"
m --profile phone --cache warm --target prepared-stream --runs "$n"
# desktop, no throttling
m --profile desktop --cache cold --target app --runs "$n"
m --profile desktop --cache cold --target ours --runs "$n" --edits
m --profile desktop --cache cold --target libcache --runs "$n" --edits
m --profile desktop --cache cold --target none --runs "$n" --edits
m --profile desktop --cache cold --target prepared-stream --runs "$n" --edits
m --profile desktop --cache warm --target ours --runs "$n"
m --profile desktop --cache warm --target libcache --runs "$n"
m --profile desktop --cache warm --target none --runs "$n"
m --profile desktop --cache warm --target prepared-stream --runs "$n"
echo "== done $(date -u +%H:%M:%S) | $(uptime)" | tee -a "$out.log"
