#!/usr/bin/env bash
# The interchange acceptance test (docs/assessment/03-interchange.md): one
# multi-file model sent through every route Fairtide offers and through the
# reference tools, compared by normalized semantics (qualified name -> kind,
# typing, specialization, multiplicity, values, relationships), not by text.
#
#   tools/interop/acceptance.sh [model dir] [out dir]
#
# Default model: src/lib/interchange/fixtures/acceptance. Needs what the
# other tools need (java 21, docker for SysON; see docs/interop-tools.md).
# SKIP_SYSON=1 leaves SysON out; SKIP_PILOT=1 leaves the pilot out.
#
# Each step writes to <out>/ and adds a line to <out>/summary.txt:
#   route  |  what came back  |  semantic difference to the original
# The pilot checks every artifact Fairtide exports (as text).
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
model="$(cd "${1:-$root/src/lib/interchange/fixtures/acceptance}" && pwd)"
out="${2:-$root/.cache/interop/acceptance/$(basename "$model")-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
ft() { node "$here/fairtide/run.mjs" "$@"; }
summary="$out/summary.txt"
: > "$summary"
say() { printf '%s\n' "$*" | tee -a "$summary"; }
field() { # field <json file> <python expression over d>: one line from a tool's JSON output
	python3 -c 'import json, sys
try:
    d = json.load(open(sys.argv[1]))
    print(eval(sys.argv[2], {"d": d}))
except Exception:
    print("failed: " + open(sys.argv[1]).read().strip().splitlines()[-1][:200])' "$1" "$2"
}
pilot() { # pilot <label> <dir>
	[ -n "${SKIP_PILOT:-}" ] && return
	local log="$out/pilot-$1.txt"
	"$here/pilot-check.sh" --quiet --version "${PILOT_VERSION:-0.62.0}" "$2" > "$log" 2>&1
	say "pilot $1: $(tail -1 "$log")"
}
compare() { # compare <label> <other>
	local log="$out/compare-$1.txt"
	ft compare "$model" "$2" --json "$out/compare-$1.json" > "$log" 2>&1
	say "semantics $1: $(head -1 "$log" | sed 's/^compare [^ ]* [^ ]*: //')"
}

say "model: $model"
ft check "$model" > "$out/fairtide-check.txt" 2>&1
say "fairtide check: $(tail -1 "$out/fairtide-check.txt")"
pilot model "$model"

# Fairtide -> SysML v2 JSON -> Fairtide (three export forms).
for form in default derived library; do
	flag=""; [ "$form" = default ] || flag="--$form"
	mkdir -p "$out/json-$form"
	ft export "$model" "$out/json-$form/export.json" $flag > "$out/json-$form/export.txt" 2>&1
	ft import "$out/json-$form/export.json" "$out/json-$form/text" > "$out/json-$form/import.txt" 2>&1
	say "json $form: $(field "$out/json-$form/import.txt" '"%s of %s elements, notes %s, errors %s" % (d["carried"], d["elements"], d["notesByKind"], d["errorCount"])')"
	compare "json-$form" "$out/json-$form/text"
	pilot "json-$form" "$out/json-$form/text"
done

# .kpar: Download as .kpar -> Import.
mkdir -p "$out/kpar"
ft kpar "$model" "$out/kpar/model.kpar" acceptance > /dev/null 2>&1
ft unkpar "$out/kpar/model.kpar" "$out/kpar/files" > "$out/kpar/read.txt" 2>&1
say "kpar: $(field "$out/kpar/read.txt" '"%d files, skipped %s, warnings %s" % (len(d["files"]), d["skipped"], d["warnings"])')"
compare kpar "$out/kpar/files"
pilot kpar "$out/kpar/files"

# The pilot's own abstract syntax for the model (its Jupyter kernel's %export).
if [ -z "${SKIP_PILOT:-}" ]; then
	kernel="$root/.cache/interop/pilot-${PILOT_VERSION:-0.62.0}/pkg/share/jupyter/kernels/sysml"
	# The pilot reads each file as a notebook cell: a file after those it names.
	mapfile -t files < <(python3 - "$model" <<'PY'
import os, re, sys
root = sys.argv[1]
files = sorted(os.path.relpath(os.path.join(d, f), root) for d, _, fs in os.walk(root) for f in fs if f.endswith(".sysml"))
text = {f: re.sub(r"/\*.*?\*/|//[^\n]*", "", open(os.path.join(root, f), encoding="utf-8").read(), flags=re.S) for f in files}
owner = {}
for f in files:
    for m in re.finditer(r"^\s*(?:library\s+)?package\s+(\w+)", text[f], re.M):
        owner.setdefault(m.group(1), f)
deps = {f: {owner[n] for n in owner if owner[n] != f and re.search(r"(?<![\w'])" + re.escape(n) + r"::", text[f])} for f in files}
done, order = set(), []
def visit(f, stack=()):
    if f in done or f in stack: return
    for d in sorted(deps[f]): visit(d, stack + (f,))
    done.add(f); order.append(f)
for f in files: visit(f)
print("\n".join(order))
PY
)
	mapfile -t names < <(cd "$model" && cat "${files[@]}" | sed -n 's/^\(library \)\{0,1\}package \([A-Za-z_][A-Za-z0-9_]*\).*/\2/p')
	(cd "$model" && java -cp "$kernel"/jupyter-sysml-kernel-*-all.jar "$here/pilot/PilotExport.java" \
		"$kernel/sysml.library" "$out/pilot-export.json" "${files[@]}" -- "${names[@]}") > "$out/pilot-export.txt" 2>&1
	compare pilot-json "$out/pilot-export.json"
fi

# SysON: text upload, its element JSON, its text export, and Fairtide reading both.
if [ -z "${SKIP_SYSON:-}" ]; then
	"$here/syson-roundtrip.sh" "$model" "$out/syson" > "$out/syson.txt" 2>&1
	say "syson upload: $(grep -c 'imported' "$out/syson.txt") file(s) imported; $(grep -o 'API serves [0-9]* elements' "$out/syson.txt")"
	compare syson-api-json "$out/syson/api-elements.json"
	compare syson-text "$out/syson/text"
	pilot syson-text "$out/syson/text"
	ft check "$out/syson/text" > "$out/syson-text-fairtide-check.txt" 2>&1
	say "fairtide check of syson text: $(tail -1 "$out/syson-text-fairtide-check.txt")"
	ft import "$out/syson/api-elements.json" "$out/syson-import" > "$out/syson-import.txt" 2>&1
	if [ -d "$out/syson-import" ] && ls "$out/syson-import"/*.sysml > /dev/null 2>&1; then
		compare syson-json-into-fairtide "$out/syson-import"
	else
		say "syson json into fairtide: refused: $(grep -o 'InterchangeError: [^;]*' "$out/syson-import.txt" | head -1)"
	fi
	# Fairtide -> SysON through the Systems Modeling API, as "Save to server" does it.
	api="${SYSON_URL:-http://localhost:${SYSON_PORT:-8080}}/api/rest"
	ft create "$api" "fairtide-acceptance-create" > "$out/api-create.txt" 2>&1
	say "api create (Fairtide): $(tail -1 "$out/api-create.txt")"
	project="$(curl -sS --noproxy '*' -X POST -H 'Accept: application/json' "$api/projects?name=fairtide-acceptance-push" |
		python3 -c 'import json,sys; print(json.load(sys.stdin)["@id"])')"
	ft push "$api" "$project" "$model" > "$out/api-push.txt" 2>&1
	say "api save (Fairtide): $(grep -E '^(commit|after)' "$out/api-push.txt" | tr '\n' ' ')"
fi
echo "results in $out" >&2
