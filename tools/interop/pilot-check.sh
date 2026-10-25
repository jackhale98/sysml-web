#!/usr/bin/env bash
# Check SysML files with the OMG SysML v2 pilot implementation (the reference
# implementation), headless. Independent of Fairtide's own engine.
#
#   tools/interop/pilot-check.sh [options] <file-or-dir>...
#
# Options (all others are passed to PilotCheck.java):
#   --version X    pilot release to use (default 0.57.0, or $PILOT_VERSION)
#   --library DIR  sysml.library to load (default: the one shipped with that release)
#   --json FILE    also write every issue as JSON
#   --quiet        list only files that have errors or warnings
#   --each-dir     check each subfolder of a directory argument as its own model
#
# Exit status: 0 no errors, 1 errors found, 2 usage/setup problem.
#
# The first run downloads the pilot's self-contained jar (the Jupyter kernel
# package from conda-forge, ~90-125 MB) into .cache/interop/ and checks its
# SHA-256. Needs: java 21+, curl, unzip, zstd (apt install zstd / brew install zstd).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
version="${PILOT_VERSION:-0.57.0}"
library=""
pass=()
while [ $# -gt 0 ]; do
	case "$1" in
		--version) version="$2"; shift 2 ;;
		--library) library="$2"; shift 2 ;;
		*) pass+=("$1"); shift ;;
	esac
done
if [ ${#pass[@]} -eq 0 ]; then
	sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
	exit 2
fi

cache="$root/.cache/interop/pilot-$version"
kdir="$cache/pkg/share/jupyter/kernels/sysml"
jar="$kdir/jupyter-sysml-kernel-$version-all.jar"

# Known checksums (from api.anaconda.org); other versions are checked against the API.
declare -A sha=(
	[0.57.0]=8d6ac883fc68d5b313a6db5558cb7a1147f0e34bd33ba6c9a5898f6a17c23ccc
	[0.62.0]=67997bf79f88acb3d9617e3ca33e2a17f8562a00bc1500ae3b15f4f113c11cd6
)

if [ ! -f "$jar" ]; then
	for tool in java curl unzip zstd sha256sum; do
		command -v "$tool" >/dev/null || { echo "pilot-check: needs '$tool' on PATH" >&2; exit 2; }
	done
	mkdir -p "$cache"
	name="jupyter-sysml-kernel-$version-pyhd8ed1ab_0.conda"
	echo "pilot-check: downloading pilot $version ($name) from conda-forge..." >&2
	curl -fsSL --retry 3 -o "$cache/kernel.conda" "https://conda.anaconda.org/conda-forge/noarch/$name"
	want="${sha[$version]:-}"
	if [ -z "$want" ]; then
		want="$(curl -fsS https://api.anaconda.org/package/conda-forge/jupyter-sysml-kernel |
			python3 -c "import json,sys; v=sys.argv[1]; print(next(f['sha256'] for f in json.load(sys.stdin)['files'] if f['version']==v and f['basename'].endswith('.conda')))" "$version")"
	fi
	got="$(sha256sum "$cache/kernel.conda" | cut -d' ' -f1)"
	if [ "$got" != "$want" ]; then
		echo "pilot-check: checksum mismatch for $name (got $got, want $want)" >&2
		rm -f "$cache/kernel.conda"
		exit 2
	fi
	( cd "$cache" && unzip -o -q kernel.conda 'pkg-*.tar.zst' && mkdir -p pkg &&
		tar --zstd -xf pkg-*.tar.zst -C pkg && rm -f pkg-*.tar.zst kernel.conda )
	[ -f "$jar" ] || { echo "pilot-check: $jar not found after extraction" >&2; exit 2; }
fi

library="${library:-$kdir/sysml.library}"

# Split options from paths: PilotCheck wants <library> before the paths.
opts=() paths=()
i=0
while [ $i -lt ${#pass[@]} ]; do
	a="${pass[$i]}"
	case "$a" in
		--json) opts+=("$a" "${pass[$((i + 1))]}"); i=$((i + 2)); continue ;;
		--*) opts+=("$a") ;;
		*) paths+=("$a") ;;
	esac
	i=$((i + 1))
done

echo "pilot-check: SysML v2 pilot $version, library $library" >&2
# JAVA_TOOL_OPTIONS chatter and log4j's "no appenders" notice go to stderr; drop them.
exec java -Xss4m -cp "$jar" "$here/pilot/PilotCheck.java" "${opts[@]}" "$library" "${paths[@]}" \
	2> >(grep -v -e '^Picked up JAVA_TOOL_OPTIONS' -e '^log4j:WARN' >&2)
