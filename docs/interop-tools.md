# Interop reference tools

Tools other than Fairtide that check what Fairtide reads and writes, so an
assessment does not rely on Fairtide grading itself. Everything they download
goes to `.cache/interop/` (gitignored). Results below are from 2026-10-23.

| Tool | Runs here | Entry point |
| --- | --- | --- |
| OMG SysML v2 pilot implementation (reference implementation, Xtext) | yes, plain Java 21 | `tools/interop/pilot-check.sh` |
| Eclipse SysON (Spring Boot + PostgreSQL) | yes, with Docker | `tools/interop/syson-roundtrip.sh` |
| Fairtide's own exchange code, headless | yes, Node 22 + the app's `node_modules` | `node tools/interop/fairtide/run.mjs` |

## OMG pilot implementation: `pilot-check.sh`

```sh
tools/interop/pilot-check.sh src/demo/drone                 # every .sysml under it, as one model
tools/interop/pilot-check.sh --quiet --json out.json <files or dirs>...
tools/interop/pilot-check.sh --version 0.62.0 <files>       # another pilot release
tools/interop/pilot-corpus.sh                                # self-test: must-fail files + the OMG corpus
tools/interop/pilot-corpus.sh 2026-08                        # same, against another release tag
```

- Downloads the pilot's self-contained jar (the `jupyter-sysml-kernel`
  package on conda-forge, which also carries the matching `sysml.library`),
  checks its SHA-256, and runs `tools/interop/pilot/PilotCheck.java` with it
  (Java 21 runs the source file directly). Needs `java`, `curl`, `unzip`,
  `zstd`.
- `PilotCheck` loads the library the way the pilot's Jupyter kernel does
  (`SysMLInteractive.loadLibrary`), loads all given files into one resource
  set (so they can refer to each other), resolves everything and runs the
  pilot's Xtext validator: syntax, name resolution, and the KerML/SysML
  validation rules. One line per issue, `[code]` is the pilot's rule name.
  Exit status 1 when there is an error.
- Default release 0.57.0 = SysML-v2-Release tag `2026-02` (the checkout the
  app's scripts use). Latest on conda-forge: 0.62.0 (tag `2026-08`).
- `pilot-corpus.sh` first checks the files in `tools/interop/pilot/must-fail/`
  (a syntax error, an unresolved name with a cross-file import that must
  resolve, and two typing-rule violations) and fails unless all are reported.
  Then it checks the release corpus: each `examples/` folder on its own, and
  `training/` and `validation/` each as one model, because their lessons
  import each other.
- One quirk worth knowing: the pilot rejects a bare `import X::*;` (it wants
  `private`/`public import`).

Corpus results (0 errors is what the pilot's own build expects):

| Release | examples (per folder) | training | validation | must-fail |
| --- | --- | --- | --- | --- |
| 0.57.0 / 2026-02 | 95 files, 0 errors, 5 warnings | 100 files, 0 errors, 2 warnings | 56 files, 0 errors, 4 warnings | all found |
| 0.62.0 / 2026-08 | 96 files, 0 errors, 0 warnings | 100 files, 0 errors, 0 warnings | 56 files, 0 errors, 0 warnings | all found |

## SysON: `syson-roundtrip.sh`

```sh
tools/interop/syson-roundtrip.sh src/demo/drone             # one SysON document per file
tools/interop/syson-roundtrip.sh --single src/demo/drone    # the whole model as one document
docker compose -f tools/interop/syson/docker-compose.yml down -v   # stop SysON afterwards
```

- Starts `eclipsesyson/syson:v2026.9.3` and `postgres:16-alpine` with
  `tools/interop/syson/docker-compose.yml` (`SYSON_VERSION`, `SYSON_PORT` to
  change). The web UI is then at http://localhost:8080/ and the Systems
  Modeling API at http://localhost:8080/api/rest. In this cloud container the
  Docker daemon is not running at first: start it with `dockerd &` (as root);
  image pulls go through the proxy without extra setup.
- Creates a project with the API (`POST /api/rest/projects?name=…`), uploads
  the `.sysml` files with SysON's textual import (the GraphQL `uploadDocument`
  mutation behind *Upload document*, in dependency order), then reads the model
  back as API element JSON (`api-elements.json`) and as SysML text per
  document (SysON's *Download*, `GET /api/editingcontexts/{ec}/documents/{doc}`
  with `Accept: text/html`). The document ids come from SysON's database,
  because its API does not list documents. Output goes to
  `.cache/interop/syson-roundtrip/<model>-<time>/` with SysON's import report
  per file in `reports/`.
- Check what comes back with the other tools:

```sh
tools/interop/pilot-check.sh --quiet <out>/text
node tools/interop/fairtide/run.mjs check <out>/text
node tools/interop/fairtide/run.mjs import <out>/api-elements.json <out>/fairtide-import
```

## Fairtide headless: `fairtide/run.mjs`

Calls the app's own code (the engine host the unit tests use, `src/lib/exchange/`)
through Vite's SSR loader, so the result is what the app does minus its
dialogs. Needs the app's `node_modules` and `static/toolkit/`
(`scripts/fetch-toolkit.sh`). Not a test suite; it loads the engine once
(a few seconds).

```sh
node tools/interop/fairtide/run.mjs check  <model dir> [--json out.json]   # Fairtide's diagnostics, with syntax errors
node tools/interop/fairtide/run.mjs export <model dir> <out.json> [--library] [--derived]
node tools/interop/fairtide/run.mjs import <in.json> <out dir>
node tools/interop/fairtide/run.mjs projects <server>                      # connectTo, as "Open from server"
node tools/interop/fairtide/run.mjs create <api base> <name>               # SysmlApi.createProject
node tools/interop/fairtide/run.mjs push <api base> <project id> <model dir>   # "Save to server"
node tools/interop/fairtide/run.mjs pull <api base> <project id> <out dir>     # "Open from server"
```

## What the tools say (2026-10-23)

### Demo model (`src/demo/drone`, 22 files) and the custom libraries

Fairtide (`run.mjs check`): 0 errors, 0 warnings. Pilot 0.57.0 and 0.62.0
(same result): 12 errors in 2 files, 20 files clean.

- `requirements/StakeholderNeeds.sysml` lines 14, 24, 35, 46, 57, 67:
  `Subject must be first parameter. [validateRequirementUsageSubjectParameterPosition]`.
  Each requirement declares a `stakeholder` but no `subject`, so the
  stakeholder parameter comes before the subject. A minimal case
  (`requirement r { stakeholder s : Op; }`) fails the same way; declaring
  `subject` first passes.
- `system/Satisfaction.sysml` lines 15-20: `Couldn't resolve reference to
  Feature 'flightController'` (and `battery`, `radio`, `payloadRelease`).
  In `satisfy 'Wind tolerance' by drone.flightController`, `drone` resolves to
  the requirement's own subject parameter `drone : DeliveryDrone` (declared in
  `SystemRequirements::DroneRequirement`), not to the imported
  `DroneArchitecture::drone`, and `DeliveryDrone` has no `flightController`.
  `satisfy … by drone;` raises nothing, but by the same rule binds to the
  subject parameter, not to the design. SysON's importer reports the same six
  names as unresolved. Writing `by DroneArchitecture::drone.flightController`
  resolves (checked on a minimal case).

The three custom libraries:

| File | With its dependencies | Alone |
| --- | --- | --- |
| `RiskAnalysis.sysml` | 0 errors, 0 warnings | 69 errors (needs `HazardAnalysis` and `Reporting`) |
| `HazardAnalysis.sysml` | 0 errors, 0 warnings | 10 errors (needs `Reporting`) |
| `DependencyMatrices.sysml` | 0 errors, 0 warnings | 0 errors, 0 warnings |

"With dependencies" means checked together with `Reporting.sysml` (and
`HazardAnalysis.sysml` for `RiskAnalysis`). So they are valid SysML as far as
the reference implementation checks, but `RiskAnalysis` and
`HazardAnalysis` are not standalone: they import `Reporting`
(`TableRendering`). The app's engine adds `Reporting`/`ModelViews` to a
project's analysis when they are missing (`missingViewLibraries`), while
`missingRiskLibraries` adds only the two risk files. A project that gets the
risk libraries but not `Reporting.sysml` would check clean in Fairtide and
show these errors in other tools. Worth checking on an exported project.

SysON's importer accepts all three, except that it cannot resolve `that` in
`assert constraint … { that >= 1 and that <= 10 }` (a SysON gap; the pilot
accepts it).

### SysON exchange

Fairtide → SysON:

- API, project creation: fails. Fairtide sends `POST /projects` with a JSON
  body; SysON wants `?name=` (it logs `MissingServletRequestParameterException:
  'name'`) and answers 200 with its web page, so Fairtide says "The server
  answered with something other than JSON."
- API, commit ("Save to server"): fails. Fairtide's `DataVersion.identity`
  has no `"@type": "DataIdentity"`; SysON cannot read it (`RestDataIdentityRequest
  … NullPointerException`) and again answers with its web page. With the
  `@type` added by hand, SysON answers 201 but applies only changes to
  attributes of elements it already has: new elements (a new
  `OwningMembership` + `PartDefinition`) are silently dropped, and a full
  element payload as Fairtide sends it makes the commit fail
  (`ClassCastException: String cannot be cast to Collection`). So a model
  cannot be pushed to SysON through the API at all, whatever the client.
- Text: works, with gaps. Uploading the `.sysml` files gives 8,787 elements in
  SysON. Per-file upload leaves names unresolved where files refer to each
  other in a cycle (`DeliveryContext`, `DeliveryMission`, `DroneArchitecture`,
  `DronePerformance`); `--single` avoids that. What remains: the six satisfy
  chains above, `that` (4), and the parameter `r` in
  `rotors->collect { in r : Rotor; r.mass }` (2).

SysON → Fairtide:

- API reading works with Fairtide's client (`connectTo` finds `/api/rest`
  from the site address; projects, branches, commits and paged elements read
  fine; SysON calls the parent list `previousCommits`).
- Import of SysON's element JSON ("Open from server"): fails for the drone
  model (both upload modes) and for SysON's own Batmobile example:
  `InterchangeError: … cannot lift the document without data loss: cannot
  name reference target … (element outside document?)`. The targets include
  implied `ConjugatedPortDefinition`s (`'~PowerPort'`) and anonymous features;
  SysON's API also leaves out each document's root `Namespace` and some
  elements other elements point to (93 references to elements it does not
  serve, in the drone model).
  A small model (one library file) imports; the text matches the original
  apart from formatting, though the import report lists 6 "not carried over"
  notes for typings and multiplicities that the text does have.
- SysON's text export (per-file upload), read by the pilot and by Fairtide:
  21 of 22 documents export, and both tools find syntax errors in the same 9
  of them. Names SysON did not resolve on import are printed
  empty (`private import ;`, `by drone.null`, `>= 0.0 and <= 1.0`), plus
  printer losses independent of that (`expose SystemRequirements::*` comes out
  as `expose SystemRequirements::;`, `do assign stateOfCharge := …` as
  `do assign := then …`). `ModelViews.sysml`, and the whole model as one
  document, cannot be exported (`NullPointerException … ReferenceSubsetting`).

## Running SysON on your own machine

```sh
docker compose -f tools/interop/syson/docker-compose.yml up -d
# wait for http://localhost:8080/api/rest/projects to answer []
tools/interop/syson-roundtrip.sh src/demo/drone
```

In Fairtide, use `http://localhost:8080` as the server address (it finds
`/api/rest` itself). The compose file allows any CORS origin, so a Fairtide
dev server on another port can reach it (checked: a preflight from
`http://localhost:5173` is allowed).
