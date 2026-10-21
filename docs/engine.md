# The engine

The app talks to one engine interface, `EngineApi` (`src/lib/engine/protocol.ts`),
through `getEngine()` (`src/lib/engine/instance.ts`). Behind it are two
WebAssembly engines, each in its own Web Worker:

- **the sysml-toolkit** (Open-MBEE, `@sysml/wasm`, Apache-2.0; its standard
  library is EPL-2.0) — the app's engine. Its release is pinned in
  `toolkit.json` and fetched into `static/toolkit/` by
  `scripts/fetch-toolkit.sh` (every workflow runs it; run it once after
  cloning).
- **the classic engine** (`sysml-cli` built by `scripts/build-engine.sh` into
  `static/engine/`) — still serving the methods not moved yet. It goes in
  phase 7 of the migration plan (`docs/PLAN.md`, decision #16).

## The composite

`composeEngine` (`src/lib/engine/composite.ts`) gives the app one `Engine`:
every method listed in `TOOLKIT_METHODS` (`src/lib/engine/toolkit/protocol.ts`)
goes to the toolkit, every other method to the classic engine. The first
toolkit call also starts the classic worker, since the app needs both right
after a project opens. There is no switch between engines: the list is the
whole routing.

### Moving a method to the toolkit

1. Implement it on `ToolkitHost` (`src/lib/engine/toolkit/host.ts`). The host
   keeps one session for the latest project text; `this.session(files)` (or
   `this.build(files)`) reuses it while the texts are unchanged. Return the
   app's existing result type, with positions converted (below).
2. Add a handler for it in `toolkit.worker.ts` and add its name to
   `TOOLKIT_METHODS`.
3. Test it in Node against the real toolkit (`testing.ts` loads it and the
   demo; see `host.test.ts`), and run the e2e suite.
4. Delete it from the classic worker and client, and add it to
   `RetiredMethod` (`protocol.ts`; the composite checks every retired method
   is routed to the toolkit).
5. When no method routes to the classic engine any more, delete it.

The host runs in Node too (no worker globals), which is what the unit tests
use; keep it that way.

## Positions

The toolkit reports most positions in UTF-8 **bytes** (`check()` columns,
`declarationSite`, `memberExtent`, `lenientSources`, `edit()` splices) and
some in **UTF-16** (`references()`, the language server). The editor counts
UTF-16 code units. `TextIndex` (`toolkit/offsets.ts`) is built once per file
text and converts between byte offsets, UTF-16 offsets, 1-based line/column
(byte or UTF-16 columns) and LSP positions. Lines end at `\n` only (in `\r\n`
the `\r` belongs to its line, as the toolkit counts it). Use it for every
position the toolkit returns.

The app's `Span` carries byte offsets (`start_byte`, `end_byte`, what the
classic engine gave), 1-based lines and UTF-16 columns, and — from the
toolkit — UTF-16 offsets `from`/`to`, which the editor prefers.

## The model adapter

`extractModel` (`toolkit/model.ts`) reads the session's resolved model and
builds the app's per-file `Model` (definitions, usages, satisfy/verify links,
connections, views, metadata annotations) and the `ElementDetails` the
inspector shows. It takes owners, qualified names, typings, redefinitions,
satisfy and verify ends, metadata types and `about` targets from the toolkit,
and spells references the shortest way that resolves (`minimalSpelling`).
Elements, links and annotations carry the toolkit's element ids, and the
requirements view matches links and metadata to requirements by id.

Some reads cost a derivation pass over the whole model the first time they
are made in a session (~120 ms on the demo in Node): any `ownedRelationship`
or other derived relationship property, and `derived:name` when it is read
before the satisfy/verify ends. The adapter avoids them (a handle walk with
`typings`/`redefinitionRoot`, the tree graph's specialization edges, and
`derived:name` only for unnamed redefinitions, after the other derived
reads). Check the timing in `host.test.ts`-style runs when adding reads.

Fields filled from the declaration text rather than the model:

- `multiplicity` — the text between `[` and `]` (the toolkit gives bounds
  as expressions);
- specializations of elements the tree graph doesn't draw (attributes,
  `:> mass`) — as written;
- `valueKind: 'initial'` (`:=`) — the toolkit only says whether a value is a
  default;
- `connections[].source/target` — the ends of `connect a to b` as written;
- `views[].filters` — the `filter` conditions as written (the reports read
  them to sort chapters).

## Problems in the text

A unit that doesn't parse can't be part of a session, so `ToolkitHost`
repairs it first with `lenientSources()` (the broken member is cut out, open
bodies are closed) and keeps a `RepairMap` (`toolkit/repair.ts`) to map
positions in the repaired text back to the person's text. Then
(`toolkit/diagnostics.ts`):

- parse errors become the file's syntax errors; a parse error within two
  lines after another in the same file is the parser's echo and is dropped;
- while any file has a syntax error, an "unresolved reference" whose name, or
  a name before it in its chain, is written in a broken file is hidden (an
  unclosed `{` otherwise gave 40 such warnings on the demo), and the first
  syntax error says how many were hidden.

## Views and tables

`listViews`, `renderView` and `viewLibraries` are TypeScript over the model
adapter's records, in the toolkit worker (`toolkit/views/`). A view renders
as a table when a `@TableRendering` applies to it — its own, over what it
inherits from the view def it is typed by or specializes, field by field.
That says which rows to collect (`rows`: `requirements`, `trace`,
`relation:…`, `kind:port`, `type:T`, `@Metadata`, `composition`,
`kindcounts`), which columns to show (`name = expression` computes one with
the emulator's evaluator, `src/lib/sim/expr.ts`), `where`, `sortBy` and
`pivot`. Rows come from the project's files only; everything else in the
session is resolution context.

- **The view libraries.** `Reporting` and `ModelViews` (the demo's copies in
  `src/demo/drone/libraries/`) are added to the session of a project that
  doesn't declare those packages, like a second standard library: their views
  are listed as `builtin`, they make no rows and no problems, and
  `viewLibraries()` returns them to copy into a project.
- **What the toolkit resolves.** Trace links match requirements by the
  toolkit's resolved ends (`requirement_id`), not by name; a satisfied usage
  counts for its definition and the definition's supertypes. Types,
  specializations and redefinitions are the records' resolved ids
  (`typeIds`, `generalIds`, `rootId`). A port's connections come from the
  interconnection graph (`toGraph({view:'interconnection'})`), whose ends are
  resolved through the parts' types; the far end is shown as written.
- **`expose`.** `X` is X, `X::*` X's members, `X::**` X and everything
  nested in it, `X::*::**` everything nested but X. Members are what a
  namespace owns and what it inherits from its types and specializations
  (less what it redefines) — not what it imports: the toolkit's own exposure
  (`viewInfo`) follows the letter of the spec, where an expose takes in a
  package's private imports too (`SystemRequirements::*` would bring in all
  of SI). Targets resolve like names: from the namespaces around the view
  (innermost first), then from the root, then by qualified-name suffix. A bill of materials row is exposed by
  its path through the tree, so `drone::**` doesn't take in the same motor in
  another assembly. A view without `expose` shows the whole model.
- **`filter`.** On a view usage that exposes something, the toolkit's
  `viewInfo` applies the filters with the language's semantics; otherwise
  `@SysML::<Metaclass>` (by metaclass conformance: a part is an item),
  `@<Metadata>` and `kind = x` terms are read, and anything else is reported
  and ignored.
- **Editing.** Each column says what it edits (`name`, `shortName`, `doc`,
  `feature:<f>`, `metadata:<Meta>.<f>`) and its kind and enum options, found
  through the rows' resolved types and the library's metadata defs
  (`StatusInfo`); the `edit` method takes the same field names.
- **Cost.** The index is built once per session on the first view call
  (~15 ms on the demo in Node); a table then renders in a few milliseconds.
  No derived relationship property is read (those cost a ~300 ms
  derivation pass).

## State machines

`stateMachines` (`toolkit/machines.ts`) builds the emulator's `StateMachine`s
from the adapter's element records: a machine is a `state def`, or a `state`
/ `exhibit state` usage not inside another state, with states or
transitions of its own. States, nesting, `parallel` (`isParallel`), docs and
variables (attributes of the machine, its states and, for a usage, the
element it is in) come from the model; each transition's source and target
are the toolkit's `derived:source` / `derived:target`, so `then done` is the
library's final state and a nested target is the state it names. The
expression texts come from the transition's source text (the model has no
spans for expressions), in the emulator's conventions: a trigger is the
signal, `when …` or `after …` / `at …`; an action that assigns is
`assign x := e` statements joined by `; `. Names are matched by hand only
where the toolkit can't help cheaply: the `entry; then x;` target (a
succession's `targetFeature` costs the whole-model derivation pass), a
target transition's source (`accept Go then b;` after `state a;`: the state
before it) and ends that don't resolve (a placeholder state and a warning).
It costs about 3 ms on the demo, once per analysis.

## Diagrams

`EngineApi.diagram(view, files, scope)` is answered in the toolkit worker by
`toolkit/diagrams/` (`buildDiagram`), over the session the analysis built:

- **general** (`general.ts`) — from the model adapter's records: a package's
  definitions, usages (as part trees, three levels) and packages, plus the
  project definitions they specialize or are built from; a definition with
  its parts as usages; a usage's part tree; a **view usage** from what it
  exposes, filters applied (`viewInfo`, kept to elements owned under an
  `expose`d name, since exposure follows `isImportAll`); no scope: every
  definition. Edges: specialization and composition, typing ("defined by")
  from usages to drawn definitions, and connections written with `end`
  features between drawn elements (a `#derivation connection` as «derive»).
- **interconnection**, **states**, **actions** (`interconnection.ts`,
  `behavior.ts`) — from the toolkit's own graphs (`toGraph`, `tkgraph.ts`),
  which resolve connector ends through feature chains, render ports a part
  inherits from its definition and its supertypes, and label transitions.
  Two gaps are filled from the model: a connector the toolkit cannot place
  (a binding to the scope's own inherited port) is drawn from its ends as
  written, and a decision's branches (`if c then a; else b;`, transitions
  the action graph leaves out) take the node declared before them as
  source. A change trigger's label (`accept when …`) is read from the text.
- **requirements**, **trace**, **packages** (`trace.ts`) — from the records
  and the satisfy/verify ends the adapter resolved (`ExtractedModel.traces`).

Node ids are names as written, because `layout/diagrams.json` keys positions
by them: a definition `Battery`, a usage its path `drone.battery`, a state or
action its path in the machine, `__initial__`/`__final__`, unnamed control
nodes `fork#1`, `decide#1`; a clash takes the qualified name. Each node also
carries `element` (file and declaration byte), which the canvas uses to find
the element instead of matching names. A general view is opened with the
view usage's qualified name as scope (`workbench/views.ts`), so its layout key
is `general:Views::name`.

Cost on the demo in Node, after analysis: 0.4–16 ms per view. The one
expensive read (a connector's resolved ends, a whole-model pass of ~300 ms
the first time) is only made when an end's name matches nothing drawn.

## Language services

The editor's completion, hover, go to definition, references, rename,
outline and quick fixes come from the toolkit's in-wasm language server
(`LspServer`, LSP messages as strings, UTF-16 positions), through
`LanguageServices` (`toolkit/language.ts`), answered in the existing
`EngineApi` shapes so `src/lib/editor/language.ts` is unchanged:

- One server sees the project and the standard library
  (`LspServer.withPreparedLibrary`). Each call brings it up to date: the
  workspace is re-seeded when a file that isn't open changes, and the file
  being edited is opened in it (later texts arrive as `didChange`). URIs are
  `file:///project/<path>`; the library's are `sysmlv2-lib:/<path>`, which
  go to definition opens in the library browser.
- Rename, formatting and code actions answer with whole new documents or
  edits; `diffTexts` (`toolkit/diff.ts`) turns them into minimal changes, so
  the cursor and undo history stay put.
- Quick fixes are asked for with the analysis's own problems at the
  selection (the server's own diagnostics are syntax-only).
- Highlighting uses a second server without the project or library (syntax
  only, so any text — a library file — can be highlighted), its semantic
  token types mapped to the editor's names (`type` declarations as
  `type.definition`, a comment after `doc` as `comment.documentation`).
- Formatting is `formatSource` with four-space indentation; text that
  doesn't parse is left alone.
- Highlighting and formatting (`SyntaxServices`) need no library, so the
  worker answers them as soon as the module is compiled, while the library
  is still loading: text is coloured seconds before the model is ready.

## Library loading

The first visit loads the standard library from its sources (`sysml-library.json.gz`,
0.2 MB; the module is 3 MB gzipped). Once the toolkit is up and the page is
idle (and not on Save-Data or 2G), the worker downloads the prepared snapshot
(`sysml-library.prepared.gz`, 10 MB) into the `sysml-web-toolkit-snapshot`
cache, keyed by the toolkit release; later starts load the library from it,
which is about three times faster and takes a third less memory. A snapshot
the toolkit refuses (another build) is deleted and the library loads from
source. The service worker caches the toolkit's other files on first use, like
the classic engine's, but never the snapshots (`src/lib/offline/caching.ts`).

## When the toolkit fails

A toolkit defect traps the WebAssembly instance (`RuntimeError: unreachable`);
running out of memory fails a `memory.grow`. Either way the worker is useless.
`startToolkit` (`toolkit/client.ts`) then starts a new worker once and sends
the calls in flight again. If that fails too, every toolkit call fails from
then on: a toast says so once, the status bar shows "Engine error" and the
problems list says why. The classic engine is not a fallback.

## The test build

`?toolkit` in a project URL still runs the spike's measuring panel
(`src/lib/engine/spike/`), in a worker of its own, for trying library
variants on a phone. It goes with the classic engine in phase 7.
