#!/usr/bin/env bash
# Send a SysML model to Eclipse SysON and get it back, with no Fairtide UI:
#
#   tools/interop/syson-roundtrip.sh [--single] <model dir> [out dir]
#
# --single uploads the whole model as one document (all files joined), which
# sidesteps SysON resolving each document only against those uploaded before
# it (files that refer to each other in a cycle cannot all resolve otherwise).
#
#  1. starts SysON + PostgreSQL with Docker (tools/interop/syson/docker-compose.yml)
#     unless SYSON_URL points at a running SysON;
#  2. creates a project through SysON's Systems Modeling API
#     (POST /api/rest/projects?name=..., the form SysON accepts);
#  3. uploads every .sysml file as a document (SysON's textual SysML import,
#     the GraphQL uploadDocument mutation the "Upload document" dialog uses),
#     in dependency order, and keeps SysON's import report per file;
#  4. reads the model back two ways:
#       - the API's element JSON (GET .../commits/{c}/elements) -> out/api-elements.json
#       - each document as SysML text (SysON's textual export, the "Download"
#         action: GET /api/editingcontexts/{ec}/documents/{doc}, Accept: text/html)
#         -> out/text/<file>.sysml
#
# Then check what came back with independent tools, e.g.
#   tools/interop/pilot-check.sh <out>/text                       (OMG pilot)
#   node tools/interop/fairtide/run.mjs import <out>/api-elements.json <out>/fairtide-import
#
# Needs docker (with compose), curl, python3. Leaves SysON running; stop it with
#   docker compose -f tools/interop/syson/docker-compose.yml down -v
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
single=0
if [ "${1:-}" = --single ]; then single=1; shift; fi
model="${1:?usage: syson-roundtrip.sh [--single] <model dir> [out dir]}"
model="$(cd "$model" && pwd)"
out="${2:-$here/../../.cache/interop/syson-roundtrip/$(basename "$model")-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$out/text" "$out/reports"
out="$(cd "$out" && pwd)"
compose=(docker compose -f "$here/syson/docker-compose.yml")
url="${SYSON_URL:-http://localhost:${SYSON_PORT:-8080}}"
c() { curl -sS --noproxy '*' "$@"; }

if [ -z "${SYSON_URL:-}" ]; then
	"${compose[@]}" up -d >&2
fi
echo "syson: waiting for $url/api/rest/projects ..." >&2
for _ in $(seq 1 120); do
	[ "$(c -o /dev/null -w '%{http_code}' "$url/api/rest/projects" 2>/dev/null || true)" = 200 ] && break
	sleep 2
done
c -f -o /dev/null "$url/api/rest/projects" || { echo "syson: not answering at $url" >&2; exit 2; }

name="fairtide-$(basename "$model")-$(date +%H%M%S)"
project="$(c -f -X POST -H 'Accept: application/json' "$url/api/rest/projects?name=$name" |
	python3 -c 'import json,sys; print(json.load(sys.stdin)["@id"])')"
gql() { c -f -H 'Content-Type: application/json' -d "$1" "$url/api/graphql"; }
ec="$(gql "{\"query\":\"{ viewer { project(projectId: \\\"$project\\\") { currentEditingContext { id } } } }\"}" |
	python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["viewer"]["project"]["currentEditingContext"]["id"])')"
echo "syson: project $name ($project), editing context $ec" >&2

# SysON resolves a document's names when it is uploaded, against what is
# already there, so upload in dependency order: a file after the files whose
# top-level packages it names (import X::..., X::y). Cycles keep path order.
mapfile -t files < <(python3 - "$model" <<'PY'
import os, re, sys
root = sys.argv[1]
files = sorted(os.path.relpath(os.path.join(d, f), root) for d, _, fs in os.walk(root) for f in fs if f.endswith(".sysml"))
strip = lambda t: re.sub(r"/\*.*?\*/|//[^\n]*", "", t, flags=re.S)
text = {f: strip(open(os.path.join(root, f), encoding="utf-8").read()) for f in files}
owner = {}
for f in files:
    for m in re.finditer(r"^\s*(?:library\s+|standard\s+library\s+)?package\s+('[^']+'|\w+)", text[f], re.M):
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
if [ "$single" = 1 ]; then
	joined="$out/upload"
	mkdir -p "$joined"
	for f in "${files[@]}"; do cat "$model/${f#./}"; printf '\n'; done > "$joined/$(basename "$model").sysml"
	model="$joined"
	files=("./$(basename "$model/"*.sysml)")
fi
uploaded=0
for f in "${files[@]}"; do
	rel="${f#./}"
	ops="$(python3 -c '
import json, sys, uuid
q = ("mutation uploadDocument($input: UploadDocumentInput!) { uploadDocument(input: $input) { __typename "
     "... on UploadDocumentSuccessPayload { report } ... on ErrorPayload { messages { body level } } } }")
print(json.dumps({"query": q, "variables": {"input": {"id": str(uuid.uuid4()), "editingContextId": sys.argv[1], "file": None, "readOnly": False}}}))
' "$ec")"
	answer="$(c -F "operations=$ops" -F 'map={"0":"variables.file"}' -F "0=@$model/$rel;filename=$(basename "$rel")" "$url/api/graphql/upload")"
	printf '%s\n' "$answer" > "$out/reports/$(echo "$rel" | tr / _).json"
	python3 -c '
import json, sys
rel, answer = sys.argv[1], sys.argv[2]
try:
    r = json.loads(answer)["data"]["uploadDocument"]
except Exception:
    print(f"  {rel}: upload failed: {answer[:200]}"); sys.exit(0)
if r["__typename"] != "UploadDocumentSuccessPayload":
    print(f"  {rel}: refused: {r}"); sys.exit(0)
report = (r.get("report") or "").strip()
lines = [l for l in report.splitlines() if l.strip()]
print(f"  {rel}: imported" + (f", report {len(lines)} line(s): " + " | ".join(lines[:3]) if lines else ", empty report"))
' "$rel" "$answer"
	uploaded=$((uploaded + 1))
done
echo "syson: uploaded $uploaded file(s)" >&2

# The model as the API serves it.
head="$(c -f -H 'Accept: application/json' "$url/api/rest/projects/$project/branches" |
	python3 -c 'import json,sys; b=json.load(sys.stdin)[0]; print((b.get("head") or b.get("referencedCommit"))["@id"])')"
c -f -H 'Accept: application/json' "$url/api/rest/projects/$project/commits/$head/elements" > "$out/api-elements.json"
python3 -c '
import json, sys, collections
d = json.load(open(sys.argv[1]))
print(f"syson: API serves {len(d)} elements; top types:", dict(collections.Counter(e["@type"] for e in d).most_common(6)))
' "$out/api-elements.json"

# Each document as SysML text. SysON's API does not list documents, so read
# their ids from its database (the compose service), then download each.
if [ -z "${SYSON_URL:-}" ]; then
	"${compose[@]}" exec -T database psql -U dbuser -d syson-db -At -F $'\t' -c \
		"select id, name from document where semantic_data_id = '$ec' order by name" > "$out/documents.tsv"
	while IFS=$'\t' read -r doc docname; do
		# On a server-side failure SysON answers 200 with its web page, not an error.
		if c -f -H 'Accept: text/html' "$url/api/editingcontexts/$ec/documents/$doc" > "$out/text/$docname" &&
			! head -c 200 "$out/text/$docname" | grep -qi '<!DOCTYPE html'; then
			:
		else
			echo "  $docname: SysON could not export it as text (see: docker compose logs syson)" >&2
			mv "$out/text/$docname" "$out/$docname.export-failed.html"
		fi
	done < "$out/documents.tsv"
	echo "syson: exported $(find "$out/text" -name '*.sysml' | wc -l) of $(wc -l < "$out/documents.tsv") document(s) as text to $out/text" >&2
else
	echo "syson: SYSON_URL set; skipping the text export (needs the database to list documents)" >&2
fi
printf '%s\n' "$project" > "$out/project-id"
echo "$out"
