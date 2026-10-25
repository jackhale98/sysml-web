#!/usr/bin/env bash
# Show that the pilot checker works: it must flag the deliberately broken
# files in tools/interop/pilot/must-fail/, and it must pass the OMG release
# corpus (sysml/src/examples, training, validation) the way the pilot's own
# build does.
#
#   tools/interop/pilot-corpus.sh [release-checkout-dir | release-tag]
#
# Default: .cache/sysml-cli/sysml-v2-release (the checkout the app's scripts
# use), or else a shallow clone of tag 2026-02 into .cache/interop/. The pilot
# version is read from that release (install/jupyter/install.sh), so the jar,
# library and corpus always match.
#
# Each examples/ subfolder is checked as its own model (they are independent
# and reuse names). training/ and validation/ are each checked as one model,
# because their lessons import each other's packages.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
arg="${1:-}"
if [ -z "$arg" ]; then
	for d in "$root/.cache/sysml-cli/sysml-v2-release" "$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/../.cache/sysml-cli/sysml-v2-release"; do
		[ -d "$d/sysml/src" ] && { arg="$d"; break; }
	done
	arg="${arg:-2026-02}"
fi
if [ -d "$arg" ]; then
	release="$(cd "$arg" && pwd)"
else
	release="$root/.cache/interop/sysml-v2-release-$arg"
	if [ ! -d "$release/sysml/src" ]; then
		echo "pilot-corpus: cloning SysML-v2-Release tag $arg..." >&2
		git clone -q --depth 1 --branch "$arg" https://github.com/Systems-Modeling/SysML-v2-Release.git "$release"
	fi
fi
version="$(sed -n 's/^SYSML_VERSION="\(.*\)"/\1/p' "$release/install/jupyter/install.sh")"
[ -n "$version" ] || { echo "pilot-corpus: no SYSML_VERSION in $release/install/jupyter/install.sh" >&2; exit 2; }
out="$root/.cache/interop/results/pilot-$version"
mkdir -p "$out"
echo "pilot-corpus: release $release (pilot $version); JSON in $out" >&2

check() { "$here/pilot-check.sh" --version "$version" --quiet "$@" || true; }
summary() { python3 -c '
import json, sys
s = json.load(open(sys.argv[1]))["summary"]
print("{:<24} files {files:>4}  with errors {filesWithErrors:>3}  errors {errors:>4}  warnings {warnings:>3}".format(sys.argv[2], **s))
' "$1" "$2"; }

echo "== must-fail fixtures (the checker has to find these)"
check --json "$out/must-fail.json" "$here/pilot/must-fail"
python3 - "$out/must-fail.json" <<'EOF'
import json, sys
files = {f["file"].rsplit("/", 1)[-1]: [i for i in f["issues"] if i["severity"] == "ERROR"] for f in json.load(open(sys.argv[1]))["files"]}
want = {
    "Syntax.sysml": "org.eclipse.xtext.diagnostics.Diagnostic.Syntax",
    "Linking.sysml": "org.eclipse.xtext.diagnostics.Diagnostic.Linking",
    "Rules.sysml": "validateOccurrenceUsageType_",
}
ok = True
for name, code in want.items():
    hit = any(i["code"] == code for i in files.get(name, []))
    print(f"  {name:<14} expects {code}: {'found' if hit else 'MISSING'}")
    ok &= hit
linking = files.get("Linking.sysml", [])
if any("Defined" in i["message"] for i in linking):
    print("  Linking.sysml: cross-file import did NOT resolve"); ok = False
if files.get("Other.sysml"):
    print("  Other.sysml should have no errors"); ok = False
print("  must-fail self-test:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
EOF

src="$release/sysml/src"
echo "== examples/ (each folder on its own)"
check --each-dir --json "$out/examples.json" "$src/examples"
echo "== training/ (one model)"
check --json "$out/training.json" "$src/training"
echo "== validation/ (one model)"
check --json "$out/validation.json" "$src/validation"

echo "== summary (pilot $version)"
summary "$out/examples.json" "examples (per folder)"
summary "$out/training.json" "training"
summary "$out/validation.json" "validation"
