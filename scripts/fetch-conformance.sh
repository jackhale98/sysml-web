#!/usr/bin/env bash
# Fetch the corpora the conformance runner reads (tests/conformance/) into
# .cache/conformance/, pinned so a run is reproducible:
#   sysml-v2-release  OMG SysML v2 Release 2026-05, the release the toolkit's
#                     standard library comes from (examples, training,
#                     validation, KerML examples)
#   sysml-v2-pilot    the OMG pilot implementation's Xpect test suites, same release
#   opensysml         OpenSysML's negative corpus and its record of the pilot's verdicts
# Licences: the release and the pilot are EPL-2.0, OpenSysML Apache-2.0. Nothing is vendored.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cache="$root/.cache/conformance"
mkdir -p "$cache"

# fetch <dir> <repo> <commit> <sparse paths...>
fetch() {
	local name="$1" dir="$cache/$1" repo="$2" commit="$3"
	shift 3
	if [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null)" = "$commit" ]; then
		echo "$name at $commit"
		return
	fi
	rm -rf "$dir"
	git init -q "$dir"
	git -C "$dir" remote add origin "$repo"
	git -C "$dir" sparse-checkout set --no-cone "$@"
	git -C "$dir" fetch -q --depth 1 --filter=blob:none origin "$commit"
	git -C "$dir" checkout -q FETCH_HEAD
	echo "$name at $(git -C "$dir" rev-parse HEAD)"
}

fetch sysml-v2-release https://github.com/Systems-Modeling/SysML-v2-Release.git \
	de1070ae8e79c21532b8004fc663d47b35d0e9fa '/sysml/src/' '/kerml/src/' '/LICENSE'
fetch sysml-v2-pilot https://github.com/Systems-Modeling/SysML-v2-Pilot-Implementation.git \
	fa709f28dfd49dfdb7ee83e4e19da2f57e0eb3aa '/org.omg.kerml.xpect.tests/src/' '/org.omg.sysml.xpect.tests/src/' '/LICENSE'
fetch opensysml https://github.com/Open-MBEE/OpenSysML.git \
	a662c2bce8882349feeac0c54a29952fde1cc143 '/tools/referee/reject/testdata/' \
	'/docs/project/pilot-rejection-baseline.json' '/LICENSE'
